"""交互注册表 — 管理 ask_user 系列工具的挂起与唤醒。

工具函数通过 register() 注册一个待交互，返回 interaction_id 和 Future；
前端通过 user_response 携带同一 ID 送达响应；
resolve() 唤醒挂起的 Future，工具函数继续执行返回结果。
"""

import asyncio
import contextvars
import uuid

from tools.base import format_error

# 当前连接对应的 WebSocket 实例（在 chat.py 中设置）
current_ws: contextvars.ContextVar = contextvars.ContextVar("current_ws")

# 当前会话 ID（在 chat.py 中设置），供工具函数查询会话级设置
current_session_id: contextvars.ContextVar = contextvars.ContextVar(
    "current_session_id", default=""
)

# 会话级 auto_approve 设置 —— 使用模块级 dict 而非 ContextVar，
# 以便 WebSocket 主循环在处理 update_auto_approve 消息时写入的值
# 能立即被正在运行的 Agent 任务中的工具函数读取到。
_settings: dict[str, bool] = {}  # session_id -> auto_approve


def set_session_auto_approve(session_id: str, value: bool) -> None:
    """设置指定会话的自动批准模式。所有 asyncio 任务共享此存储。"""
    _settings[session_id] = value


def get_session_auto_approve(session_id: str) -> bool:
    """获取指定会话的自动批准模式。不存在时返回 False（安全的默认值）。"""
    return _settings.get(session_id, False)


def clear_session_settings(session_id: str) -> None:
    """WebSocket 断开时清理会话设置，防止内存泄漏。"""
    _settings.pop(session_id, None)

# 全局待处理交互表：interaction_id → Future
_pending: dict[str, asyncio.Future] = {}
_pending_sessions: dict[str, str] = {}
_pending_by_session: dict[str, set[str]] = {}

# 保护上述全局状态在并发注册/取消/解析时的一致性
_lock = asyncio.Lock()


async def register(
    session_id: str | None = None,
    interaction_id: str | None = None,
) -> tuple[str, asyncio.Future]:
    """注册一次待处理的用户交互，返回 (interaction_id, future)。

    调用方可传入固定的 interaction_id（如 plan_id），用于需要前端
    通过已知 ID 回传响应的场景；未传入时随机生成 UUID。
    """
    async with _lock:
        resolved_id = interaction_id or uuid.uuid4().hex
        future: asyncio.Future = asyncio.Future()
        _pending[resolved_id] = future
        resolved_session_id = session_id if session_id is not None else current_session_id.get()
        if resolved_session_id:
            _pending_sessions[resolved_id] = resolved_session_id
            _pending_by_session.setdefault(resolved_session_id, set()).add(resolved_id)
        return resolved_id, future


async def resolve(interaction_id: str, response) -> bool:
    """用用户响应结果唤醒并解决挂起的 Future。返回是否成功。"""
    async with _lock:
        future = _pending.get(interaction_id)
        if not future:
            return False
        if future.done():
            return False
        future.set_result(response)
        return True


async def cleanup(interaction_id: str):
    """清理（超时或取消时调用）。"""
    async with _lock:
        _pending.pop(interaction_id, None)
        session_id = _pending_sessions.pop(interaction_id, None)
        if session_id:
            session_pending = _pending_by_session.get(session_id)
            if session_pending is not None:
                session_pending.discard(interaction_id)
                if not session_pending:
                    _pending_by_session.pop(session_id, None)


async def cancel_all(reason: str | None = None, session_id: str | None = None):
    """将挂起的交互 Future 以取消原因标记为已完成。

    默认保留历史兼容行为：无 session_id 时取消所有挂起交互。
    传入 session_id 时只取消该会话，避免影响其他会话的 ask_user / plan_proposed。
    """
    if reason is None:
        reason = "用户取消了该工具调用"
    formatted = format_error(reason)
    async with _lock:
        if session_id:
            interaction_ids = list(_pending_by_session.get(session_id, set()))
        else:
            interaction_ids = list(_pending.keys())

        for interaction_id in interaction_ids:
            future = _pending.get(interaction_id)
            if future is None:
                continue
            if not future.done():
                future.set_result(formatted)
            # 在持有锁的情况下同步清理，避免 await 导致锁释放期间状态变化
            _pending.pop(interaction_id, None)
            removed_session_id = _pending_sessions.pop(interaction_id, None)
            if removed_session_id:
                session_pending = _pending_by_session.get(removed_session_id)
                if session_pending is not None:
                    session_pending.discard(interaction_id)
                    if not session_pending:
                        _pending_by_session.pop(removed_session_id, None)


async def cancel_session(session_id: str, reason: str | None = None):
    """取消指定会话的挂起交互。"""
    await cancel_all(reason=reason, session_id=session_id)
