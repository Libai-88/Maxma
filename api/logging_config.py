"""统一日志配置 — JSON 结构化输出 + 控制台可读模式。

环境变量：
    MAXMA_LOG_LEVEL   — 日志级别（默认 INFO）
    MAXMA_LOG_JSON    — 设为 1 启用控制台 JSON 输出（默认关闭，控制台用可读格式）
    MAXMA_LOG_FILE    — 日志文件路径（默认 logs/maxma.log，设为空字符串禁用文件日志）
"""

import logging
import logging.handlers
import json
import os
import sys
import time
from contextvars import ContextVar
from pathlib import Path
from typing import Any

# ── 上下文变量（请求级追踪） ─────────────────────────────────────
ctx_session_id: ContextVar[str] = ContextVar("ctx_session_id", default="")
ctx_request_id: ContextVar[str] = ContextVar("ctx_request_id", default="")


# ── JSON 格式化器 ────────────────────────────────────────────────
class JsonFormatter(logging.Formatter):
    """将日志记录序列化为单行 JSON。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self._iso_time(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }

        # 注入上下文
        sid = ctx_session_id.get("")
        if sid:
            payload["session_id"] = sid
        rid = ctx_request_id.get("")
        if rid:
            payload["request_id"] = rid

        # 异常信息
        if record.exc_info and record.exc_info[0] is not None:
            payload["exception"] = self.formatException(record.exc_info)

        # 额外字段（通过 extra=dict 传入）
        for key in ("duration_ms", "status_code", "method", "path", "client_ip",
                     "tool_name", "tool_latency_ms", "tool_error",
                     "llm_model", "llm_tokens_in", "llm_tokens_out", "llm_latency_ms"):
            val = getattr(record, key, None)
            if val is not None:
                payload[key] = val

        return json.dumps(payload, ensure_ascii=False, default=str)

    @staticmethod
    def _iso_time(record: logging.LogRecord) -> str:
        return time.strftime(
            "%Y-%m-%dT%H:%M:%S", time.localtime(record.created)
        ) + f".{int(record.msecs):03d}"


# ── 控制台可读格式化器 ──────────────────────────────────────────
class ConsoleFormatter(logging.Formatter):
    """开发环境友好的可读格式：时间 级别 模块 消息。"""

    def __init__(self, datefmt: str | None = None):
        super().__init__(
            fmt="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
            datefmt=datefmt or "%H:%M:%S",
        )

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        sid = ctx_session_id.get("")
        rid = ctx_request_id.get("")
        ctx_parts = []
        if sid:
            ctx_parts.append(f"sid={sid[:8]}")
        if rid:
            ctx_parts.append(f"rid={rid[:8]}")
        if ctx_parts:
            base = f"[{' '.join(ctx_parts)}] {base}"
        return base


# ── 公共 API ─────────────────────────────────────────────────────
from app_paths import LOGS_DIR as _LOG_DIR


def setup_logging() -> None:
    """初始化全局日志系统。在 create_app() 或 main() 入口处调用一次。"""
    level_name = os.environ.get("MAXMA_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    use_json_console = os.environ.get("MAXMA_LOG_JSON") == "1"
    log_file = os.environ.get("MAXMA_LOG_FILE", None)  # None = 使用默认路径

    root = logging.getLogger()
    root.setLevel(level)

    # 清除已有 handler（防止重复初始化）
    root.handlers.clear()

    # ── 控制台 handler ──
    console = logging.StreamHandler(sys.stderr)
    console.setLevel(level)
    if use_json_console:
        console.setFormatter(JsonFormatter())
    else:
        console.setFormatter(ConsoleFormatter())
    root.addHandler(console)

    # ── 文件 handler（JSON 格式，自动轮转）──
    if log_file != "":
        if log_file is None:
            _LOG_DIR.mkdir(parents=True, exist_ok=True)
            log_file = str(_LOG_DIR / "maxma.log")

        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(JsonFormatter())
        root.addHandler(file_handler)

    # 降低第三方库日志级别
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    # LangChain 已从运行时移除，保留日志级别设置向后兼容
    logging.getLogger("playwright").setLevel(logging.WARNING)

    logging.info(
        "Logging initialized: level=%s, json_console=%s, file=%s",
        level_name,
        use_json_console,
        log_file if log_file != "" else "(disabled)",
    )
