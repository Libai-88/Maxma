"""会话状态管理 — 多会话隔离 + TTL 过期清理。"""

import asyncio
import logging
from datetime import datetime
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


def _parse_sqlite_datetime(dt_str: str | None) -> float:
    """将 SQLite datetime 字符串（如 '2026-08-02 12:34:56'）转换为 Unix 时间戳。"""
    if not dt_str:
        return 0.0
    try:
        return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").timestamp()
    except (ValueError, TypeError):
        return 0.0


@dataclass
class SessionState:
    session_id: str
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    message_count: int = 0
    _active_task: asyncio.Task | None = field(default=None, repr=False)
    # oh-my-pi sidecar 模式下不需要 checkpointer
    _graph: Any | None = field(default=None, repr=False)
    auto_approve: bool = False
    # Keep the selected permission state on the session.  This is deliberately
    # limited to a mode and timestamp so const-session persistence stays secret-free.
    permission_mode: str = "yolo"
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

    # ── oh-my-pi sidecar 字段 ─────────────────────────────────
    _sidecar_mgr: Any = field(default=None, repr=False)
    _sidecar_session_id: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        """初始化后处理。

        oh-my-pi sidecar 模式下不需要 checkpointer。
        仅在 permission_mode 无效时回退到默认值。
        """
        VALID_MODES = {"ask", "auto", "operate", "read_only", "yolo"}
        if self.permission_mode not in VALID_MODES:
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
        """Validate and update the selected mode before it is persisted.
        
        permission_policy module removed — OMP replaces permission policy.
        """
        valid_modes = {"read_only", "ask", "operate", "auto"}
        if permission_mode not in valid_modes:
            raise ValueError(f"Unsupported permission mode: {permission_mode}")
        self.permission_mode = permission_mode
        self.permission_mode_updated_at = time.time()
        return self.permission_mode


class SessionManager:
    def __init__(self, ttl_seconds: int = 1800, session_map: Any = None):
        self._sessions: dict[str, SessionState] = {}
        self._ttl = ttl_seconds
        self._lock = asyncio.Lock()
        # 可注入的 SessionMap（测试隔离用）；None 时懒加载全局单例
        self._session_map = session_map

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

    async def _restore_from_session_map(self, session_id: str) -> SessionState | None:
        """尝试从持久化 SessionMap SQLite 恢复会话（后端重启后保留会话状态）。"""
        try:
            from api.const_session_store import load_const_session_by_id

            smap = self._session_map
            if smap is None:
                from api.pi_bridge.session_adapter import get_session_map
                smap = get_session_map()
            smap_sid = smap.get_sidecar_id(session_id)
            logger.info(
                "[session] _restore_from_session_map(%s): smap_sid=%s",
                session_id[:8], smap_sid[:8] if smap_sid else None,
            )
            if smap_sid is None:
                return None
            session = SessionState(session_id=session_id)
            session._sidecar_session_id = smap_sid
            session.is_const = smap.get_const(session_id)
            if session.is_const:
                try:
                    const_data = load_const_session_by_id(session_id)
                    if const_data:
                        session.const_name = const_data.get("const_name", "")
                except Exception:
                    pass
            turns = smap.get_recent_turns(session_id, count=100)
            session.message_count = len(turns) * 2
            logger.info(
                "[session] Restored session %s from SessionMap: turns=%d",
                session_id[:8], len(turns),
            )
            return session
        except Exception:
            logger.warning(
                "[session] Failed to restore session %s from SessionMap",
                session_id[:8], exc_info=True,
            )
            return None

    async def get(self, session_id: str) -> SessionState | None:
        async with self._lock:
            session = self._sessions.get(session_id)
        if session is not None:
            session.last_active = time.time()
            return session
        # 不在内存中时，尝试从持久化 SessionMap 恢复
        restored = await self._restore_from_session_map(session_id)
        if restored is not None:
            async with self._lock:
                existing = self._sessions.get(session_id)
                if existing is not None:
                    existing.last_active = time.time()
                    return existing
                self._sessions[session_id] = restored
            return restored
        return None

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
            except asyncio.CancelledError:
                logger.debug("[session] Active task cancelled for %s", session_id)
            except Exception as e:
                logger.warning("[session] Failed to cancel active task for %s: %s", session_id, e)
        run_manager = getattr(self, "_deferred_run_manager", None)
        if run_manager is not None:
            try:
                await run_manager.cancel_parent(session_id)
            except Exception as e:
                # Session deletion must remain available even if a durable
                # dispatcher has already been shut down during application exit.
                logger.warning("[session] run_manager.cancel_parent failed for %s: %s", session_id, e)
        workflow_manager = getattr(self, "_workflow_run_manager", None)
        if workflow_manager is not None:
            try:
                await workflow_manager.cancel_parent(session_id, "parent_session_closed")
            except Exception as e:
                # A session must still be removable while a workflow runtime is
                # stopping or has already released its journal connection.
                logger.warning("[session] workflow_manager.cancel_parent failed for %s: %s", session_id, e)
        return True

    async def list_sessions(self) -> list[dict]:
        async with self._lock:
            sessions = list(self._sessions.values())
        result = []
        seen_ids = set()
        for s in sessions:
            seen_ids.add(s.session_id)
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

        # 从持久化 SessionMap SQLite 恢复非活跃会话（后端重启后保留）
        try:
            smap = self._session_map
            if smap is None:
                from api.pi_bridge.session_adapter import get_session_map
                smap = get_session_map()
            for sm in smap.list_sessions():
                if sm["session_id"] in seen_ids:
                    continue
                seen_ids.add(sm["session_id"])
                # 尝试从 const YAML 获取名称
                const_name = ""
                if sm["is_const"]:
                    try:
                        from api.const_session_store import load_const_session_by_id

                        const_data = load_const_session_by_id(sm["session_id"])
                        if const_data:
                            const_name = const_data.get("const_name", "")
                    except Exception:
                        pass
                result.append(
                    {
                        "session_id": sm["session_id"],
                        "message_count": sm["turn_count"] * 2,
                        "created_at": _parse_sqlite_datetime(sm["created_at"]),
                        "last_active": _parse_sqlite_datetime(sm["updated_at"]),
                        "has_active_agent": False,
                        "is_subagent": False,
                        "is_const": sm["is_const"],
                        "const_name": const_name,
                    }
                )
        except Exception:
            logger.debug("[session] Failed to list sessions from SessionMap", exc_info=True)

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
