"""审计日志 — 记录所有外部 API 调用和敏感操作。

日志格式：JSON Lines，每条记录包含时间戳、操作类型、目标、数据量等。
存储路径：LOGS_DIR/audit.jsonl
"""

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from app_paths import LOGS_DIR

logger = logging.getLogger(__name__)

# 审计日志文件路径
AUDIT_LOG_PATH = LOGS_DIR / "audit.jsonl"

# 最大保留记录数
MAX_RECORDS = 5000


def _ensure_dir():
    """确保日志目录存在。"""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)


def log_event(
    event_type: str,
    target: str = "",
    detail: str = "",
    data_size: int = 0,
    status: str = "ok",
    extra: Optional[dict] = None,
) -> None:
    """记录一条审计日志。

    Args:
        event_type: 事件类型（api_call / file_access / config_change / auth 等）
        target: 操作目标（URL、文件路径、配置项名等）
        detail: 补充说明
        data_size: 数据传输量（字节）
        status: 状态（ok / error / blocked）
        extra: 额外字段
    """
    _ensure_dir()
    record = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "epoch": time.time(),
        "type": event_type,
        "target": target,
        "detail": detail,
        "data_size": data_size,
        "status": status,
    }
    if extra:
        record["extra"] = extra

    try:
        with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


def read_log(limit: int = 100, event_type: str = "", since: str = "") -> list[dict]:
    """读取审计日志。

    Args:
        limit: 最大返回条数（从最新开始）
        event_type: 按事件类型过滤
        since: 时间过滤（ISO 格式，如 '2026-07-01'）

    Returns:
        日志记录列表（最新在前）
    """
    if not AUDIT_LOG_PATH.exists():
        return []

    records = []
    try:
        with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # 按类型过滤
                if event_type and record.get("type") != event_type:
                    continue
                # 按时间过滤
                if since and record.get("timestamp", "") < since:
                    continue

                records.append(record)
    except Exception as e:
        logger.warning(f"Failed to read audit log: {e}")

    # 最新的在前
    records.reverse()
    return records[:limit]


def get_stats() -> dict:
    """获取审计日志统计信息。"""
    if not AUDIT_LOG_PATH.exists():
        return {"total": 0, "by_type": {}, "by_status": {}, "targets": []}

    by_type: dict[str, int] = {}
    by_status: dict[str, int] = {}
    targets: dict[str, int] = {}
    total = 0

    try:
        with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                total += 1
                t = record.get("type", "unknown")
                by_type[t] = by_type.get(t, 0) + 1

                s = record.get("status", "unknown")
                by_status[s] = by_status.get(s, 0) + 1

                target = record.get("target", "")
                if target:
                    targets[target] = targets.get(target, 0) + 1
    except Exception as e:
        logger.warning(f"Failed to read audit log for stats: {e}")

    # 取 top 20 目标
    sorted_targets = sorted(targets.items(), key=lambda x: x[1], reverse=True)[:20]

    return {
        "total": total,
        "by_type": by_type,
        "by_status": by_status,
        "top_targets": [{"target": t, "count": c} for t, c in sorted_targets],
    }


def clear_log() -> int:
    """清空审计日志。返回删除的记录数。"""
    if not AUDIT_LOG_PATH.exists():
        return 0
    count = 0
    try:
        with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
            count = sum(1 for line in f if line.strip())
        AUDIT_LOG_PATH.write_text("", encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to clear audit log: {e}")
    return count


def trim_log(max_records: int = MAX_RECORDS) -> int:
    """裁剪日志到指定记录数。返回删除的记录数。"""
    if not AUDIT_LOG_PATH.exists():
        return 0

    try:
        with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

        if len(lines) <= max_records:
            return 0

        removed = len(lines) - max_records
        with open(AUDIT_LOG_PATH, "w", encoding="utf-8") as f:
            f.writelines(lines[-max_records:])
        return removed
    except Exception as e:
        logger.warning(f"Failed to trim audit log: {e}")
        return 0
