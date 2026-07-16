"""轻量级运行时指标采集 — 内存存储 + SQLite 周期持久化，线程安全。

采集维度：
- HTTP 请求：计数、延迟分布、状态码分布
- 工具调用：计数、延迟、错误计数
- LLM 调用：计数、token 用量、延迟
- 错误计数（按类别）

内存始终是 source of truth：get_snapshot() 只读内存；
后台 flush 任务定期将快照写入 SQLite，重启后可通过 get_history() 恢复历史。
"""

import asyncio
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from api.db.metrics import MetricsDbStore

logger = logging.getLogger(__name__)


@dataclass
class _Histogram:
    """简易直方图 — 记录 count / sum / min / max，不存储原始值。"""

    count: int = 0
    total: float = 0.0
    min_val: float = float("inf")
    max_val: float = 0.0

    def observe(self, value: float) -> None:
        self.count += 1
        self.total += value
        if value < self.min_val:
            self.min_val = value
        if value > self.max_val:
            self.max_val = value

    def to_dict(self) -> dict[str, float]:
        if self.count == 0:
            return {"count": 0, "avg_ms": 0, "min_ms": 0, "max_ms": 0}
        return {
            "count": self.count,
            "avg_ms": round(self.total / self.count, 2),
            "min_ms": round(self.min_val, 2),
            "max_ms": round(self.max_val, 2),
        }

    def reset(self) -> None:
        self.count = 0
        self.total = 0.0
        self.min_val = float("inf")
        self.max_val = 0.0


class Metrics:
    """全局指标收集器 — 单例，线程安全。"""

    _instance: "Metrics | None" = None
    _lock = threading.Lock()

    # 持久化相关（不在 _init_state 中重置，避免 reset 丢失 DB 句柄 / 任务引用）
    _db: "MetricsDbStore | None" = None
    _flush_task: "asyncio.Task | None" = None
    _flush_interval: int = 60

    def __new__(cls) -> "Metrics":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    inst = super().__new__(cls)
                    inst._init_state()
                    cls._instance = inst
        return cls._instance

    def _init_state(self) -> None:
        self._mu = threading.Lock()
        self._start_time = time.monotonic()

        # HTTP 请求指标
        self._http_total = 0
        self._http_status: dict[int, int] = {}  # status_code -> count
        self._http_latency = _Histogram()  # 全局延迟
        self._http_by_path: dict[str, _Histogram] = {}  # path -> histogram

        # 工具调用指标
        self._tool_count: dict[str, int] = {}
        self._tool_errors: dict[str, int] = {}
        self._tool_latency: dict[str, _Histogram] = {}

        # LLM 调用指标
        self._llm_count = 0
        self._llm_tokens_in = 0
        self._llm_tokens_out = 0
        self._llm_latency = _Histogram()
        self._llm_by_model: dict[str, int] = {}

        # 错误计数
        self._error_count: dict[str, int] = {}

    # ── HTTP 指标 ────────────────────────────────────────────────

    def record_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
    ) -> None:
        """记录一次 HTTP 请求。"""
        with self._mu:
            self._http_total += 1
            self._http_status[status_code] = self._http_status.get(status_code, 0) + 1
            self._http_latency.observe(duration_ms)

            # 按路径分组（归一化：去掉 query string，限制路径段数）
            norm_path = self._normalize_path(method, path)
            if norm_path not in self._http_by_path:
                self._http_by_path[norm_path] = _Histogram()
            self._http_by_path[norm_path].observe(duration_ms)

    @staticmethod
    def _normalize_path(method: str, path: str) -> str:
        """归一化路径用于分组统计。"""
        # 去掉 query string
        p = path.split("?")[0]
        # 将 UUID/数字 ID 段替换为 :id
        parts = p.strip("/").split("/")
        normalized = []
        for part in parts:
            if not part:
                continue
            # 看起来像 UUID 或纯数字
            if len(part) == 36 and part.count("-") == 4:
                normalized.append(":id")
            elif part.isdigit():
                normalized.append(":id")
            else:
                normalized.append(part)
        return f"{method} /{'/'.join(normalized)}"

    # ── 工具指标 ─────────────────────────────────────────────────

    def record_tool_call(
        self,
        tool_name: str,
        latency_ms: float | None = None,
        is_error: bool = False,
    ) -> None:
        """记录一次工具调用。"""
        with self._mu:
            self._tool_count[tool_name] = self._tool_count.get(tool_name, 0) + 1
            if is_error:
                self._tool_errors[tool_name] = self._tool_errors.get(tool_name, 0) + 1
            if latency_ms is not None:
                if tool_name not in self._tool_latency:
                    self._tool_latency[tool_name] = _Histogram()
                self._tool_latency[tool_name].observe(latency_ms)

    # ── LLM 指标 ─────────────────────────────────────────────────

    def record_llm_call(
        self,
        model: str,
        tokens_in: int,
        tokens_out: int,
        latency_ms: float,
    ) -> None:
        """记录一次 LLM 调用。"""
        with self._mu:
            self._llm_count += 1
            self._llm_tokens_in += tokens_in
            self._llm_tokens_out += tokens_out
            self._llm_latency.observe(latency_ms)
            self._llm_by_model[model] = self._llm_by_model.get(model, 0) + 1

    # ── 错误指标 ─────────────────────────────────────────────────

    def record_error(self, category: str) -> None:
        """记录一次错误事件。category 如 'tool', 'llm', 'http_5xx'。"""
        with self._mu:
            self._error_count[category] = self._error_count.get(category, 0) + 1

    # ── 限流指标（阶段 3.2）──────────────────────────────────────

    def record_rate_limit(self, scope: str = "http") -> None:
        """记录一次被限流的请求。

        Args:
            scope: 限流来源，'http' 或 'ws'
        """
        with self._mu:
            key = f"rate_limit_{scope}"
            self._error_count[key] = self._error_count.get(key, 0) + 1

    # ── 快照输出 ─────────────────────────────────────────────────

    def get_snapshot(self) -> dict[str, Any]:
        """返回当前指标快照（线程安全）。"""
        with self._mu:
            uptime = time.monotonic() - self._start_time

            # 工具统计合并
            tool_stats: dict[str, dict] = {}
            for name, count in sorted(self._tool_count.items(), key=lambda x: -x[1]):
                entry: dict[str, Any] = {"count": count}
                if name in self._tool_errors:
                    entry["errors"] = self._tool_errors[name]
                if name in self._tool_latency:
                    entry["latency"] = self._tool_latency[name].to_dict()
                tool_stats[name] = entry

            # HTTP 按路径 top 10
            top_paths = sorted(
                self._http_by_path.items(),
                key=lambda x: -x[1].count,
            )[:10]

            return {
                "uptime_seconds": round(uptime, 1),
                "http": {
                    "total_requests": self._http_total,
                    "status_codes": dict(sorted(self._http_status.items())),
                    "latency_ms": self._http_latency.to_dict(),
                    "top_paths": {
                        path: hist.to_dict() for path, hist in top_paths
                    },
                },
                "tools": {
                    "total_calls": sum(self._tool_count.values()),
                    "total_errors": sum(self._tool_errors.values()),
                    "by_tool": tool_stats,
                },
                "llm": {
                    "total_calls": self._llm_count,
                    "total_tokens_in": self._llm_tokens_in,
                    "total_tokens_out": self._llm_tokens_out,
                    "latency_ms": self._llm_latency.to_dict(),
                    "by_model": dict(self._llm_by_model),
                },
                "errors": dict(self._error_count),
            }

    def reset(self) -> None:
        """重置所有指标（用于测试）。"""
        with self._mu:
            self._init_state()
        # 同步清理持久化数据（容忍 DB 不可用，避免破坏 reset 语义）
        db = self._db
        if db is not None:
            try:
                db.clear_all()
            except Exception as e:
                logger.warning("[metrics] 清理 DB 失败: %s", e)

    # ── 持久化 ───────────────────────────────────────────────

    def _get_db(self) -> "MetricsDbStore":
        """惰性获取 DB store（lazy import 避免循环依赖 / 无 DB 环境下的单元测试）。"""
        if self._db is None:
            from api.db.metrics import MetricsDbStore
            self._db = MetricsDbStore()
        return self._db

    def persist_snapshot(self) -> None:
        """将当前内存快照写入 SQLite。"""
        snapshot = self.get_snapshot()
        record = {
            "timestamp": datetime.now().isoformat(),
            "uptime_seconds": snapshot.get("uptime_seconds", 0.0),
            "http": snapshot.get("http", {}),
            "tools": snapshot.get("tools", {}),
            "llm": snapshot.get("llm", {}),
            "errors": snapshot.get("errors", {}),
        }
        try:
            self._get_db().save_snapshot(record)
        except Exception as e:
            logger.warning("[metrics] 持久化快照失败: %s", e)

    def get_history(self, window_seconds: int = 3600) -> list[dict]:
        """返回最近 window_seconds 秒内的持久化快照（按时间升序）。"""
        return self._get_db().get_history(window_seconds)

    def start_flush_task(self, interval_seconds: int = 60) -> None:
        """启动后台定期 flush 任务（幂等 — 不会重复启动）。"""
        if self._flush_task is not None and not self._flush_task.done():
            return
        self._flush_interval = interval_seconds
        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.info("[metrics] 后台 flush 任务已启动，间隔 %ds", interval_seconds)

    async def _flush_loop(self) -> None:
        """后台循环：定期将内存快照 persist 到 SQLite。"""
        while True:
            await asyncio.sleep(self._flush_interval)
            try:
                self.persist_snapshot()
            except Exception as e:
                logger.warning("[metrics] 后台 flush 失败: %s", e)

    async def stop_flush_task(self) -> None:
        """停止后台 flush 任务，并执行最后一次 flush（最终落盘）。"""
        if self._flush_task is not None and not self._flush_task.done():
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
            logger.info("[metrics] 后台 flush 任务已停止")
        # 最终 flush
        try:
            self.persist_snapshot()
        except Exception as e:
            logger.warning("[metrics] 最终 flush 失败: %s", e)


# ── 便捷函数 ─────────────────────────────────────────────────────

def get_metrics() -> Metrics:
    """获取全局 Metrics 单例。"""
    return Metrics()
