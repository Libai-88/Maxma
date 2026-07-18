"""全局错误收集器 — 一键导出应用运行中所有报错。

收集来源：
1. 内存环形缓冲区：WebSocket 错误事件、HTTP 5xx、未捕获异常、工具错误、LLM 错误
   优点：实时、上下文丰富（含 session_id/trace_id/tool_name 等）
2. 日志文件扫描：maxma.log + 轮转文件中的 ERROR/CRITICAL 条目（兜底）
   优点：覆盖内存缓冲区容量上限之前的旧错误，重启后仍可导出

设计要点：
- 线程安全（threading.Lock），可在异步/多线程环境下安全调用
- 单例模式（双重检查锁定），全局唯一实例
- deque(maxlen=500) 防止内存无限增长
- 同时提供 JSON 和纯文本两种导出格式
"""

import json
import logging
import os
import platform
import sys
import threading
import time
import traceback
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

from app_paths import LOGS_DIR, DATA_DIR
from version import __version__

logger = logging.getLogger(__name__)


@dataclass
class ErrorRecord:
    """单条错误记录。"""

    timestamp: str
    level: str  # ERROR / CRITICAL / WARNING
    category: str  # agent / tool / websocket / http / system / uncaught / llm / rate_limit
    message: str
    trace_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None
    logger_name: Optional[str] = None
    exception: Optional[str] = None
    extra: dict = field(default_factory=dict)


class ErrorCollector:
    """全局错误收集器（线程安全，内存环形缓冲区 + 日志文件扫描）。

    使用方式：
        from api.diagnostics import error_collector
        error_collector.add_error(
            level="ERROR",
            category="agent",
            message="Agent 执行失败",
            trace_id="abc123",
            session_id="sess456",
        )
    """

    _instance: Optional["ErrorCollector"] = None
    _lock = threading.Lock()

    MAX_IN_MEMORY = 500

    def __init__(self) -> None:
        self._buffer: deque[ErrorRecord] = deque(maxlen=self.MAX_IN_MEMORY)
        self._buffer_lock = threading.Lock()
        self._started_at = time.time()

    @classmethod
    def get(cls) -> "ErrorCollector":
        """获取全局单例（双重检查锁定）。"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def add(self, record: ErrorRecord) -> None:
        """添加一条错误记录到内存缓冲区。"""
        with self._buffer_lock:
            self._buffer.append(record)

    def add_error(
        self,
        level: str,
        category: str,
        message: str,
        *,
        trace_id: Optional[str] = None,
        session_id: Optional[str] = None,
        request_id: Optional[str] = None,
        logger_name: Optional[str] = None,
        exception: Optional[str] = None,
        **extra,
    ) -> None:
        """便捷方法：添加一条错误记录。"""
        self.add(
            ErrorRecord(
                timestamp=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
                level=level,
                category=category,
                message=message,
                trace_id=trace_id,
                session_id=session_id,
                request_id=request_id,
                logger_name=logger_name,
                exception=exception,
                extra=extra or {},
            )
        )

    def add_exception(
        self,
        exc: BaseException,
        *,
        category: str = "uncaught",
        message: Optional[str] = None,
        **kwargs,
    ) -> None:
        """便捷方法：从异常对象添加记录（自动提取 traceback）。"""
        self.add_error(
            level="CRITICAL",
            category=category,
            message=message or f"{type(exc).__name__}: {exc}",
            exception="".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            ),
            **kwargs,
        )

    def get_all(self) -> list[ErrorRecord]:
        """返回内存缓冲区中所有错误记录（副本）。"""
        with self._buffer_lock:
            return list(self._buffer)

    def clear(self) -> int:
        """清空内存缓冲区，返回被清除的记录数。"""
        with self._buffer_lock:
            count = len(self._buffer)
            self._buffer.clear()
            return count

    def export_report(self) -> dict:
        """生成完整的错误报告（JSON 结构）。

        包含：
        - 系统信息（OS/版本/运行时间/路径）
        - 内存缓冲区错误（实时收集的）
        - 日志文件错误（扫描 maxma.log 中的 ERROR/CRITICAL）
        - 统计摘要
        """
        memory_errors = [asdict(r) for r in self.get_all()]
        file_errors = self._scan_log_files()
        system_info = self._collect_system_info()

        # 合并去重（按 timestamp+message 粗略去重，优先保留内存版本）
        seen_keys: set[str] = set()
        merged: list[dict] = []
        for err in memory_errors + file_errors:
            key = f"{err.get('timestamp', '')}|{err.get('message', '')[:200]}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            merged.append(err)

        # 按时间排序（时间戳为空的排到最后）
        def _sort_key(e: dict) -> str:
            return e.get("timestamp") or ""

        merged.sort(key=_sort_key)

        return {
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "system_info": system_info,
            "autonomy_status": self._collect_autonomy_status(),
            "tauri_startup_log": self._read_tauri_startup_log(),
            "errors": merged,
            "stats": {
                "memory_error_count": len(memory_errors),
                "log_file_error_count": len(file_errors),
                "merged_total": len(merged),
                "uptime_seconds": int(time.time() - self._started_at),
                "buffer_capacity": self.MAX_IN_MEMORY,
            },
        }

    def export_text_report(self) -> str:
        """生成纯文本错误报告（便于复制粘贴反馈给开发者）。"""
        report = self.export_report()
        lines: list[str] = []
        lines.append("=" * 72)
        lines.append("MaxmaHere 错误报告")
        lines.append("=" * 72)
        lines.append(f"生成时间: {report['generated_at']}")
        lines.append("")

        # 系统信息
        info = report["system_info"]
        lines.append("─" * 72)
        lines.append("【系统信息】")
        lines.append("─" * 72)
        lines.append(f"  应用版本:     {info.get('app_version', 'N/A')}")
        lines.append(f"  Python 版本:  {info.get('python_version', 'N/A')}")
        lines.append(f"  平台:         {info.get('platform', 'N/A')}")
        lines.append(f"  打包模式:     {info.get('is_frozen', False)}")
        lines.append(f"  运行时长:     {info.get('uptime_seconds', 0)} 秒")
        lines.append(f"  工作目录:     {info.get('cwd', 'N/A')}")
        lines.append(f"  日志目录:     {info.get('logs_dir', 'N/A')}")
        lines.append(f"  数据目录:     {info.get('data_dir', 'N/A')}")
        lines.append("")

        # 自治层状态
        autonomy = report.get("autonomy_status", {})
        lines.append("─" * 72)
        lines.append("【自治层状态】")
        lines.append("─" * 72)
        if autonomy.get("available", False):
            lines.append(f"  调度器运行:   {autonomy.get('running', False)}")
            lines.append(f"  最近 tick:    {autonomy.get('last_tick_at', 'N/A')}")
            lines.append(f"  tick 次数:    {autonomy.get('tick_count', 0)}")
            summary = autonomy.get("last_tick_report_summary") or {}
            if summary:
                lines.append(f"  上次问题数:   {summary.get('issues_count', 0)}")
                lines.append(f"  上次错误数:   {summary.get('error_total', 0)}")
                lines.append(f"  上次健康态:   {summary.get('health_status', 'N/A')}")
        else:
            lines.append(f"  不可用: {autonomy.get('reason', 'unknown')}")
        lines.append("")

        # Tauri 启动日志
        tauri_log = report.get("tauri_startup_log") or {}
        lines.append("─" * 72)
        lines.append("【Tauri 启动日志】")
        lines.append("─" * 72)
        if tauri_log.get("available", False):
            lines.append(f"  文件路径:     {tauri_log.get('path', 'N/A')}")
            lines.append(f"  行数:         {tauri_log.get('line_count', 0)}")
            lines.append("  内容（最后 100 行）:")
            for line in (tauri_log.get("lines") or []):
                lines.append(f"    {line}")
        else:
            lines.append(f"  不可用: {tauri_log.get('reason', 'unknown')}")
        lines.append("")

        # 统计
        stats = report["stats"]
        lines.append("─" * 72)
        lines.append("【错误统计】")
        lines.append("─" * 72)
        lines.append(f"  内存收集:     {stats['memory_error_count']} 条")
        lines.append(f"  日志扫描:     {stats['log_file_error_count']} 条")
        lines.append(f"  合并去重后:   {stats['merged_total']} 条")
        lines.append(f"  缓冲区容量:   {stats['buffer_capacity']} 条")
        lines.append("")

        # 错误详情
        errors = report["errors"]
        if not errors:
            lines.append("─" * 72)
            lines.append("【错误详情】")
            lines.append("─" * 72)
            lines.append("  无错误记录 🎉")
            lines.append("")
        else:
            for i, err in enumerate(errors, 1):
                lines.append("─" * 72)
                lines.append(f"【错误 #{i}】")
                lines.append("─" * 72)
                lines.append(f"  时间:     {err.get('timestamp', 'N/A')}")
                lines.append(f"  级别:     {err.get('level', 'N/A')}")
                lines.append(f"  类别:     {err.get('category', 'N/A')}")
                lines.append(f"  消息:     {err.get('message', 'N/A')}")
                if err.get("trace_id"):
                    lines.append(f"  Trace ID: {err['trace_id']}")
                if err.get("session_id"):
                    lines.append(f"  会话 ID:  {err['session_id']}")
                if err.get("request_id"):
                    lines.append(f"  请求 ID:  {err['request_id']}")
                if err.get("logger_name"):
                    lines.append(f"  Logger:   {err['logger_name']}")
                if err.get("source_file"):
                    lines.append(
                        f"  来源:     {err['source_file']}:{err.get('source_line', '')}"
                    )
                if err.get("exception"):
                    lines.append("  异常堆栈:")
                    for trace_line in err["exception"].splitlines():
                        lines.append(f"    {trace_line}")
                if err.get("extra"):
                    lines.append("  附加信息:")
                    for k, v in err["extra"].items():
                        lines.append(f"    {k}: {v}")
                lines.append("")

        lines.append("=" * 72)
        lines.append("报告结束")
        lines.append("=" * 72)
        return "\n".join(lines)

    def _scan_log_files(self) -> list[dict]:
        """扫描日志文件中的 ERROR/CRITICAL 条目（兜底机制）。"""
        errors: list[dict] = []
        log_patterns = [
            "maxma.log",
            "maxma.log.1",
            "maxma.log.2",
            "maxma.log.3",
            "maxma.log.4",
            "maxma.log.5",
        ]
        for pattern in log_patterns:
            log_file = LOGS_DIR / pattern
            if not log_file.exists():
                continue
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    for line_num, line in enumerate(f, 1):
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            entry = json.loads(line)
                            level = entry.get("level", "")
                            if level in ("ERROR", "CRITICAL"):
                                errors.append(
                                    {
                                        "timestamp": entry.get("ts", ""),
                                        "level": level,
                                        "category": "log_file",
                                        "message": entry.get("msg", ""),
                                        "logger_name": entry.get("logger", ""),
                                        "session_id": entry.get("session_id"),
                                        "request_id": entry.get("request_id"),
                                        "trace_id": entry.get("trace_id"),
                                        "exception": entry.get("exception"),
                                        "source_file": pattern,
                                        "source_line": line_num,
                                    }
                                )
                        except json.JSONDecodeError:
                            # 非 JSON 行（旧格式或损坏），简单匹配关键词
                            if "ERROR" in line or "CRITICAL" in line:
                                errors.append(
                                    {
                                        "timestamp": "",
                                        "level": "UNKNOWN",
                                        "category": "log_file",
                                        "message": line[:500],
                                        "source_file": pattern,
                                        "source_line": line_num,
                                    }
                                )
            except (OSError, PermissionError):
                continue
        return errors

    def _collect_autonomy_status(self) -> dict:
        """收集自治层调度器状态（已移除 — OMP 替代）。"""
        return {"available": False, "reason": "Autonomy subsystem removed — OMP replaces it"}

    def _read_tauri_startup_log(self, max_lines: int = 100) -> dict:
        """读取 Tauri 启动日志的最后 N 行。

        日志文件路径：LOGS_DIR / tauri.log（打包模式下位于 %APPDATA%/MaxmaHere/logs/）。
        """
        tauri_log_path = LOGS_DIR / "tauri.log"
        try:
            if not tauri_log_path.exists():
                return {"available": False, "reason": "tauri.log 不存在"}

            # 读取文件最后 max_lines 行（避免大文件内存爆炸）
            try:
                with open(tauri_log_path, "r", encoding="utf-8", errors="replace") as f:
                    tail = deque(f, maxlen=max_lines)
                lines = list(tail)
            except (OSError, PermissionError) as e:
                return {"available": False, "reason": f"读取失败: {e}"}

            return {
                "available": True,
                "path": str(tauri_log_path),
                "line_count": len(lines),
                "lines": lines,
            }
        except Exception as e:
            logger.debug("[diagnostics] 读取 tauri.log 失败: %s", e, exc_info=True)
            return {"available": False, "reason": str(e)}

    @staticmethod
    def get_log_files_info() -> list[dict]:
        """返回日志目录中所有日志文件的信息（名称、大小、路径）。"""
        info_list: list[dict] = []
        try:
            if not LOGS_DIR.exists():
                return info_list
            for entry in sorted(LOGS_DIR.iterdir(), key=lambda p: p.name):
                if not entry.is_file():
                    continue
                if entry.suffix.lower() != ".log" and not entry.name.lower().startswith("maxma.log") and not entry.name.lower().startswith("tauri.log"):
                    # 只收集 .log 文件及 maxma.log.* / tauri.log.* 轮转文件
                    continue
                try:
                    size_bytes = entry.stat().st_size
                except OSError:
                    size_bytes = 0
                info_list.append({
                    "name": entry.name,
                    "size_bytes": size_bytes,
                    "size_mb": round(size_bytes / (1024 * 1024), 2),
                    "path": str(entry),
                })
        except Exception as e:
            logger.debug("[diagnostics] 收集日志文件信息失败: %s", e, exc_info=True)
        return info_list

    def _collect_system_info(self) -> dict:
        """收集系统信息（便于开发者复现问题）。"""
        info: dict = {
            "app_version": __version__,
            "python_version": sys.version.split()[0] if sys.version else "N/A",
            "platform": platform.platform(),
            "os_name": os.name,
            "machine": platform.machine(),
            "processor": platform.processor(),
            "uptime_seconds": int(time.time() - self._started_at),
            "logs_dir": str(LOGS_DIR),
            "data_dir": str(DATA_DIR),
        }
        try:
            info["cwd"] = os.getcwd()
        except Exception:
            info["cwd"] = "N/A"
        # 是否打包模式
        try:
            from app_paths import _is_frozen

            info["is_frozen"] = _is_frozen()
        except Exception:
            info["is_frozen"] = False
        # 环境变量（仅收集非敏感的运行模式标志）
        env_flags = {}
        for key in (
            "MAXMA_ENV",
            "MAXMA_LOG_LEVEL",
            "MAXMA_LOG_JSON",
            "MAXMA_API_PORT",
        ):
            val = os.environ.get(key)
            if val is not None:
                env_flags[key] = val
        info["env_flags"] = env_flags
        return info


# 模块级单例快捷引用
error_collector = ErrorCollector.get()
