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
from memory.pii_guard import scrub_pii

logger = logging.getLogger(__name__)

# 审计日志文件路径
AUDIT_LOG_PATH = LOGS_DIR / "audit.jsonl"

# 最大保留记录数
MAX_RECORDS = 5000

# 事件类型常量（阶段 4.2）
EVENT_MCP_CALL = "mcp_call"


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
    """记录一条审计日志（带 PII 脱敏）。

    Args:
        event_type: 事件类型（api_call / file_access / config_change / auth 等）
        target: 操作目标（URL、文件路径、配置项名等）
        detail: 补充说明
        data_size: 数据传输量（字节）
        status: 状态（ok / error / blocked）
        extra: 额外字段
    """
    _ensure_dir()

    # 脱敏所有字符串值（PII + 长度限制）
    safe_target = scrub_pii(target, max_length=500) if target else target
    safe_detail = scrub_pii(detail, max_length=500) if detail else detail
    safe_extra = None
    if extra:
        safe_extra = {
            k: scrub_pii(v, max_length=500) if isinstance(v, str) else v
            for k, v in extra.items()
        }

    record = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "epoch": time.time(),
        "type": event_type,
        "target": safe_target,
        "detail": safe_detail,
        "data_size": data_size,
        "status": status,
    }
    if safe_extra:
        record["extra"] = safe_extra

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


# ═══════════════════════════════════════════════════════════════════════
# 阶段 4.2：MCP 调用审计
# ═══════════════════════════════════════════════════════════════════════


def log_mcp_call(
    server_id: str,
    tool_name: str,
    args_summary: str = "",
    result_summary: str = "",
    duration_ms: int = 0,
    status: str = "ok",
    error: Optional[str] = None,
) -> None:
    """记录一次 MCP 工具调用到审计日志（阶段 4.2）。

    Args:
        server_id: MCP 服务器 ID
        tool_name: 工具名（含 server_id 前缀）
        args_summary: 入参摘要（已脱敏，避免泄漏敏感数据）
        result_summary: 结果摘要（已脱敏）
        duration_ms: 耗时（毫秒）
        status: ok / error / rate_limited / blocked
        error: 失败时的错误信息
    """
    extra = {
        "server_id": server_id,
        "tool_name": tool_name,
        "duration_ms": duration_ms,
    }
    if args_summary:
        extra["args_summary"] = args_summary[:500]  # 截断避免日志膨胀
    if result_summary:
        extra["result_summary"] = result_summary[:500]
    if error:
        extra["error"] = error[:500]

    log_event(
        event_type=EVENT_MCP_CALL,
        target=f"{server_id}/{tool_name}",
        detail=status,
        data_size=len(args_summary) + len(result_summary),
        status=status,
        extra=extra,
    )


def get_mcp_summary() -> list[dict]:
    """聚合统计每个 server_id+tool_name 的 MCP 调用次数/成功率/平均耗时（阶段 4.2）。

    Returns:
        list of dict，每项含 server_id / tool_name / total / ok / error / rate_limited /
        avg_duration_ms / last_call_at
    """
    if not AUDIT_LOG_PATH.exists():
        return []

    # key: (server_id, tool_name) -> stats
    stats: dict[tuple[str, str], dict] = {}

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
                if record.get("type") != EVENT_MCP_CALL:
                    continue

                extra = record.get("extra", {}) or {}
                server_id = extra.get("server_id", "")
                tool_name = extra.get("tool_name", "")
                status = record.get("status", "unknown")
                duration_ms = extra.get("duration_ms", 0) or 0
                timestamp = record.get("timestamp", "")

                key = (server_id, tool_name)
                if key not in stats:
                    stats[key] = {
                        "server_id": server_id,
                        "tool_name": tool_name,
                        "total": 0,
                        "ok": 0,
                        "error": 0,
                        "rate_limited": 0,
                        "blocked": 0,
                        "_duration_sum": 0,
                        "last_call_at": "",
                    }

                s = stats[key]
                s["total"] += 1
                if status in s:
                    s[status] += 1
                s["_duration_sum"] += duration_ms
                if timestamp > s["last_call_at"]:
                    s["last_call_at"] = timestamp
    except Exception as e:
        logger.warning(f"Failed to read MCP audit summary: {e}")
        return []

    # 计算平均耗时并清理内部字段
    result = []
    for s in stats.values():
        total = s["total"]
        s["avg_duration_ms"] = round(s["_duration_sum"] / total, 2) if total else 0
        s["success_rate"] = round(s["ok"] / total, 4) if total else 0
        s.pop("_duration_sum", None)
        result.append(s)
    # 按 total 降序
    result.sort(key=lambda x: x["total"], reverse=True)
    return result
