"""WebSocket 注册表 — 为后台任务提供推送事件到指定会话的能力。"""

import threading

from fastapi import WebSocket


class WebSocketRegistry:
    """协程/线程安全的 WebSocket 注册表。

    在 websocket_chat() accept 后 register，断开时 unregister。
    使用 RLock 保护内部映射，防止未来在独立线程或事件循环中并发访问
    时发生数据竞争。

    MULTI-WS-001：同一 session 允许多个连接（多窗口/多标签）。此前
    注册表按 session 只存最后一个连接——第二窗口打开同一会话后，后台
    任务（工作流等）的事件只推给最后一个窗口。现在按连接列表存储，
    get_all() 广播给全部连接。
    """

    def __init__(self) -> None:
        self._sessions: dict[str, list[WebSocket]] = {}
        self._lock = threading.RLock()

    def register(self, session_id: str, ws: WebSocket) -> None:
        """注册 session_id → WebSocket 连接（追加到连接列表）。"""
        with self._lock:
            conns = self._sessions.setdefault(session_id, [])
            if ws not in conns:
                conns.append(ws)

    def unregister(self, session_id: str, ws: WebSocket | None = None) -> None:
        """移除连接。不传 ws 时移除该 session 的全部连接。"""
        with self._lock:
            conns = self._sessions.get(session_id)
            if not conns:
                return
            if ws is None:
                self._sessions.pop(session_id, None)
                return
            try:
                conns.remove(ws)
            except ValueError:
                pass
            if not conns:
                self._sessions.pop(session_id, None)

    def get(self, session_id: str) -> WebSocket | None:
        """获取最近注册的一个连接（兼容旧语义），不存在时返回 None。"""
        with self._lock:
            conns = self._sessions.get(session_id)
            return conns[-1] if conns else None

    def get_all(self, session_id: str) -> list[WebSocket]:
        """获取 session 的全部连接（广播推送用）。"""
        with self._lock:
            return list(self._sessions.get(session_id, []))

    def ids(self) -> list[str]:
        """返回当前注册的所有 session_id（SESSION-CLEANUP-001 用）。"""
        with self._lock:
            return list(self._sessions.keys())
