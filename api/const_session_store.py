"""Const 固定会话 — YAML 持久化存储。

提供将会话状态（元数据 + 对话消息）序列化为 YAML 文件并重新加载的能力。
"""

import logging
import time
from pathlib import Path

import yaml

from app_paths import CONST_SESSIONS_DIR as _CONST_DIR
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock

logger = logging.getLogger(__name__)


def _ensure_dir() -> Path:
    _CONST_DIR.mkdir(parents=True, exist_ok=True)
    return _CONST_DIR


# ── 消息序列化 ─────────────────────────────────────────────────


def serialize_messages(raw_messages: list) -> list[dict]:
    """将消息对象列表转为可序列化的纯 dict 列表。"""
    result = []
    for msg in raw_messages:
        entry: dict = {
            "type": getattr(msg, "type", "unknown"),
            "content": msg.content if hasattr(msg, "content") else str(msg),
        }
        if hasattr(msg, "tool_call_id") and msg.tool_call_id:
            entry["tool_call_id"] = msg.tool_call_id
        if hasattr(msg, "name") and msg.name:
            entry["name"] = msg.name
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            entry["tool_calls"] = msg.tool_calls
        if hasattr(msg, "additional_kwargs") and msg.additional_kwargs:
            entry["additional_kwargs"] = msg.additional_kwargs
        result.append(entry)
    return result


# ── 文件 I/O ──────────────────────────────────────────────────


def save_const_session(
    session_id: str,
    const_name: str,
    metadata: dict,
    messages: list[dict],
) -> str:
    """将会话持久化为 YAML 文件。

    Returns:
        写入的文件路径。
    """
    ensure_dir = _ensure_dir()
    data = {
        "session_id": session_id,
        "const_name": const_name,
        "const_saved_at": time.time(),
        "metadata": metadata,
        "messages": messages,
    }
    filepath = ensure_dir / f"{session_id}.yaml"
    with yaml_file_lock(filepath):
        dump_yaml_atomic(filepath, data)
    return str(filepath)


def load_const_session(filepath: Path) -> dict | None:
    """加载单个 const 会话 YAML 文件。"""
    try:
        with yaml_file_lock(filepath):
            data = load_yaml(filepath, default=None)
            return data if isinstance(data, dict) else None
    except Exception:
        logger.warning("[const] failed to load session file %s", filepath, exc_info=True)
        return None


def load_const_session_by_id(session_id: str) -> dict | None:
    """按 session_id 加载持久化 const 会话。"""
    return load_const_session(_CONST_DIR / f"{session_id}.yaml")


def load_all_const_sessions() -> list[dict]:
    """扫描 const-sessions/ 目录，加载所有 YAML。"""
    ensure_dir = _ensure_dir()
    sessions = []
    for fpath in sorted(ensure_dir.glob("*.yaml")):
        data = load_const_session(fpath)
        if data and data.get("session_id"):
            sessions.append(data)
    return sessions


def delete_const_session(session_id: str) -> bool:
    """删除 const 会话文件。"""
    filepath = _CONST_DIR / f"{session_id}.yaml"
    if filepath.exists():
        filepath.unlink()
        return True
    return False
