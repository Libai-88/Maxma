"""Tool: call_sub_agent — 创建子 Agent 会话执行单轮任务并返回结果。"""

import asyncio
import contextvars
from dataclasses import replace
import logging
import sys
import time
import traceback

from pydantic import BaseModel, Field

from agent.prompts import build_system_prompt
from api import interaction
from tools.base import ToolBase, format_success, format_error, register_tool
from tools.sub_agent.delegation_context import (
    create_delegation_context,
)
from tools.sub_agent.deferred_result_store import DeferredResultStore
from tools.sub_agent.run_manager import DeferredRunManager

logger = logging.getLogger(__name__)


class CallSubAgentInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    task: str = Field(
        default="", description="需要子 Agent 处理的任务描述（完整用户提示词）"
    )
    name: str = Field(
        default="", description="可选，子会话的显示名称（用于侧边栏标识）"
    )


# 深度追踪 — 使用 ContextVar 实现每个 asyncio Task 独立的计数。
# 并发调用（同一层级的多个子 Agent）互不干扰；
# 链式递归（子 Agent 再调子 Agent）才会递增深度。
_sub_call_depth: contextvars.ContextVar[int] = contextvars.ContextVar(
    "_sub_call_depth", default=0
)
_MAX_SUB_CALL_DEPTH = 2


@register_tool
class CallSubAgentTool(ToolBase):
    name: str = "call_sub_agent"
    description: str = (
        "创建一个子 Agent 会话执行单轮任务并将结果返回。"
        "用于需要独立的推理和工具调用的子任务，例如分析代码文件、执行多步骤搜索等。"
        "子 Agent 拥有独立的上下文窗口，不会污染主对话。"
        "[调用积极性: 可自由看情况调用] [get_doc: 使用前必须 get_doc]"
    )
    args_schema: type[BaseModel] = CallSubAgentInput

    def _run(self, get_doc: bool = False, task: str = "", name: str = "") -> str:
        raise NotImplementedError("call_sub_agent 仅支持异步模式")

    async def _arun(self, get_doc: bool = False, task: str = "", name: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not task.strip():
            return format_error("task 不能为空")

        # ── 深度限制（ContextVar，每个 asyncio Task 独立计数）─
        depth = _sub_call_depth.get()
        if depth >= _MAX_SUB_CALL_DEPTH:
            return format_error(
                f"子 Agent 嵌套深度已达上限 ({_MAX_SUB_CALL_DEPTH} 层)，拒绝递归调用"
            )
        _sub_call_depth.set(depth + 1)
        try:
            return await self._do_run(task, name)
        finally:
            _sub_call_depth.set(depth)  # 恢复而非递减，避免异常场景下计数错乱

    async def _do_run(self, task: str, name: str = "") -> str:
        print("[call_sub_agent] _do_run entered", file=sys.stderr)
        try:
            ws = interaction.current_ws.get()
            print(
                f"[call_sub_agent] current_ws OK: {type(ws).__name__}", file=sys.stderr
            )
        except LookupError:
            print(
                "[call_sub_agent] FATAL: current_ws not set in this context!",
                file=sys.stderr,
            )
            traceback.print_stack(file=sys.stderr)
            return format_error("内部错误: WebSocket 上下文丢失，无法创建子会话")
        except Exception as e:
            print(
                f"[call_sub_agent] FATAL: current_ws.get() failed: {e}", file=sys.stderr
            )
            return format_error(f"内部错误: current_ws 异常: {e}")

        app_state = ws.app.state
        sm = app_state.session_manager
        print("[call_sub_agent] app_state / session_manager OK", file=sys.stderr)

        # 确定 parent_session_id
        # 从 WebSocket 路径推断：ws/chat/{session_id}
        parent_session_id = None
        try:
            path = str(getattr(ws, "url", getattr(ws, "path", "")))
            if "/ws/chat/" in path:
                parent_session_id = path.rsplit("/ws/chat/", 1)[-1]
        except Exception:
            logger.debug("Failed to parse parent_session_id from WebSocket URL", exc_info=True)

        # 1. 创建 sub-session
        delegation_context = create_delegation_context(app_state, parent_session_id)
        async_enabled = _async_subagent_enabled()
        if async_enabled:
            # The first async release deliberately permits no tools.  A durable
            # task can then be retried after a restart without replaying an
            # external side effect; later permission modes may widen this only
            # with an explicit idempotency contract.
            delegation_context = replace(
                delegation_context,
                allowed_tools=frozenset(),
                allowed_paths=frozenset(),
                enforce_scope=True,
                auto_approve=False,
            )
        sub = await sm.create_sub_session(
            task=task,
            parent_session_id=parent_session_id,
        )
        # SessionManager is intentionally unaware of execution policy.  Keep the
        # immutable context on the child session so the fallback runner has the
        # exact snapshot created at delegation time.
        sub.delegation_context = delegation_context
        print(
            f"[call_sub_agent] sub-session created: {sub.session_id}", file=sys.stderr
        )

        # The legacy UI connects to ``sub_session_created`` and starts the
        # child itself.  Do not emit it in deferred mode: that would race the
        # durable dispatcher and allow a non-lease-owned duplicate execution.
        if not async_enabled:
            print("[call_sub_agent] sending sub_session_created via WS", file=sys.stderr)
            await ws.send_json(
                {
                    "type": "sub_session_created",
                    "payload": {
                        "sub_session_id": sub.session_id,
                        "parent_session_id": parent_session_id,
                        "task": task,
                        "name": name[:100] if name else "",
                    },
                }
            )
            print(
                "[call_sub_agent] sub_session_created sent, awaiting pending_result...",
                file=sys.stderr,
            )

        if async_enabled:
            manager = _get_deferred_run_manager(app_state)
            manager.recover(
                lambda recovered_run: self._recovered_executor(
                    recovered_run, app_state, sm
                )
            )
            run = manager.store.submit(
                parent_session_id=parent_session_id,
                parent_turn_id=delegation_context.parent_turn_id,
                task=task,
                input_summary=_task_summary(task),
                delegation_snapshot=_context_snapshot(delegation_context),
                deadline_at=time.time() + delegation_context.remaining_seconds(),
                retryable=True,
            )
            try:
                from agent.audit_log import log_subagent_run_event

                log_subagent_run_event(
                    run.run_id,
                    "submitted",
                    parent_session_id=run.parent_session_id,
                    parent_turn_id=run.parent_turn_id,
                )
            except Exception:
                logger.debug("Failed to audit deferred sub-agent submission", exc_info=True)

            async def execute(_run) -> str:
                return await self._run_background(
                    sub, task, app_state, delegation_context
                )

            manager.submit(run, execute)
            if _subagent_stream_on_demand_enabled():
                # The card's REST reads remain lazy; this event only supplies
                # a handle to the parent turn when the opt-in UI is enabled.
                await ws.send_json(
                    {
                        "type": "deferred_subagent_submitted",
                        "payload": {
                            "run_id": run.run_id,
                            "parent_session_id": parent_session_id,
                            "sub_session_id": sub.session_id,
                            "status": run.status,
                            "name": name[:100] if name else "",
                        },
                    }
                )
            return format_success(
                {
                    "run_id": run.run_id,
                    "sub_session_id": sub.session_id,
                    "status": "queued" if run.status == "queued" else run.status,
                    "summary": "子 Agent 已在后台执行；可通过 run_id 查询结果。",
                }
            )

        # 3. 等待 sub-agent 执行完成
        #    sub-agent 由前端连接 sub-session WS 后自动启动
        #    或在前端未连接时由超时触发后台执行
        try:
            # 等待前端连接并触发 auto-start（最多等 10 秒）
            try:
                wait_timeout = delegation_context.frontend_wait_seconds(120)
                if wait_timeout <= 0:
                    raise asyncio.TimeoutError
                final_answer = await asyncio.wait_for(sub._pending_result, timeout=wait_timeout)
                print(
                    f"[call_sub_agent] pending_result resolved, answer len={len(final_answer)}",
                    file=sys.stderr,
                )
            except asyncio.TimeoutError:
                print(
                    "[call_sub_agent] timeout waiting for pending_result (120s), trying background...",
                    file=sys.stderr,
                )
                # 如果前端一直未连接，后端直接执行（无 WS streaming）
                if not sub._pending_result.done():
                    # 尝试后台执行
                    final_answer = await self._run_background(sub, task, app_state, delegation_context)
                    print(
                        f"[call_sub_agent] background done, answer len={len(final_answer)}",
                        file=sys.stderr,
                    )
                else:
                    print(
                        "[call_sub_agent] pending_result done during timeout, re-raising",
                        file=sys.stderr,
                    )
                    raise

            print("[call_sub_agent] returning success", file=sys.stderr)
            return format_success(
                {
                    "sub_session_id": sub.session_id,
                    "answer": final_answer,
                }
            )
        except asyncio.CancelledError:
            print("[call_sub_agent] cancelled", file=sys.stderr)
            # 主 Agent 被取消 → 取消 sub-agent
            if sub._active_task and not sub._active_task.done():
                sub._active_task.cancel()
            if sub._pending_result and not sub._pending_result.done():
                sub._pending_result.cancel()
            return format_error("主任务被取消，子 Agent 已终止")
        except Exception as e:
            print(f"[call_sub_agent] error: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return format_error(f"子 Agent 执行失败: {str(e)}")

    async def _run_background(self, sub, task: str, app_state, delegation_context=None) -> str:
        """后端直接执行（无前端连接时的回退路径）。

        使用 oh-my-pi sidecar 执行子任务，不再依赖 LangGraph。
        """
        print(
            f"[call_sub_agent] _run_background starting for {sub.session_id}",
            file=sys.stderr,
        )

        context = delegation_context or getattr(sub, "delegation_context", None)
        if context is None:
            context = create_delegation_context(app_state, getattr(sub, "parent_session_id", None))
        if context.remaining_seconds() <= 0:
            raise TimeoutError("子 Agent 的委托时间预算已耗尽")

        system_prompt = build_system_prompt()

        # 使用 oh-my-pi sidecar 执行
        sidecar_mgr = getattr(app_state, "sidecar_manager", None)
        if sidecar_mgr is None:
            raise RuntimeError("子 Agent 不可用：SidecarManager 未初始化")

        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is None:
            raise RuntimeError("子 Agent 不可用：Sidecar client 未就绪")

        model_str = ""
        if context.provider_id and context.model_name:
            model_str = f"{context.provider_id}/{context.model_name}"

        try:
            # 创建 sidecar session
            result = await client.call("create_session", {
                "model": model_str or "gpt-4o",
                "system_prompt": system_prompt,
                "cwd": ".",
            })
            sidecar_sid = result["session_id"]

            # 执行 prompt，等待结果
            turn_done = asyncio.Event()
            final_answer = ""

            async def _on_answer(sid: str, event: dict):
                nonlocal final_answer
                if sid != sidecar_sid:
                    return
                final_answer = event.get("payload", {}).get("content", "")

            async def _on_done(sid: str, event: dict):
                if sid != sidecar_sid:
                    return
                turn_done.set()

            unsub_answer = client.on("answer", _on_answer)
            unsub_done = client.on("done", _on_done)

            try:
                await client.call("prompt", {
                    "session_id": sidecar_sid,
                    "message": task,
                })
                timeout = context.remaining_seconds() or 600
                await asyncio.wait_for(turn_done.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("[call_sub_agent] sidecar timed out for sub %s", sub.session_id[:8])
                try:
                    await client.call("cancel", {"session_id": sidecar_sid})
                except Exception:
                    pass
                if not final_answer:
                    raise TimeoutError("子 Agent 超过委托时间预算")
            finally:
                unsub_answer()
                unsub_done()

            # 清理 sidecar session
            try:
                await client.call("destroy_session", {"session_id": sidecar_sid})
            except Exception:
                pass

        except Exception as e:
            print(f"[call_sub_agent] _run_background failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise

        print(
            f"[call_sub_agent] _run_background got answer: {final_answer[:100] if final_answer else '(empty)'}",
            file=sys.stderr,
        )

        if final_answer:
            sub.message_count += 2
            sub._pending_result.set_result(final_answer)
        else:
            sub._pending_result.set_exception(RuntimeError("子 Agent 未能产生有效回答"))

        return final_answer

    def _recovered_executor(self, run, app_state, session_manager):
        """Build a safe retry closure from a durable, serializable snapshot."""
        async def execute(_claimed_run) -> str:
            context = _restore_context_from_snapshot(run.delegation_snapshot, run, app_state)
            sub = await session_manager.create_sub_session(
                task=run.task,
                parent_session_id=run.parent_session_id,
            )
            sub.delegation_context = context
            return await self._run_background(sub, run.task, app_state, context)

        return execute


def _async_subagent_enabled() -> bool:
    try:
        from config.settings import get_settings

        # getattr keeps the legacy synchronous path when a pre-Phase-2
        # settings object is still in use during an incremental deployment.
        return bool(getattr(get_settings(), "async_subagent_enabled", False))
    except Exception:
        return False


def _subagent_stream_on_demand_enabled() -> bool:
    """Expose lazy child-run UI only after async delegation is enabled."""
    if not _async_subagent_enabled():
        return False
    try:
        from config.settings import get_settings

        return bool(get_settings().subagent_stream_on_demand_enabled)
    except Exception:
        return False


def _get_deferred_run_manager(app_state) -> DeferredRunManager:
    manager = getattr(app_state, "deferred_subagent_run_manager", None)
    if manager is not None:
        return manager
    from app_paths import API_DATA_DIR

    manager = DeferredRunManager(
        DeferredResultStore(API_DATA_DIR / "deferred_subagent_runs.sqlite")
    )
    setattr(app_state, "deferred_subagent_run_manager", manager)
    session_manager = getattr(app_state, "session_manager", None)
    bind = getattr(session_manager, "set_deferred_run_manager", None)
    if callable(bind):
        bind(manager)
    return manager


def _context_snapshot(context) -> dict[str, object]:
    """Persist only serializable execution identity, never a model/client object."""
    return {
        "provider_id": context.provider_id,
        "model_name": context.model_name,
        "allowed_tools": sorted(context.allowed_tools),
        "allowed_paths": sorted(context.allowed_paths),
        "max_tokens": context.max_tokens,
        "time_limit_seconds": context.time_limit_seconds,
        "trace_id": context.trace_id,
        "parent_turn_id": context.parent_turn_id,
        "enforce_scope": context.enforce_scope,
        "auto_approve": context.auto_approve,
    }


def _task_summary(task: str) -> str:
    normalized = " ".join(task.split())
    return normalized[:500]


def _restore_context_from_snapshot(snapshot: dict[str, object], run, app_state):
    """Rebind the exact persisted provider/model pair; never silently fallback."""
    provider_id = str(snapshot.get("provider_id") or "")
    model_name = str(snapshot.get("model_name") or "")
    model = None
    if provider_id and model_name:
        manager = getattr(app_state, "provider_manager", None)
        if manager is None:
            raise RuntimeError("provider_snapshot_unavailable")
        try:
            provider = manager.get(provider_id)
            model = provider.create_llm(model_name, temperature=0.7, streaming=True)
        except (KeyError, AttributeError, TypeError, ValueError) as exc:
            raise RuntimeError("provider_snapshot_unavailable") from exc
    else:
        candidate = getattr(app_state, "llm", None)
        if candidate is None or (model_name and _model_name(candidate) != model_name):
            raise RuntimeError("provider_snapshot_unavailable")
        model = candidate

    from tools.sub_agent.delegation_context import DelegationContext

    remaining = max(0.0, float(run.deadline_at or time.time()) - time.time())
    return DelegationContext(
        model=model,
        provider_id=provider_id,
        model_name=model_name,
        allowed_tools=frozenset(),
        allowed_paths=frozenset(),
        max_tokens=int(snapshot.get("max_tokens") or 0),
        time_limit_seconds=int(remaining),
        trace_id=str(snapshot.get("trace_id") or ""),
        parent_turn_id=run.parent_turn_id,
        deadline_monotonic=time.monotonic() + remaining,
        enforce_scope=True,
        auto_approve=False,
    )


def _model_name(model) -> str:
    for attribute in ("model_name", "model"):
        value = getattr(model, attribute, None)
        if isinstance(value, str) and value:
            return value
    return ""
