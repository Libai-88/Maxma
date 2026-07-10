"""审批工具节点 —— 包装 LangGraph ToolNode，在执行前拦截需审批的工具。

复用 interaction.py 的 register/resolve 机制进行异步等待，
复用 ask_user WS 事件推送审批请求到前端。
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt import ToolNode

from agent.approval_gateway import approval_gateway, ApprovalDecision
from api.activity_hub import activity_hub

logger = logging.getLogger(__name__)


class ApprovalToolNode:
    """包装 ToolNode，添加审批拦截层。

    工作流程：
    1. 从 state 提取 tool_calls
    2. 对每个 tool_call 检查是否需要审批
    3. 需要审批时：通过 interaction.register 注册 Future + WS 推送 approval_request
    4. 等待用户响应（approve/reject）
    5. approved → 执行工具；rejected → 返回拒绝 ToolMessage
    6. 无需审批 → 直接执行
    """

    def __init__(self, tools: list):
        """初始化。

        Args:
            tools: 工具列表
        """
        self._inner_node = ToolNode(tools)

    async def __call__(self, state: dict, config: dict | None = None) -> dict:
        """执行工具调用，带审批拦截。"""
        messages = state.get("messages", [])
        if not messages:
            return {"messages": []}

        last_message = messages[-1]
        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            # 无 tool_calls，直接透传给内部 ToolNode（传 config 保留 callbacks）
            return await self._inner_node.ainvoke(state, config)

        # 获取会话 ID
        from api.interaction import current_session_id
        session_id = ""
        try:
            session_id = current_session_id.get() or ""
        except LookupError:
            # ContextVar 未设置时返回默认值 ""
            session_id = ""
        except Exception:
            session_id = ""

        # A delegated child captures approval policy when it is created.  Its
        # parent may subsequently change session settings, but that must not
        # broaden a running child's authority.
        from tools.sub_agent.delegation_context import current_delegation_context

        delegation_context = current_delegation_context()
        if delegation_context is not None:
            auto_approve = delegation_context.auto_approve
        else:
            from api.interaction import get_session_auto_approve
            try:
                auto_approve = get_session_auto_approve(session_id)
            except Exception:
                auto_approve = False

        tool_messages: list[ToolMessage] = []

        for tool_call in last_message.tool_calls:
            tool_name = tool_call["name"]
            tool_input = tool_call.get("args", {}) or {}
            tool_call_id = tool_call["id"]

            if approval_gateway.needs_approval(tool_name, session_id, auto_approve):
                # 需要审批
                decision = await self._request_approval(
                    tool_name, tool_input, session_id, tool_call_id
                )

                if decision in (ApprovalDecision.APPROVED, ApprovalDecision.AUTO_APPROVED):
                    # 批准或自动放行 → 执行单个工具（传 config 保留 callbacks）
                    single_state = {
                        **state,
                        "messages": [AIMessage(content="", tool_calls=[tool_call])],
                    }
                    try:
                        result = await self._inner_node.ainvoke(single_state, config)
                        if result.get("messages"):
                            tool_messages.extend(result["messages"])
                    except Exception as e:
                        logger.exception("Approved tool execution failed: %s", tool_name)
                        tool_messages.append(ToolMessage(
                            content=f"[工具执行错误] {tool_name}: {e}",
                            tool_call_id=tool_call_id,
                        ))

                elif decision == ApprovalDecision.REJECTED:
                    # 拒绝 → 返回拒绝消息
                    tool_messages.append(ToolMessage(
                        content=f"[用户拒绝执行] 工具 {tool_name} 被用户拒绝。请改用其他方式或询问用户。",
                        tool_call_id=tool_call_id,
                    ))
                    activity_hub.add(
                        category="approval",
                        event_type="approval_rejected",
                        session_id=session_id,
                        tool_name=tool_name,
                        level="warn",
                        message=f"用户拒绝执行工具：{tool_name}",
                    )

                else:
                    # 超时（TIMEOUT）或其他未知状态
                    tool_messages.append(ToolMessage(
                        content=f"[审批超时] 工具 {tool_name} 审批超时，已跳过。",
                        tool_call_id=tool_call_id,
                    ))
                    activity_hub.add(
                        category="approval",
                        event_type="approval_timeout",
                        session_id=session_id,
                        tool_name=tool_name,
                        level="warn",
                        message=f"工具审批超时：{tool_name}",
                    )

            else:
                # 无需审批 → 直接执行单个工具（传 config 保留 callbacks）
                single_state = {
                    **state,
                    "messages": [AIMessage(content="", tool_calls=[tool_call])],
                }
                try:
                    result = await self._inner_node.ainvoke(single_state, config)
                    if result.get("messages"):
                        tool_messages.extend(result["messages"])
                except Exception as e:
                    logger.exception("Tool execution failed: %s", tool_name)
                    tool_messages.append(ToolMessage(
                        content=f"[工具执行错误] {tool_name}: {e}",
                        tool_call_id=tool_call_id,
                    ))

        return {"messages": tool_messages}

    async def _request_approval(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
        tool_call_id: str,
    ) -> ApprovalDecision:
        """发送审批请求并等待用户响应。"""
        from config.settings import get_settings
        from api.interaction import register, resolve, current_ws

        # 无 WebSocket 上下文（如事件钩子场景）时直接放行，避免静默拒绝
        try:
            current_ws.get()
        except LookupError:
            return ApprovalDecision.AUTO_APPROVED
        except Exception:
            return ApprovalDecision.AUTO_APPROVED

        settings = get_settings()

        # 创建审批请求
        request = approval_gateway.create_request(
            tool_name=tool_name,
            tool_input=tool_input,
            session_id=session_id,
        )

        # 生成 interaction_id
        interaction_id = str(uuid.uuid4())

        # 记录到 Activity Hub
        activity_hub.add(
            category="approval",
            event_type="approval_requested",
            session_id=session_id,
            tool_name=tool_name,
            message=f"请求审批工具：{tool_name}（{request.reason}）",
            payload={
                "interaction_id": interaction_id,
                "risk_level": request.risk_level,
                "tool_input_preview": {k: str(v)[:200] for k, v in tool_input.items()},
            },
        )

        # 通过 interaction 注册 Future（register 是 async，返回 (id, future)）
        try:
            resolved_id, future = await register(session_id, interaction_id)
        except Exception as e:
            logger.exception("Failed to register approval interaction: %s", e)
            return ApprovalDecision.REJECTED

        # 通过 WS 推送审批请求
        try:
            ws = current_ws.get()
        except LookupError:
            ws = None
        except Exception:
            ws = None

        if ws is None:
            logger.error("No WebSocket in context, cannot send approval request")
            # 没有可用 WS，立即取消挂起的 Future 并返回拒绝
            try:
                await resolve(resolved_id, "no")
            except Exception:
                pass
            return ApprovalDecision.REJECTED

        try:
            await ws.send_json({
                "type": "ask_user",
                "payload": {
                    "tool_name": tool_name,
                    "interaction_id": resolved_id,
                    "mode": "approval",
                    "question": f"是否允许执行 {tool_name}？",
                    "detail": request.reason,
                    "risk_level": request.risk_level,
                    "tool_input": tool_input,
                    "options": [
                        {"label": "允许执行", "value": "yes"},
                        {"label": "拒绝", "value": "no"},
                    ],
                },
            })
        except Exception as e:
            logger.error("Failed to send approval request via WS: %s", e)
            try:
                await resolve(resolved_id, "no")
            except Exception:
                pass
            return ApprovalDecision.REJECTED

        # 等待用户响应
        try:
            response = await asyncio.wait_for(future, timeout=settings.approval_timeout)
        except TimeoutError:
            # 超时后清理挂起的 Future，防止内存泄漏
            from api.interaction import cleanup
            try:
                await cleanup(resolved_id)
            except Exception:
                pass
            return ApprovalDecision.TIMEOUT
        except Exception as e:
            logger.error("Approval wait failed: %s", e)
            from api.interaction import cleanup
            try:
                await cleanup(resolved_id)
            except Exception:
                pass
            return ApprovalDecision.REJECTED

        # 判断响应（兼容多种 yes 表达）
        if isinstance(response, str) and response.lower() in (
            "yes", "y", "approve", "approved", "允许", "确认",
        ):
            return ApprovalDecision.APPROVED
        return ApprovalDecision.REJECTED
