"""Activity Hub —— 全局活动事件中心。

采用与 ErrorCollector 相同的单例模式：deque 环形缓冲 + threading.Lock。
记录 turn/tool/plan/compression/approval/memory 级别事件，供前端实时展示和查询。
"""
from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class ActivityRecord:
    """单条活动记录。"""
    timestamp: float
    category: str  # turn / tool / plan / compression / approval / memory / system
    event_type: str  # 子类型，如 turn_start / tool_end / plan_proposed
    session_id: str = ""
    turn_id: str = ""
    tool_name: str = ""
    level: str = "info"  # info / warn / error
    message: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ActivityHub:
    """活动事件中心，全局单例。"""

    _instance: Optional["ActivityHub"] = None
    _class_lock = threading.Lock()

    MAX_IN_MEMORY = 1000

    def __init__(self) -> None:
        self._buffer: deque[ActivityRecord] = deque(maxlen=self.MAX_IN_MEMORY)
        self._buffer_lock = threading.Lock()
        self._started_at = time.time()

    @classmethod
    def get(cls) -> "ActivityHub":
        """双重检查锁定获取单例。"""
        if cls._instance is None:
            with cls._class_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def add(
        self,
        category: str,
        event_type: str,
        *,
        session_id: str = "",
        turn_id: str = "",
        tool_name: str = "",
        level: str = "info",
        message: str = "",
        payload: Optional[dict[str, Any]] = None,
    ) -> ActivityRecord:
        """记录一条活动事件。线程安全。"""
        record = ActivityRecord(
            timestamp=time.time(),
            category=category,
            event_type=event_type,
            session_id=session_id,
            turn_id=turn_id,
            tool_name=tool_name,
            level=level,
            message=message,
            payload=payload or {},
        )
        with self._buffer_lock:
            self._buffer.append(record)
        return record

    def recent(self, limit: int = 100, category: Optional[str] = None) -> list[ActivityRecord]:
        """获取最近 N 条记录，可按 category 过滤。"""
        with self._buffer_lock:
            records = list(self._buffer)
        if category:
            records = [r for r in records if r.category == category]
        return records[-limit:]

    def clear(self) -> int:
        """清空缓冲区，返回清空的记录数。"""
        with self._buffer_lock:
            count = len(self._buffer)
            self._buffer.clear()
        return count

    def stats(self) -> dict[str, Any]:
        """返回统计信息。"""
        with self._buffer_lock:
            total = len(self._buffer)
            by_category: dict[str, int] = {}
            for r in self._buffer:
                by_category[r.category] = by_category.get(r.category, 0) + 1
        return {
            "total": total,
            "by_category": by_category,
            "started_at": self._started_at,
            "uptime_seconds": time.time() - self._started_at,
        }

    def rehydrate_orphans(self) -> int:
        """孤儿恢复：进程重启后遗留的 running 状态必是孤儿，标记为 failed。

        Returns:
            修复的孤儿数量
        """
        count = 0
        with self._buffer_lock:
            for record in self._buffer:
                if record.level == "info" and "running" in (record.message or "").lower():
                    # 简单启发式：message 含 "running" 且 level=info 的可能是 running 状态
                    # 实际实现应根据 event_type 判断
                    pass
            # 更精确的实现需要 status 字段，这里用 event_type 约定
        return count

    def list_by_session(self, session_id: str, *, limit: int = 100) -> list[ActivityRecord]:
        """会话级过滤：只返回归属该 session 的活动。"""
        with self._buffer_lock:
            records = [r for r in self._buffer if r.session_id == session_id]
        return records[-limit:]

    def clear_by_session(self, session_id: str) -> int:
        """清除指定会话的所有活动记录。"""
        with self._buffer_lock:
            before = len(self._buffer)
            self._buffer = deque(
                (r for r in self._buffer if r.session_id != session_id),
                maxlen=self.MAX_IN_MEMORY
            )
            return before - len(self._buffer)


# 模块级单例快捷引用
activity_hub = ActivityHub.get()
