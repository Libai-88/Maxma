"""自治调度器 — 后台周期性自诊断 + 自改进。

模式：参考 memory/ttl.py 的单例调度器模式。
- start_autonomy() 幂等启动（先 cancel 旧任务）
- stop_autonomy() 幂等关闭
- _run_tick() 单次诊断 + 可选自改进
- 异常隔离：tick 内部异常不杀死循环

用法::

    from agent.autonomy.scheduler import start_autonomy, stop_autonomy

    start_autonomy(app, interval_seconds=3600)
    # ...
    await stop_autonomy()
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import traceback
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional

from agent.autonomy.diagnostics import (
    ErrorSummary,
    collect_error_summary,
    collect_health_summary,
    build_diagnostic_report,
)

logger = logging.getLogger(__name__)

# 全局调度状态（单例，进程内只允许一个调度任务）
_scheduler_task: Optional[asyncio.Task] = None
_scheduler_loop: Optional[asyncio.AbstractEventLoop] = None

# 状态追踪（供 REST API 查询）
_last_tick_at: Optional[str] = None
_last_tick_report: Optional[dict] = None
_tick_count: int = 0

# === 调度恢复策略（参考 Halo scheduler DESIGN.md §2.3 / §2.4）===

MAX_CONSECUTIVE_FAILURES = 5
# 固定的五档上限。失败次数达到最后一档后会自动禁用调度器，避免无界重试。
BACKOFF_LEVELS_SECONDS = (30, 60, 5 * 60, 15 * 60, 60 * 60)
MAX_BACKOFF_INTERVAL = BACKOFF_LEVELS_SECONDS[-1]
STUCK_TICK_THRESHOLD_SECONDS = 2 * 60 * 60


class StuckAutonomyTickError(TimeoutError):
    """自治 tick 超过可恢复阈值时抛出。"""


@dataclass
class BackoffState:
    """调度器退避状态。

    - consecutive_failures: 连续失败次数
    - base_interval: 正常调度间隔（秒）；没有失败时使用
    - max_interval: 保留给旧调用方的最大退避上限（秒）
    - disabled: 是否被自动禁用
    """

    base_interval: int = 3600
    max_interval: int = MAX_BACKOFF_INTERVAL
    consecutive_failures: int = 0
    disabled: bool = False
    last_backoff_seconds: Optional[float] = None

    def record_failure(self) -> None:
        """记录一次失败，增加退避。"""
        self.consecutive_failures += 1
        if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
            self.disabled = True
            logger.warning(
                "[autonomy] 调度器连续失败 %d 次，已自动禁用",
                self.consecutive_failures,
            )

    def record_success(self) -> None:
        """记录一次成功，重置退避。"""
        self.consecutive_failures = 0
        self.disabled = False
        self.last_backoff_seconds = None

    def is_disabled(self) -> bool:
        """是否已被自动禁用。"""
        return self.disabled


def compute_next_interval(
    state: BackoffState,
    random_uniform: Callable[[float, float], float] = random.uniform,
) -> float:
    """计算下一次失败后的退避间隔。

    失败使用 30s、1m、5m、15m、60m 五档上限。第二次失败起采用
    decorrelated jitter：从 30s 到 ``min(当前档位, 上次延迟 * 3)``
    取值，既避免多个实例同时重试，也不会超过当前失败档位。

    ``random_uniform`` 可注入，以保持调度行为和测试可重复。函数会把
    本次延迟记入 state，供下一次去相关抖动使用。
    """
    if state.consecutive_failures == 0:
        return state.base_interval

    level_index = min(state.consecutive_failures - 1, len(BACKOFF_LEVELS_SECONDS) - 1)
    level_cap = min(float(BACKOFF_LEVELS_SECONDS[level_index]), float(state.max_interval))
    minimum = min(float(BACKOFF_LEVELS_SECONDS[0]), level_cap)

    if state.last_backoff_seconds is None:
        interval = level_cap
    else:
        upper_bound = min(level_cap, max(minimum, state.last_backoff_seconds * 3))
        interval = random_uniform(minimum, upper_bound)

    state.last_backoff_seconds = interval
    return interval


def compute_anchor_grid_delay(
    anchor_seconds: float,
    interval_seconds: float,
    now_seconds: float,
) -> float:
    """返回锚点网格中严格位于 ``now_seconds`` 之后的下次延迟。

    调度器休眠、离线或执行过久时，函数会跳过所有错过的周期，仅选择
    下一个网格点。因此一次恢复最多补偿当前 tick，不会形成补跑风暴。
    """
    if interval_seconds <= 0:
        raise ValueError("interval_seconds must be positive")
    if now_seconds < anchor_seconds:
        return anchor_seconds - now_seconds

    elapsed = now_seconds - anchor_seconds
    completed_slots = math.floor(elapsed / interval_seconds)
    next_anchor = anchor_seconds + (completed_slots + 1) * interval_seconds
    return max(0.0, next_anchor - now_seconds)


async def _run_tick_with_timeout(
    app: Any,
    self_improve_enabled: bool,
    timeout_seconds: float = STUCK_TICK_THRESHOLD_SECONDS,
) -> dict:
    """运行一次 tick；超过阈值时取消它，使调度循环可以恢复。"""
    try:
        return await asyncio.wait_for(
            _run_tick(app, self_improve_enabled=self_improve_enabled),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise StuckAutonomyTickError(
            f"autonomy tick exceeded {timeout_seconds:.0f}s recovery threshold"
        ) from exc


def start_autonomy(
    app: Any,
    interval_seconds: int = 3600,
    self_improve_enabled: bool = False,
    initial_delay: int = 30,
) -> Optional[asyncio.Task]:
    """启动后台自治调度器。

    若已有任务在运行，先取消旧任务再启动新任务（幂等）。

    Args:
        app: FastAPI 应用实例（需 app.state.llm / app.state.session_manager）
        interval_seconds: 执行间隔（秒）
        self_improve_enabled: 是否允许自改进（创建/更新 Skills）
        initial_delay: 首次 tick 前的延迟（秒），让系统稳定

    Returns:
        已启动的 asyncio.Task，或 None（LLM 未就绪时）
    """
    global _scheduler_task, _scheduler_loop

    # 检查 LLM 是否就绪
    llm = getattr(app.state, "llm", None)
    if llm is None:
        logger.info("[autonomy] LLM 未就绪，调度器暂不启动")
        return None

    # 取消已有任务
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()

    _scheduler_loop = asyncio.get_running_loop()

    async def _autonomy_loop():
        global _last_tick_at, _last_tick_report, _tick_count
        logger.info(
            "[autonomy] 调度器已启动，间隔 %ds，自改进=%s，初始延迟 %ds",
            interval_seconds, self_improve_enabled, initial_delay,
        )
        # 初始延迟：让系统稳定后再开始诊断
        if initial_delay > 0:
            await asyncio.sleep(initial_delay)

        backoff = BackoffState(
            base_interval=interval_seconds,
            max_interval=MAX_BACKOFF_INTERVAL,
        )
        # Keep ordinary runs on one monotonic-time grid. A long suspension or
        # slow tick is compensated by jumping to the next future slot instead
        # of replaying every missed interval.
        scheduler_loop = asyncio.get_running_loop()
        anchor_seconds = scheduler_loop.time()

        while True:
            if backoff.is_disabled():
                logger.warning("[autonomy] 调度器已自动禁用，停止循环")
                break
            try:
                report = await _run_tick_with_timeout(
                    app,
                    self_improve_enabled=self_improve_enabled,
                )
                _last_tick_at = datetime.now().isoformat()
                _last_tick_report = report
                _tick_count += 1
                if "error" in report:
                    raise RuntimeError(f"autonomy tick failed: {report['error']}")
                backoff.record_success()
            except asyncio.CancelledError:
                logger.info("[autonomy] 调度器被取消")
                break
            except Exception as e:
                logger.warning("[autonomy] tick 异常（不杀死循环）: %s", e)
                backoff.record_failure()

            if backoff.is_disabled():
                # Do not leave an auto-disabled scheduler sleeping for an
                # additional backoff period before its state becomes visible.
                break

            normal_delay = compute_anchor_grid_delay(
                anchor_seconds,
                interval_seconds,
                scheduler_loop.time(),
            )
            if backoff.consecutive_failures:
                # Backoff can only defer a normal run; it never advances the
                # anchor-grid schedule. This mirrors the persistent scheduler
                # contract while avoiding retries that bunch up after offline.
                retry_delay = compute_next_interval(backoff)
                next_interval = max(normal_delay, retry_delay)
                logger.info(
                    "[autonomy] 下次运行延迟: %.1fs（连续失败 %d 次）",
                    next_interval, backoff.consecutive_failures,
                )
            else:
                next_interval = normal_delay
            await asyncio.sleep(next_interval)

    _scheduler_task = _scheduler_loop.create_task(_autonomy_loop())
    return _scheduler_task


async def stop_autonomy() -> None:
    """停止后台自治调度器（幂等）。"""
    global _scheduler_task, _scheduler_loop
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    _scheduler_task = None
    _scheduler_loop = None
    logger.info("[autonomy] 调度器已停止")


def get_autonomy_status() -> dict:
    """获取调度器运行状态（供 REST API 查询）。"""
    running = _scheduler_task is not None and not _scheduler_task.done()
    return {
        "running": running,
        "last_tick_at": _last_tick_at,
        "last_tick_report_summary": (
            {
                "issues_count": len(_last_tick_report.get("issues", [])),
                "error_total": _last_tick_report.get("error_summary", {}).get("total", 0),
                "health_status": _last_tick_report.get("health_summary", {}).get("overall_status", "unknown"),
            }
            if _last_tick_report else None
        ),
        "tick_count": _tick_count,
    }


def _get_error_collector() -> Any:
    """获取 ErrorCollector 单例。"""
    try:
        from api.diagnostics import error_collector
        return error_collector
    except Exception:
        return None


def _get_health_data(app) -> dict:
    """获取健康检查数据（同步读取，不调用 HTTP）。"""
    try:
        from api.health import check_health_sync
        return check_health_sync(app)
    except Exception:
        # 回退：返回最小健康数据
        return {
            "status": "unknown",
            "llm": {"status": "unknown"},
            "memory": {"status": "unknown"},
            "native_tools": {"status": "unknown"},
            "mcp_tools": {"status": "unknown"},
        }


async def _run_tick(
    app: Any,
    self_improve_enabled: bool = False,
) -> dict:
    """执行一次诊断 tick。

    流程：
    1. 收集错误摘要
    2. 收集健康摘要
    3. 构建诊断报告
    4. 如果有问题且 self_improve_enabled → 触发自改进

    Returns:
        诊断报告 dict
    """
    try:
        # 1. 收集错误
        collector = _get_error_collector()
        error_summary = collect_error_summary(collector) if collector else ErrorSummary(
            total=0, by_category={}, recent_messages=[]
        )

        # 2. 收集健康
        health_data = _get_health_data(app)
        health_summary = collect_health_summary(health_data)

        # 3. 构建报告
        report = build_diagnostic_report(error_summary, health_summary)
        logger.info(
            "[autonomy] tick 完成: %d 错误, 状态=%s, %d 问题",
            error_summary.total,
            health_summary.overall_status,
            len(report["issues"]),
        )

        # 4. 自改进
        if self_improve_enabled and report["issues"]:
            llm = getattr(app.state, "llm", None)
            if llm is not None:
                try:
                    await _run_self_improve(app, report)
                except Exception as e:
                    logger.warning("[autonomy] 自改进执行失败: %s", e)
                    # 上报到 ErrorCollector（延迟导入已在 _get_error_collector 内）
                    try:
                        collector = _get_error_collector()
                        if collector is not None:
                            collector.add_error(
                                level="WARNING",
                                category="autonomy",
                                message=f"自改进执行失败: {e}",
                                exception="".join(
                                    traceback.format_exception(type(e), e, e.__traceback__)
                                ),
                            )
                    except Exception:
                        logger.debug("[autonomy] ErrorCollector 上报失败（自改进失败）", exc_info=True)

        return report
    except Exception as e:
        logger.warning("[autonomy] tick 异常: %s", e)
        # 上报到 ErrorCollector（延迟导入已在 _get_error_collector 内）
        try:
            collector = _get_error_collector()
            if collector is not None:
                collector.add_error(
                    level="ERROR",
                    category="autonomy",
                    message=f"tick 异常: {e}",
                    exception="".join(
                        traceback.format_exception(type(e), e, e.__traceback__)
                    ),
                )
        except Exception:
            logger.debug("[autonomy] ErrorCollector 上报失败（tick 异常）", exc_info=True)
        return {"error": str(e), "generated_at": None}


async def _run_self_improve(app: Any, report: dict) -> str:
    """触发自改进 Agent 会话。

    使用 headless Agent 执行（无 WS、无 HITL）。
    复用 server.py 的 _run_event_hook_action 模式。

    Args:
        app: FastAPI 应用实例
        report: 诊断报告

    Returns:
        Agent 执行结果文本
    """
    from agent.autonomy.runner import run_self_improvement_agent
    from config.settings import get_settings
    from app_paths import DATA_DIR

    settings = get_settings()
    timeout = settings.autonomy_max_agent_timeout

    # 构造 transcript 路径
    transcript_dir = DATA_DIR / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    transcript_path = transcript_dir / f"autonomy-{timestamp}.jsonl"

    return await run_self_improvement_agent(
        app=app,
        diagnostic_report=report,
        timeout=timeout,
        transcript_path=transcript_path,
    )
