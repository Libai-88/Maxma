"""自治调度器单元测试 — agent/autonomy/scheduler.py。

测试策略：
- mock 诊断函数和 runner
- 验证调度器启动/停止/幂等
- 验证 tick 流程：收集诊断 → 有问题时触发 runner
- 验证 autonomy_enabled=False 时不执行
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

@pytest.fixture(autouse=True)
def _reset_scheduler():
    """每个测试前后重置调度器状态。"""
    from agent.autonomy import scheduler
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    scheduler._last_tick_at = None
    scheduler._last_tick_report = None
    scheduler._tick_count = 0
    yield
    scheduler._scheduler_task = None
    scheduler._scheduler_loop = None
    scheduler._last_tick_at = None
    scheduler._last_tick_report = None
    scheduler._tick_count = 0


class TestSchedulerLifecycle:
    @pytest.mark.asyncio
    async def test_start_creates_task(self):
        """start_autonomy 启动后台任务。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)  # 让任务启动

        assert scheduler._scheduler_task is not None
        assert not scheduler._scheduler_task.done()

        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self):
        """stop_autonomy 取消后台任务。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)
        await stop_autonomy()

        # stop_autonomy sets _scheduler_task to None
        assert scheduler._scheduler_task is None

    @pytest.mark.asyncio
    async def test_start_is_idempotent(self):
        """重复调用 start_autonomy 不创建多个任务。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        start_autonomy(mock_app, interval_seconds=1)
        task2 = scheduler._scheduler_task

        # 应该是同一个任务（或旧的被取消后新的创建，但只有一个活跃）
        assert task2 is not None
        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_start_without_llm_does_not_crash(self):
        """LLM 未就绪时不崩溃。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = None

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)
        await stop_autonomy()
        # 不崩溃即通过


class TestSchedulerTick:
    @pytest.mark.asyncio
    async def test_stuck_tick_is_cancelled_and_reported_for_recovery(self):
        """超过恢复阈值的 tick 会被取消，外层循环可继续退避。"""
        from agent.autonomy.scheduler import StuckAutonomyTickError, _run_tick_with_timeout

        cancelled = asyncio.Event()

        async def blocked_tick(_app, self_improve_enabled=False):
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.set()

        with patch("agent.autonomy.scheduler._run_tick", side_effect=blocked_tick):
            with pytest.raises(StuckAutonomyTickError, match="recovery threshold"):
                await _run_tick_with_timeout(MagicMock(), False, timeout_seconds=0.01)

        assert cancelled.is_set()

    @pytest.mark.asyncio
    async def test_tick_timeout_wrapper_preserves_shutdown_cancellation(self):
        """应用关闭取消调度器时，不将 CancelledError 误记为卡死。"""
        from agent.autonomy.scheduler import _run_tick_with_timeout

        async def blocked_tick(_app, self_improve_enabled=False):
            await asyncio.sleep(60)

        with patch("agent.autonomy.scheduler._run_tick", side_effect=blocked_tick):
            task = asyncio.create_task(_run_tick_with_timeout(MagicMock(), False, timeout_seconds=60))
            await asyncio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    @pytest.mark.asyncio
    async def test_tick_collects_diagnostics(self):
        """tick 调用诊断函数收集数据。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = []

        mock_health_data = {"status": "ok", "llm": {"status": "ok"}, "memory": {"status": "ok"},
                           "native_tools": {"status": "ok"}, "mcp_tools": {"status": "ok"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app)

                    assert "error_summary" in report
                    assert "health_summary" in report
                    mock_improve.assert_not_called()  # 无问题时不触发自改进

    @pytest.mark.asyncio
    async def test_tick_triggers_self_improve_on_issues(self):
        """有高优先级问题时触发自改进。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = [
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health_data = {"status": "degraded", "llm": {"status": "degraded"},
                           "memory": {"status": "ok"}, "native_tools": {"status": "ok"},
                           "mcp_tools": {"status": "ok"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=True)

                    assert len(report["issues"]) > 0
                    mock_improve.assert_called_once()

    @pytest.mark.asyncio
    async def test_tick_does_not_trigger_without_self_improve_flag(self):
        """self_improve_enabled=False 时不触发自改进。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        mock_collector = MagicMock()
        mock_collector.get_all.return_value = [
            {"category": "llm_error", "message": "API timeout", "timestamp": "2026-07-09T10:00:00"}
        ]

        mock_health_data = {"status": "degraded", "llm": {"status": "degraded"}}

        with patch("agent.autonomy.scheduler._get_error_collector", return_value=mock_collector):
            with patch("agent.autonomy.scheduler._get_health_data", return_value=mock_health_data):
                with patch("agent.autonomy.scheduler._run_self_improve", new_callable=AsyncMock) as mock_improve:
                    report = await _run_tick(mock_app, self_improve_enabled=False)

                    assert len(report["issues"]) > 0
                    mock_improve.assert_not_called()

    @pytest.mark.asyncio
    async def test_tick_exception_does_not_crash(self):
        """tick 内部异常不崩溃，返回错误报告。"""
        from agent.autonomy.scheduler import _run_tick

        mock_app = MagicMock()

        with patch("agent.autonomy.scheduler._get_error_collector", side_effect=RuntimeError("crash")):
            report = await _run_tick(mock_app)

            assert "error" in report


class TestSchedulerStatus:
    @pytest.mark.asyncio
    async def test_get_status_when_stopped(self):
        """调度器未启动时 status.running=False。"""
        from agent.autonomy.scheduler import get_autonomy_status
        status = get_autonomy_status()
        assert status["running"] is False
        assert status["last_tick_at"] is None

    @pytest.mark.asyncio
    async def test_get_status_when_running(self):
        """调度器启动后 status.running=True。"""
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy, get_autonomy_status

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=1)
        await asyncio.sleep(0.1)

        status = get_autonomy_status()
        assert status["running"] is True

        await stop_autonomy()

    @pytest.mark.asyncio
    async def test_initial_delay_before_first_tick(self):
        """initial_delay 秒内不执行第一次 tick。"""
        from agent.autonomy import scheduler
        from agent.autonomy.scheduler import start_autonomy, stop_autonomy

        mock_app = MagicMock()
        mock_app.state.llm = MagicMock()

        start_autonomy(mock_app, interval_seconds=10, initial_delay=5)
        await asyncio.sleep(0.2)

        # initial_delay=5, 短暂等待后不应有 tick 执行
        assert scheduler._tick_count == 0

        await stop_autonomy()
