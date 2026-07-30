"""Audit Log REST API — 审计日志端点。

提供简单的前端审计日志存储与查询，用于替代 OMP 原有审计子系统。
数据以 JSON 文件形式持久化在 api/data/audit_log.json，读写使用
yaml_file_lock（portalocker fallback）加锁保证原子性。
"""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import API_DATA_DIR
from api.yaml_store import yaml_file_lock

logger = logging.getLogger(__name__)

router = APIRouter()

# ── 持久化路径 ──────────────────────────────────────────

_LOG_PATH: Path = API_DATA_DIR / "audit_log.json"
_LOG_PARENT: Path = _LOG_PATH.parent

# 进程内锁字典：path → threading.Lock
_inproc_locks: dict[str, threading.Lock] = {}
_inproc_locks_guard = threading.Lock()


def _get_inproc_lock(path_str: str) -> threading.Lock:
    with _inproc_locks_guard:
        lock = _inproc_locks.get(path_str)
        if lock is None:
            lock = threading.Lock()
            _inproc_locks[path_str] = lock
        return lock


def _locked_log():
    """Return a context manager that locks the audit log file."""
    path_str = str(_LOG_PATH)
    inproc_lock = _get_inproc_lock(path_str)
    return _ChainedLock(inproc_lock, path_str)


class _ChainedLock:
    """组合进程内锁 + 文件锁的上下文管理器。"""

    def __init__(self, inproc: threading.Lock, path_str: str):
        self.inproc = inproc
        self.path_str = path_str
        self.file_lock = None

    def __enter__(self):
        self.inproc.acquire()
        self.file_lock = yaml_file_lock(self.path_str, timeout=5)
        self.file_lock.__enter__()
        return self

    def __exit__(self, *args):
        try:
            self.file_lock.__exit__(*args)
        finally:
            self.inproc.release()


# ── 数据操作 ────────────────────────────────────────────


def _load_records() -> list[dict[str, Any]]:
    """Read the audit log file, returning a list of records."""
    if not _LOG_PATH.exists():
        return []
    try:
        with open(_LOG_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return data


def _save_records(records: list[dict[str, Any]]) -> None:
    """Atomically write the audit log file."""
    _LOG_PARENT.mkdir(parents=True, exist_ok=True)
    tmp = _LOG_PATH.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
        f.flush()
        import os

        os.fsync(f.fileno())
    tmp.replace(_LOG_PATH)


def _append_record(record: dict[str, Any]) -> None:
    """Append a single record to the log."""
    with _locked_log():
        records = _load_records()
        records.append(record)
        _save_records(records)


def _compute_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute statistics from a list of records."""
    by_type: Counter = Counter()
    by_status: Counter = Counter()
    target_counter: Counter = Counter()
    for r in records:
        by_type[r.get("type", "unknown")] += 1
        by_status[r.get("status", "unknown")] += 1
        target_counter[r.get("target", "unknown")] += 1
    return {
        "total": len(records),
        "by_type": dict(by_type),
        "by_status": dict(by_status),
        "top_targets": [
            {"target": t, "count": c}
            for t, c in target_counter.most_common(10)
        ],
    }


# ── REST 端点 ───────────────────────────────────────────


@router.get("/audit-log")
async def get_audit_log(
    limit: int = Query(default=50, ge=1, le=1000),
    event_type: str | None = None,
    since: str | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """返回审计日志记录列表。

    参数：
    - limit   : 返回最大条数（默认 50，最大 1000）
    - event_type : 按 type 字段过滤
    - since   : ISO8601 起始时间戳，只返回此时间之后的记录
    """
    with _locked_log():
        records = _load_records()

    # Apply filters outside the lock to keep lock duration minimal
    if event_type:
        records = [r for r in records if r.get("type") == event_type]
    if since:
        records = [r for r in records if r.get("timestamp", "") >= since]

    # Most recent first, then limit
    records = sorted(records, key=lambda r: r.get("timestamp", ""), reverse=True)
    return {"records": records[:limit]}


@router.get("/audit-log/stats")
async def get_audit_stats() -> dict[str, Any]:
    """返回审计日志统计信息。"""
    with _locked_log():
        records = _load_records()
    return {"stats": _compute_stats(records)}


@router.post("/audit-log/clear")
async def clear_audit_log() -> dict[str, Any]:
    """清空所有审计日志记录。"""
    with _locked_log():
        records = _load_records()
        deleted = len(records)
        _save_records([])
    return {"status": "ok", "deleted": deleted}


class AppendAuditBody(BaseModel):
    type: str = "info"
    target: str = "system"
    detail: str = ""
    data_size: int = 0
    status: str = "ok"
    extra: dict[str, Any] | None = None


@router.post("/audit-log/append")
async def append_audit_entry(body: AppendAuditBody) -> dict[str, Any]:
    """追加一条审计记录（内部使用/测试端点）。"""
    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "epoch": int(time.time()),
        "type": body.type,
        "target": body.target,
        "detail": body.detail,
        "data_size": body.data_size,
        "status": body.status,
    }
    if body.extra:
        record["extra"] = body.extra
    _append_record(record)
    return {"ok": True, "record": record}
