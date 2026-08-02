"""WebSocket 协议常量 — Maxma ↔ 前端 WS 契约。

定义事件类型和消息类型的标准枚举，替代字符串字面量以提升类型安全。
"""

from enum import Enum


class WsEventType(str, Enum):
    """Sidecar → 前端的事件类型（streaming events）。"""

    # 流式输出事件
    THINKING_START = "thinking_start"
    THINKING_DELTA = "thinking_delta"
    TOKEN = "token"
    THINKING_END = "thinking_end"

    # 工具调用事件
    TOOL_START = "tool_start"
    TOOL_UPDATE = "tool_update"
    TOOL_END = "tool_end"
    TOOL_ERROR = "tool_error"

    # 完成与错误
    ANSWER = "answer"
    DONE = "done"
    ERROR = "error"

    # 交互与上下文
    ASK_USER = "ask_user"
    CONTEXT_COMPRESSED = "context_compressed"
    CONTEXT_COMPRESSING = "context_compressing"

    # 重试与通知
    RETRY_START = "retry_start"
    RETRY_END = "retry_end"
    TODO_REMINDER = "todo_reminder"
    NOTICE = "notice"
    IRC_MESSAGE = "irc_message"

    # 子 Agent / 子会话
    SUB_SESSION_CREATED = "sub_session_created"
    DEFERRED_SUBAGENT_SUBMITTED = "deferred_subagent_submitted"

    # Plan mode events — 由后端 chat.py 透传 sidecar 事件
    PLAN_PROPOSED = "plan_proposed"
    PLAN_STEP_START = "plan_step_start"
    PLAN_STEP_END = "plan_step_end"
    PLAN_STEP_ERROR = "plan_step_error"
    PLAN_COMPLETED = "plan_completed"

    # 记忆事件（sidecar 发射时透传）
    MEMORY_START = "memory_start"
    MEMORY_TOOL_START = "memory_tool_start"
    MEMORY_TOOL_END = "memory_tool_end"
    MEMORY_TOOL_ERROR = "memory_tool_error"
    MEMORY_DONE = "memory_done"

    # 上下文用量（独立事件形式）
    # 实际用量通过两条路径达前端：
    #   1. done.payload.context_usage 内嵌字段（有效路径）
    #   2. REST GET /api/sessions/{sid}/context-usage（查询接口）
    CONTEXT_USAGE = "context_usage"

    # Artifact 事件 — 由后端 TOOL_END 检测写文件工具后合成（Phase 2.2）
    ARTIFACT = "artifact"

    # Workflow 引擎事件 — 由 workflows.py 执行引擎推送（Phase 3.5）
    WORKFLOW_STEP_START = "workflow_step_start"
    WORKFLOW_STEP_END = "workflow_step_end"
    WORKFLOW_STEP_ERROR = "workflow_step_error"
    WORKFLOW_COMPLETED = "workflow_completed"


class WsMessageType(str, Enum):
    """前端 → Maxma 的消息类型（client commands）。"""

    # 基础控制
    PING = "ping"
    CHAT = "chat"
    CANCEL = "cancel"

    # 交互响应
    USER_RESPONSE = "user_response"

    # 已接通功能：plan_response → plan_action RPC，artifact_action → 后端处理，update_auto_approve → set_auto_approve RPC
    PLAN_RESPONSE = "plan_response"
    ARTIFACT_ACTION = "artifact_action"
    UPDATE_AUTO_APPROVE = "update_auto_approve"


# 便捷集合（向后兼容现有 frozenset 用法）
SIDECAR_EVENT_TYPES = frozenset(t.value for t in WsEventType)
CLIENT_MESSAGE_TYPES = frozenset(t.value for t in WsMessageType)
