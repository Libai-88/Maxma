"""会话状态管理 — 多会话隔离 + TTL 过期清理。"""

import asyncio
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from typing import Any


@dataclass
class SessionState:
    session_id: str
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    message_count: int = 0
    _active_task: asyncio.Task | None = field(default=None, repr=False)
    # 阶段 5.1：使用持久化 checkpointer（AsyncSqliteSaver 或 MemorySaver 回退）
    # default_factory 延迟导入避免循环依赖，且保证测试环境无 SQLite 时可用
    checkpointer: Any = field(default=None)
    _graph: Any | None = field(default=None, repr=False)
    auto_approve: bool = False
    # Keep the selected permission state on the session.  This is deliberately
    # limited to a mode and timestamp so const-session persistence stays secret-free.
    permission_mode: str = "ask"
    permission_mode_updated_at: float = field(default_factory=time.time)

    # ── Sub-agent 字段 ─────────────────────────────────────
    is_subagent: bool = False
    parent_session_id: str | None = None
    _sub_agent_task: str | None = field(default=None, repr=False)
    _pending_result: asyncio.Future | None = field(default=None, repr=False)

    # ── Const 固定会话字段 ──────────────────────────────────
    is_const: bool = False
    const_name: str = ""

    # ── 项目上下文缓存 ──────────────────────────────────────
    _project_context: str | None = field(default=None, repr=False)
    _project_path: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        """初始化后处理：若未显式提供 checkpointer，使用持久化 checkpointer 单例。

        工厂不可导入时（如测试环境）回退到 MemorySaver。
        """
        if self.checkpointer is None:
            try:
                from api.checkpointer_factory import get_persistent_checkpointer
                self.checkpointer = get_persistent_checkpointer()
            except Exception:
                try:
                    from langgraph.checkpoint.memory import MemorySaver
                    self.checkpointer = MemorySaver()
                except ImportError:
                    self.checkpointer = None

        # Older const-session metadata has no permission mode.  Invalid stored
        # values fail closed to the compatible, confirmation-first default.
        try:
            from agent.permission_policy import parse_permission_mode

            self.permission_mode = parse_permission_mode(self.permission_mode).value
        except (ImportError, ValueError):
            self.permission_mode = "ask"

    def persistent_metadata(self) -> dict[str, Any]:
        """Return the non-secret metadata supported by const-session storage."""
        return {
            "created_at": self.created_at,
            "last_active": self.last_active,
            "message_count": self.message_count,
            "permission_mode": self.permission_mode,
            "permission_mode_updated_at": self.permission_mode_updated_at,
        }

    def set_permission_mode(self, permission_mode: str) -> str:
        """Validate and update the selected mode before it is persisted."""
        from agent.permission_policy import parse_permission_mode

        self.permission_mode = parse_permission_mode(permission_mode).value
        self.permission_mode_updated_at = time.time()
        return self.permission_mode


class SessionManager:
    def __init__(self, ttl_seconds: int = 1800):
        self._sessions: dict[str, SessionState] = {}
        self._ttl = ttl_seconds
        self._lock = asyncio.Lock()

    async def create(self) -> SessionState:
        session_id = uuid.uuid4().hex
        session = SessionState(session_id=session_id)
        async with self._lock:
            self._sessions[session_id] = session
        return session

    def set_deferred_run_manager(self, manager: Any) -> None:
        """Bind the optional Phase-2 dispatcher without importing its module."""
        self._deferred_run_manager = manager

    def set_workflow_run_manager(self, manager: Any) -> None:
        """Bind the opt-in workflow dispatcher without importing its module."""
        self._workflow_run_manager = manager

    async def create_sub_session(
        self,
        task: str,
        parent_session_id: str | None = None,
    ) -> SessionState:
        """创建 sub-agent 会话，携带任务文本和 pending future。"""
        session_id = uuid.uuid4().hex
        session = SessionState(
            session_id=session_id,
            is_subagent=True,
            parent_session_id=parent_session_id,
            _sub_agent_task=task,
            _pending_result=asyncio.Future(),
        )
        async with self._lock:
            self._sessions[session_id] = session
        return session

    async def get(self, session_id: str) -> SessionState | None:
        async with self._lock:
            session = self._sessions.get(session_id)
        if session is not None:
            session.last_active = time.time()
        return session

    async def get_or_create(self, session_id: str) -> SessionState:
        session = await self.get(session_id)
        if session is None:
            session = SessionState(session_id=session_id)
            async with self._lock:
                existing = self._sessions.get(session_id)
                if existing is not None:
                    existing.last_active = time.time()
                    return existing
                self._sessions[session_id] = session
        return session

    async def delete(self, session_id: str) -> bool:
        # 修复：删除前必须取消运行中的 _active_task，否则会留下孤儿 Agent 任务：
        # 任务继续运行、继续向 WS 推送事件、继续消耗 LLM 配额，且 session 对象
        # 因任务闭包持有引用而无法被 GC，最终导致资源泄漏。
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return False
            task = session._active_task
            session._active_task = None
            del self._sessions[session_id]
        # 在锁外取消任务，避免锁内 await 引起的复杂时序问题
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        run_manager = getattr(self, "_deferred_run_manager", None)
        if run_manager is not None:
            try:
                await run_manager.cancel_parent(session_id)
            except Exception:
                # Session deletion must remain available even if a durable
                # dispatcher has already been shut down during application exit.
                pass
        workflow_manager = getattr(self, "_workflow_run_manager", None)
        if workflow_manager is not None:
            try:
                await workflow_manager.cancel_parent(session_id, "parent_session_closed")
            except Exception:
                # A session must still be removable while a workflow runtime is
                # stopping or has already released its journal connection.
                pass
        return True

    async def list_sessions(self) -> list[dict]:
        async with self._lock:
            sessions = list(self._sessions.values())
        result = []
        for s in sessions:
            has_active = s._active_task is not None and not s._active_task.done()
            result.append(
                {
                    "session_id": s.session_id,
                    "message_count": s.message_count,
                    "created_at": s.created_at,
                    "last_active": s.last_active,
                    "has_active_agent": has_active,
                    "is_subagent": s.is_subagent,
                    "is_const": s.is_const,
                    "const_name": s.const_name,
                }
            )
        result.sort(key=lambda x: x["last_active"] if isinstance(x["last_active"], (int, float)) else 0.0, reverse=True)
        return result

    async def cleanup_expired(self) -> int:
        """清理过期会话。所有判断与删除在锁内完成，避免检查与清理之间状态变化导致误删。"""
        now = time.time()
        expired_count = 0
        async with self._lock:
            # 使用 list() 复制键值，避免遍历期间修改 dict
            for sid, s in list(self._sessions.items()):
                if s.is_const:
                    continue
                if s._active_task is not None and not s._active_task.done():
                    # 活跃任务只有在超过 TTL 后才强制取消（防止卡住任务永久泄漏）
                    if now - s.last_active > self._ttl:
                        s._active_task.cancel()
                        self._sessions.pop(sid, None)
                        expired_count += 1
                    continue
                if now - s.last_active > self._ttl:
                    self._sessions.pop(sid, None)
                    expired_count += 1
        return expired_count

    async def session_count(self) -> int:
        """返回当前活跃会话数（不含子 Agent）。"""
        async with self._lock:
            sessions = list(self._sessions.values())
        return sum(
            1 for s in sessions
            if not s.is_subagent
        )
