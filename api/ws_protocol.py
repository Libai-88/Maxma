"""WebSocket 协议常量 — Maxma ↔ 前端 WS 契约。

定义事件类型和消息类型的标准枚举，替代字符串字面量以提升类型安全。

UNIMPLEMENTED 标注说明：
- 某些事件/消息类型在类型系统中定义，但当前 runtime 无发射端或处理逻辑。
- 保留这些类型以保持前后端契约完整性，并为未来接入预留接口。
- 详细的死事件原因见前端 web/src/types/index.ts 的对应 UNIMPLEMENTED 注释。
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

    # Plan mode events
    # 注：OMP SDK 不直接暴露 plan-mode 事件流。订阅保留以备 SDK 深接时
    # 无需改后端转发层。当前 sidecar 不发射这些事件。
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

    # 上下文用量（独立事件形式 UNIMPLEMENTED）
    # 实际用量通过两条路径达前端：
    #   1. done.payload.context_usage 内嵌字段（有效路径）
    #   2. REST GET /api/sessions/{sid}/context-usage（查询接口）
    CONTEXT_USAGE = "context_usage"


class WsMessageType(str, Enum):
    """前端 → Maxma 的消息类型（client commands）。"""

    # 基础控制
    PING = "ping"
    CHAT = "chat"
    CANCEL = "cancel"

    # 交互响应
    USER_RESPONSE = "user_response"

    # 保留接口（UNIMPLEMENTED - sidecar dispatcher 无对应 handler）
    # 前端 send 函数保留，接通只需后端加分支
    PLAN_RESPONSE = "plan_response"
    ARTIFACT_ACTION = "artifact_action"
    UPDATE_AUTO_APPROVE = "update_auto_approve"


# 便捷集合（向后兼容现有 frozenset 用法）
SIDECAR_EVENT_TYPES = frozenset(t.value for t in WsEventType)
CLIENT_MESSAGE_TYPES = frozenset(t.value for t in WsMessageType)
