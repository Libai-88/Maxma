"""JSONL Transcript Writer — 后台任务透明抄本。

设计参考 Halo session-store.ts：
- 把每个聚合 assistant/user 消息 append 到 {runId}.jsonl
- 无人观看的 run 对前端零开销（不打 agent:* 事件）
- 观察者按需轮询读取

与现有 audit.jsonl 的区别：
- audit.jsonl 记录 MCP 调用审计日志
- transcript 记录完整对话流（用于后台 run 重放/调试）
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, List, Optional

from langchain_core.messages import BaseMessage

logger = logging.getLogger(__name__)


class TranscriptWriter:
    """JSONL 格式的对话抄本写入器。

    线程安全（同一 run 的并发写入用 Lock 保护）。
    每个 run 一个文件，路径由调用方指定。

    Args:
        path: JSONL 文件路径
    """

    def __init__(self, path: Path | str):
        self._path = Path(path)
        self._lock = threading.Lock()
        self._closed = False
        # 确保父目录存在
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def append_message(self, message: BaseMessage) -> None:
        """追加一条消息到 transcript。

        Args:
            message: LangChain BaseMessage（HumanMessage/AIMessage 等）
        """
        entry = self._serialize_message(message)
        self._append_jsonl(entry)

    def append_metadata(self, metadata: dict) -> None:
        """追加 run 级元数据（作为首行）。

        Args:
            metadata: 元数据 dict（如 run_id, trigger, action）
        """
        entry = {"type": "metadata", "timestamp": time.time()}
        entry.update(metadata)
        self._append_jsonl(entry)

    def append_raw(self, role: str, content: str, **extra: Any) -> None:
        """追加原始格式的消息（不依赖 LangChain 类型）。

        Args:
            role: 消息角色（human/ai/system/tool）
            content: 消息内容
            **extra: 额外字段（如 tool_calls, tool_call_id）
        """
        entry: dict[str, Any] = {
            "type": "message",
            "role": role,
            "content": content,
            "timestamp": time.time(),
        }
        entry.update(extra)
        self._append_jsonl(entry)

    def close(self) -> None:
        """关闭 writer（幂等）。"""
        with self._lock:
            self._closed = True

    def _append_jsonl(self, entry: dict) -> None:
        with self._lock:
            if self._closed:
                return
            line = json.dumps(entry, ensure_ascii=False, default=str)
            with open(self._path, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    @staticmethod
    def _serialize_message(message: BaseMessage) -> dict:
        """把 LangChain BaseMessage 序列化为 dict。"""
        entry: dict[str, Any] = {
            "type": "message",
            "role": message.type,
            "content": message.content,
            "timestamp": time.time(),
        }
        # 保留 tool_calls（AIMessage）
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            entry["tool_calls"] = [
                {"name": tc["name"], "args": tc["args"], "id": tc.get("id", "")}
                for tc in tool_calls
            ]
        # 保留 tool_call_id（ToolMessage）
        tool_call_id = getattr(message, "tool_call_id", None)
        if tool_call_id:
            entry["tool_call_id"] = tool_call_id
        # 保留 name
        name = getattr(message, "name", None)
        if name:
            entry["name"] = name
        return entry

    @staticmethod
    def read_messages(path: Path | str) -> List[dict]:
        """读取 transcript，返回消息列表（跳过 metadata 行）。

        Args:
            path: JSONL 文件路径

        Returns:
            消息 dict 列表（每项含 role/content/timestamp）
        """
        path = Path(path)
        if not path.exists():
            return []
        messages: List[dict] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("type") == "message":
                        messages.append(entry)
                except json.JSONDecodeError:
                    continue
        return messages
