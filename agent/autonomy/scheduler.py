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
from datetime import datetime
from typing import Any, Optional

from agent.autonomy.diagnostics import (
    ErrorSummary,
    HealthSummary,
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
        while True:
            try:
                report = await _run_tick(app, self_improve_enabled=self_improve_enabled)
                _last_tick_at = datetime.now().isoformat()
                _last_tick_report = report
                _tick_count += 1
            except asyncio.CancelledError:
                logger.info("[autonomy] 调度器被取消")
                break
            except Exception as e:
                logger.warning("[autonomy] tick 异常（不杀死循环）: %s", e)

            await asyncio.sleep(interval_seconds)

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

        return report
    except Exception as e:
        logger.warning("[autonomy] tick 异常: %s", e)
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

    settings = get_settings()
    timeout = settings.autonomy_max_agent_timeout

    return await run_self_improvement_agent(
        app=app,
        diagnostic_report=report,
        timeout=timeout,
    )
