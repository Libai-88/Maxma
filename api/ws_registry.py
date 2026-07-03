"""WebSocket 注册表 — 为后台任务提供推送事件到指定会话的能力。"""

import threading

from fastapi import WebSocket


class WebSocketRegistry:
    """协程/线程安全的 WebSocket 注册表。

    在 websocket_chat() accept 后 register，断开时 unregister。
    使用 RLock 保护内部映射，防止未来在独立线程或事件循环中并发访问
    时发生数据竞争。
    """

    def __init__(self) -> None:
        self._sessions: dict[str, WebSocket] = {}
        self._lock = threading.RLock()

    def register(self, session_id: str, ws: WebSocket) -> None:
        """注册 session_id → WebSocket 映射。"""
        with self._lock:
            self._sessions[session_id] = ws

    def unregister(self, session_id: str) -> None:
        """移除 session_id 的映射。"""
        with self._lock:
            self._sessions.pop(session_id, None)

    def get(self, session_id: str) -> WebSocket | None:
        """获取指定 session_id 的 WebSocket，不存在时返回 None。"""
        with self._lock:
            return self._sessions.get(session_id)
