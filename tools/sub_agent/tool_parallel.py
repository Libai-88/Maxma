"""Tool: parallel_execute — 并行启动多个子 Agent 执行独立任务并聚合结果。"""

import asyncio
import json
import logging
import sys
import traceback

from pydantic import BaseModel, Field

from api import interaction
from tools.base import ToolBase, format_success, format_error

logger = logging.getLogger(__name__)

# 复用 call_sub_agent 的深度追踪逻辑
_MAX_PARALLEL_TASKS = 5
_PARALLEL_TIMEOUT = 180  # 秒


class ParallelExecuteInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    tasks: str = Field(
        description=(
            "JSON 数组字符串，每个元素包含：\n"
            '{"task": "任务描述", "name": "可选显示名称"}\n'
            "例如：[{\"task\": \"搜索 Python 3.12 新特性\", \"name\": \"搜索 Python\"}, "
            "{\"task\": \"分析项目架构\", \"name\": \"架构分析\"}]"
        )
    )


class ParallelExecuteTool(ToolBase):
    name: str = "parallel_execute"
    description: str = (
        "并行启动多个子 Agent 执行独立任务，等待全部完成后聚合结果返回。"
        "适用于可拆分为多个独立子任务的场景，例如同时搜索多个主题、"
        "同时分析多个文件、同时执行多个不相关的查询等。"
        "每个子任务拥有独立的上下文窗口和工具调用能力。"
        "[调用积极性: 当任务可明确拆分为独立子任务时积极调用] [get_doc: 使用前必须 get_doc]"
    )
    args_schema: type[BaseModel] = ParallelExecuteInput

    def _run(self, get_doc: bool = False, tasks: str = "") -> str:
        raise NotImplementedError("parallel_execute 仅支持异步模式")

    async def _arun(self, get_doc: bool = False, tasks: str = "") -> str:
        if get_doc:
            return self._load_doc()
        if not tasks.strip():
            return format_error("tasks 不能为空")

        # 解析 JSON
        try:
            task_list = json.loads(tasks)
        except json.JSONDecodeError as e:
            return format_error(f"tasks 不是合法的 JSON 数组: {e}")

        if not isinstance(task_list, list) or len(task_list) == 0:
            return format_error("tasks 必须是非空 JSON 数组")

        if len(task_list) > _MAX_PARALLEL_TASKS:
            return format_error(
                f"并行任务数不能超过 {_MAX_PARALLEL_TASKS}，当前: {len(task_list)}"
            )

        # 校验每个任务
        for i, item in enumerate(task_list):
            if not isinstance(item, dict) or not item.get("task", "").strip():
                return format_error(f"第 {i + 1} 个任务缺少 task 字段或为空")

        return await self._do_run(task_list)

    async def _do_run(self, task_list: list[dict]) -> str:
        # 获取 WebSocket 上下文
        try:
            ws = interaction.current_ws.get()
        except LookupError:
            return format_error("内部错误: WebSocket 上下文丢失，无法创建并行子会话")
        except Exception as e:
            return format_error(f"内部错误: current_ws 异常: {e}")

        app_state = ws.app.state
        sm = app_state.session_manager

        # 确定 parent_session_id
        parent_session_id = None
        try:
            path = str(getattr(ws, "url", getattr(ws, "path", "")))
            if "/ws/chat/" in path:
                parent_session_id = path.rsplit("/ws/chat/", 1)[-1]
        except Exception:
            logger.debug("Failed to parse parent_session_id from WebSocket URL", exc_info=True)

        # 为每个任务创建 sub-session
        sub_sessions = []
        for item in task_list:
            task_desc = item["task"].strip()
            name = item.get("name", "").strip()
            sub = sm.create_sub_session(
                task=task_desc,
                parent_session_id=parent_session_id,
            )
            sub_sessions.append({
                "sub": sub,
                "task": task_desc,
                "name": name,
            })

        # 通知前端所有子会话已创建
        await ws.send_json({
            "type": "parallel_sessions_created",
            "payload": {
                "parent_session_id": parent_session_id,
                "sessions": [
                    {
                        "sub_session_id": s["sub"].session_id,
                        "task": s["task"],
                        "name": s["name"][:100] if s["name"] else "",
                    }
                    for s in sub_sessions
                ],
            },
        })

        # 并行等待所有子 Agent 完成
        async def _wait_for_sub(entry: dict) -> dict:
            sub = entry["sub"]
            task_desc = entry["task"]
            name = entry["name"]
            try:
                answer = await asyncio.wait_for(
                    sub._pending_result, timeout=_PARALLEL_TIMEOUT
                )
                return {"name": name, "task": task_desc, "status": "ok", "answer": answer}
            except asyncio.TimeoutError:
                # 超时 → 尝试后台执行
                if not sub._pending_result.done():
                    try:
                        answer = await self._run_background(sub, task_desc, app_state)
                        return {"name": name, "task": task_desc, "status": "ok", "answer": answer}
                    except Exception as bg_err:
                        return {"name": name, "task": task_desc, "status": "error", "error": str(bg_err)}
                return {"name": name, "task": task_desc, "status": "timeout", "error": f"超时 ({_PARALLEL_TIMEOUT}s)"}
            except asyncio.CancelledError:
                if sub._active_task and not sub._active_task.done():
                    sub._active_task.cancel()
                return {"name": name, "task": task_desc, "status": "cancelled"}
            except Exception as e:
                return {"name": name, "task": task_desc, "status": "error", "error": str(e)}

        print(
            f"[parallel_execute] launching {len(sub_sessions)} tasks in parallel",
            file=sys.stderr,
        )

        results = await asyncio.gather(
            *[_wait_for_sub(entry) for entry in sub_sessions],
            return_exceptions=False,
        )

        # 聚合结果
        ok_count = sum(1 for r in results if r["status"] == "ok")
        err_count = len(results) - ok_count

        print(
            f"[parallel_execute] done: {ok_count} ok, {err_count} failed",
            file=sys.stderr,
        )

        return format_success({
            "total": len(results),
            "succeeded": ok_count,
            "failed": err_count,
            "results": results,
        })

    async def _run_background(self, sub, task: str, app_state) -> str:
        """后端直接执行（无前端连接时的回退路径）。"""
        from agent.graph import build_agent
        from agent.prompts import build_system_prompt
        from langchain_core.messages import HumanMessage
        from langchain_core.runnables import RunnableConfig

        system_prompt = build_system_prompt()
        agent = build_agent(
            model=app_state.llm,
            tools=app_state.tools,
            system_prompt=system_prompt,
            checkpointer=sub.checkpointer,
        )
        inputs = {"messages": [HumanMessage(content=task)]}
        config: RunnableConfig = {
            "configurable": {"thread_id": sub.session_id},
            "recursion_limit": 72,
        }

        final_answer = ""
        try:
            async for event in agent.astream_events(
                inputs, config=config, version="v2"
            ):
                if (
                    event.get("event") == "on_chain_end"
                    and event.get("name") == "agent"
                ):
                    output: dict = event["data"].get("output", {})
                    messages = output.get("messages", [])
                    if messages:
                        last = messages[-1]
                        final_answer = (
                            last.content if hasattr(last, "content") else str(last)
                        )

            if not final_answer:
                try:
                    cpt = await sub.checkpointer.aget_tuple(config)
                    if cpt is not None:
                        messages = cpt.checkpoint.get("channel_values", {}).get(
                            "messages", []
                        )
                        if messages:
                            last = messages[-1]
                            candidate = (
                                last.content if hasattr(last, "content") else str(last)
                            )
                            if candidate:
                                final_answer = candidate
                except Exception:
                    logger.debug("Failed to read fallback final_answer from sub-agent checkpoint", exc_info=True)
        except Exception as e:
            print(f"[parallel_execute] _run_background failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            raise

        if final_answer:
            sub.message_count += 2
            sub._pending_result.set_result(final_answer)
        else:
            sub._pending_result.set_exception(RuntimeError("子 Agent 未能产生有效回答"))

        return final_answer
