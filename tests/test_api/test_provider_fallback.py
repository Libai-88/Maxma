"""阶段 3.3 测试：Provider 优先级排序、健康状态管理与 fallback 链路。

测试覆盖：
1. ProviderConfig.priority 字段 — 默认值、自定义值
2. HealthStatus — degraded 状态（介于 ok 和 error 之间）
3. Provider.is_healthy / is_unhealthy 属性
4. ProviderManager.iter_enabled — 按 priority 升序排序
5. ProviderManager.get_healthy — 跳过 health_status == error 的 provider
6. ProviderManager.get_fallback — 跳过 exclude_ids + unhealthy
7. ProviderManager.mark_unhealthy / mark_healthy / mark_degraded — 状态变迁与计数
8. ProviderManager.get_all_health_status — 摘要字典
9. health_monitor._check_provider_health — check_health 结果驱动状态变迁
10. 端到端 fallback 场景 — 主 provider 失败 → fallback → 全部失败 → None
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from api.providers import HealthStatus, Provider, ProviderConfig
from api.providers.health_monitor import _check_provider_health
from api.providers.manager import ProviderManager


# ── 测试用 fake provider 与 store ──────────────────────────────


class _FakeProvider(Provider):
    """测试用 provider：create_llm 返回可识别对象，check_health 由用例注入。"""

    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self._health_result: HealthStatus = HealthStatus(status="ok", latency_ms=10.0)

    def set_health_result(self, result: HealthStatus) -> None:
        self._health_result = result

    def create_llm(self, model: str, **kwargs):
        return f"<LLM:{self.config.id}:{model}>"

    async def check_health(self) -> HealthStatus:
        return self._health_result


class _FakeStore:
    """内存 store：load_all 返回构造时传入的配置列表。"""

    def __init__(self, configs: list[ProviderConfig] | None = None):
        self._configs = list(configs or [])

    def load_all(self) -> list[ProviderConfig]:
        return list(self._configs)

    def save(self, config: ProviderConfig) -> None:
        for i, c in enumerate(self._configs):
            if c.id == config.id:
                self._configs[i] = config
                return
        self._configs.append(config)

    def delete(self, provider_id: str) -> bool:
        before = len(self._configs)
        self._configs = [c for c in self._configs if c.id != provider_id]
        return len(self._configs) < before

    @property
    def is_empty(self) -> bool:
        return not self._configs


def _make_config(
    pid: str,
    *,
    priority: int = 0,
    enabled: bool = True,
    models: list[str] | None = None,
) -> ProviderConfig:
    return ProviderConfig(
        id=pid,
        provider_type="openai",
        label=pid,
        api_key="sk-test",
        base_url="https://example.test/v1",
        models=models or [f"{pid}-model"],
        enabled=enabled,
        context_window=128_000,
        priority=priority,
    )


def _build_manager(configs: list[ProviderConfig]) -> ProviderManager:
    """构造 ProviderManager，使用 _FakeProvider 替换真实 OpenAIProvider。"""
    mgr = ProviderManager(_FakeStore(configs))
    # 拦截 _build_provider 使用 _FakeProvider
    original_build = ProviderManager._build_provider

    @staticmethod
    def _fake_build(config: ProviderConfig) -> _FakeProvider:
        return _FakeProvider(config)

    ProviderManager._build_provider = _fake_build
    try:
        mgr.load_all()
    finally:
        ProviderManager._build_provider = original_build
    return mgr


# ── 1. ProviderConfig.priority ─────────────────────────────────


class TestProviderConfigPriority:
    """阶段 3.3：ProviderConfig.priority 字段。"""

    def test_priority_defaults_to_zero(self):
        """未指定 priority 时默认 0（最高优先级）。"""
        config = _make_config("p1")
        assert config.priority == 0

    def test_priority_custom_value(self):
        """priority 可指定为任意整数。"""
        config = _make_config("p1", priority=10)
        assert config.priority == 10

    def test_priority_in_to_safe_dict(self):
        """to_safe_dict 应包含 priority 字段。"""
        config = _make_config("p1", priority=5)
        data = config.to_safe_dict()
        assert data["priority"] == 5

    def test_priority_in_to_dict(self):
        """to_dict 应包含 priority 字段。"""
        config = _make_config("p1", priority=7)
        data = config.to_dict()
        assert data["priority"] == 7


# ── 2. HealthStatus degraded 状态 ──────────────────────────────


class TestHealthStatusDegraded:
    """阶段 3.3：HealthStatus 新增 degraded 状态。"""

    def test_degraded_status(self):
        """degraded 状态可创建并读取。"""
        hs = HealthStatus(status="degraded", detail="slow response")
        assert hs.status == "degraded"
        assert hs.detail == "slow response"

    def test_ok_status(self):
        hs = HealthStatus(status="ok", latency_ms=42.5)
        assert hs.status == "ok"
        assert hs.latency_ms == 42.5

    def test_error_status(self):
        hs = HealthStatus(status="error", detail="connection refused")
        assert hs.status == "error"


# ── 3. Provider 健康状态属性 ───────────────────────────────────


class TestProviderHealthProperties:
    """阶段 3.3：Provider.is_healthy / is_unhealthy 属性。"""

    def test_is_healthy_when_status_none(self):
        """health_status 为 None（未检查）时 is_healthy=True。"""
        provider = _FakeProvider(_make_config("p1"))
        assert provider.health_status is None
        assert provider.is_healthy is True
        assert provider.is_unhealthy is False

    def test_is_healthy_when_status_ok(self):
        provider = _FakeProvider(_make_config("p1"))
        provider.health_status = HealthStatus(status="ok")
        assert provider.is_healthy is True
        assert provider.is_unhealthy is False

    def test_is_unhealthy_when_status_error(self):
        provider = _FakeProvider(_make_config("p1"))
        provider.health_status = HealthStatus(status="error", detail="boom")
        assert provider.is_healthy is False
        assert provider.is_unhealthy is True

    def test_degraded_not_unhealthy(self):
        """degraded 状态：is_unhealthy=False（不完全禁用，仍可被选中）。"""
        provider = _FakeProvider(_make_config("p1"))
        provider.health_status = HealthStatus(status="degraded")
        assert provider.is_unhealthy is False

    def test_initial_consecutive_failures_zero(self):
        """新 provider 的 consecutive_failures 应为 0。"""
        provider = _FakeProvider(_make_config("p1"))
        assert provider.consecutive_failures == 0
        assert provider.last_check_time == 0.0


# ── 4. ProviderManager.iter_enabled 按 priority 排序 ────────────


class TestIterEnabledPriority:
    """阶段 3.3：iter_enabled 按 priority 升序排序。"""

    def test_priority_ascending(self):
        """priority 数字越小越靠前。"""
        configs = [
            _make_config("p_high", priority=10),
            _make_config("p_low", priority=1),
            _make_config("p_mid", priority=5),
        ]
        mgr = _build_manager(configs)
        ids = [p.config.id for p in mgr.iter_enabled()]
        assert ids == ["p_low", "p_mid", "p_high"]

    def test_same_priority_keeps_insertion_order(self):
        """相同 priority 保持插入顺序（稳定排序）。"""
        configs = [
            _make_config("a", priority=0),
            _make_config("b", priority=0),
            _make_config("c", priority=0),
        ]
        mgr = _build_manager(configs)
        ids = [p.config.id for p in mgr.iter_enabled()]
        assert ids == ["a", "b", "c"]

    def test_iter_all_unsorted(self):
        """iter_all 返回原始顺序（不排序）。"""
        configs = [
            _make_config("z", priority=10),
            _make_config("a", priority=1),
        ]
        mgr = _build_manager(configs)
        ids = [p.config.id for p in mgr.iter_all()]
        assert ids == ["z", "a"]  # 原始插入顺序

    def test_count(self):
        configs = [_make_config("a"), _make_config("b"), _make_config("c")]
        mgr = _build_manager(configs)
        assert mgr.count == 3


# ── 5. ProviderManager.get_healthy ─────────────────────────────


class TestGetHealthy:
    """阶段 3.3：get_healthy 返回优先级最高的健康 provider。"""

    def test_returns_first_healthy(self):
        """无 unhealthy provider 时返回 priority 最高（数字最小）的。"""
        configs = [
            _make_config("p1", priority=10),
            _make_config("p2", priority=1),
        ]
        mgr = _build_manager(configs)
        result = mgr.get_healthy()
        assert result is not None
        assert result.config.id == "p2"

    def test_skips_unhealthy(self):
        """跳过 health_status == error 的 provider。"""
        configs = [
            _make_config("p1", priority=1),  # priority 最高但 unhealthy
            _make_config("p2", priority=5),
        ]
        mgr = _build_manager(configs)
        mgr.mark_unhealthy("p1", detail="boom")
        result = mgr.get_healthy()
        assert result is not None
        assert result.config.id == "p2"

    def test_all_unhealthy_returns_none(self):
        """全部 unhealthy 时返回 None。"""
        configs = [_make_config("p1"), _make_config("p2")]
        mgr = _build_manager(configs)
        mgr.mark_unhealthy("p1")
        mgr.mark_unhealthy("p2")
        assert mgr.get_healthy() is None

    def test_degraded_is_selectable(self):
        """degraded 状态的 provider 仍可被 get_healthy 选中。"""
        configs = [_make_config("p1", priority=1), _make_config("p2", priority=5)]
        mgr = _build_manager(configs)
        mgr.mark_degraded("p1", detail="slow")
        result = mgr.get_healthy()
        # degraded 不算 unhealthy，p1 仍可被选中
        assert result is not None
        assert result.config.id == "p1"

    def test_empty_manager_returns_none(self):
        mgr = _build_manager([])
        assert mgr.get_healthy() is None


# ── 6. ProviderManager.get_fallback ────────────────────────────


class TestGetFallback:
    """阶段 3.3：get_fallback 返回下一个可用 provider。"""

    def test_returns_next_available(self):
        """无排除项时返回 priority 最高的 provider。"""
        configs = [
            _make_config("p1", priority=10),
            _make_config("p2", priority=1),
        ]
        mgr = _build_manager(configs)
        result = mgr.get_fallback()
        assert result is not None
        assert result.config.id == "p2"

    def test_excludes_failed_provider(self):
        """排除已失败的 provider，返回下一个。"""
        configs = [
            _make_config("p1", priority=1),
            _make_config("p2", priority=5),
            _make_config("p3", priority=10),
        ]
        mgr = _build_manager(configs)
        result = mgr.get_fallback(exclude_ids={"p1"})
        assert result is not None
        assert result.config.id == "p2"

    def test_excludes_multiple(self):
        """排除多个 provider。"""
        configs = [
            _make_config("p1", priority=1),
            _make_config("p2", priority=5),
            _make_config("p3", priority=10),
        ]
        mgr = _build_manager(configs)
        result = mgr.get_fallback(exclude_ids={"p1", "p2"})
        assert result is not None
        assert result.config.id == "p3"

    def test_skips_unhealthy_in_fallback(self):
        """fallback 跳过 unhealthy 的 provider。"""
        configs = [
            _make_config("p1", priority=1),
            _make_config("p2", priority=5),
        ]
        mgr = _build_manager(configs)
        mgr.mark_unhealthy("p1", detail="boom")
        result = mgr.get_fallback(exclude_ids=set())  # 无排除但 p1 unhealthy
        assert result is not None
        assert result.config.id == "p2"

    def test_all_excluded_returns_none(self):
        """全部被排除时返回 None。"""
        configs = [_make_config("p1"), _make_config("p2")]
        mgr = _build_manager(configs)
        result = mgr.get_fallback(exclude_ids={"p1", "p2"})
        assert result is None

    def test_all_unhealthy_returns_none(self):
        """全部 unhealthy 时返回 None。"""
        configs = [_make_config("p1"), _make_config("p2")]
        mgr = _build_manager(configs)
        mgr.mark_unhealthy("p1")
        mgr.mark_unhealthy("p2")
        assert mgr.get_fallback() is None

    def test_degraded_is_selectable_in_fallback(self):
        """degraded 状态仍可被 fallback 选中。"""
        configs = [
            _make_config("p1", priority=1),
            _make_config("p2", priority=5),
        ]
        mgr = _build_manager(configs)
        mgr.mark_degraded("p1")
        result = mgr.get_fallback()
        assert result is not None
        assert result.config.id == "p1"  # degraded 不算 unhealthy

    def test_empty_exclude_ids_default(self):
        """exclude_ids 默认 None（空集合）。"""
        configs = [_make_config("p1")]
        mgr = _build_manager(configs)
        result = mgr.get_fallback()
        assert result is not None
        assert result.config.id == "p1"


# ── 7. ProviderManager mark_* 方法 ─────────────────────────────


class TestMarkMethods:
    """阶段 3.3：mark_unhealthy / mark_healthy / mark_degraded。"""

    def test_mark_unhealthy_increments_failures(self):
        """mark_unhealthy 递增 consecutive_failures。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")
        assert provider.consecutive_failures == 0

        mgr.mark_unhealthy("p1", detail="boom")
        assert provider.consecutive_failures == 1
        assert provider.health_status.status == "error"
        assert provider.is_unhealthy is True

        mgr.mark_unhealthy("p1", detail="boom again")
        assert provider.consecutive_failures == 2

    def test_mark_healthy_resets_failures(self):
        """mark_healthy 重置 consecutive_failures 为 0。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")

        mgr.mark_unhealthy("p1")
        mgr.mark_unhealthy("p1")
        assert provider.consecutive_failures == 2

        mgr.mark_healthy("p1", latency_ms=42.0)
        assert provider.consecutive_failures == 0
        assert provider.health_status.status == "ok"
        assert provider.health_status.latency_ms == 42.0
        assert provider.is_healthy is True

    def test_mark_degraded_does_not_increment_failures(self):
        """mark_degraded 不递增 consecutive_failures（不是错误）。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")

        mgr.mark_degraded("p1", detail="slow")
        assert provider.consecutive_failures == 0
        assert provider.health_status.status == "degraded"
        assert provider.is_unhealthy is False

    def test_mark_unhealthy_updates_last_check_time(self):
        """mark_unhealthy 更新 last_check_time。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")
        assert provider.last_check_time == 0.0

        mgr.mark_unhealthy("p1")
        assert provider.last_check_time > 0.0

    def test_mark_unknown_provider_is_noop(self):
        """对不存在的 provider_id 调用 mark_* 不抛异常。"""
        mgr = _build_manager([_make_config("p1")])
        # 不抛 KeyError 即可
        mgr.mark_unhealthy("nonexistent")
        mgr.mark_healthy("nonexistent")
        mgr.mark_degraded("nonexistent")


# ── 8. ProviderManager.get_all_health_status ──────────────────


class TestGetAllHealthStatus:
    """阶段 3.3：get_all_health_status 返回摘要字典。"""

    def test_all_unknown_initially(self):
        """未检查时 status 为 'unknown'。"""
        mgr = _build_manager([_make_config("p1"), _make_config("p2")])
        result = mgr.get_all_health_status()
        assert set(result.keys()) == {"p1", "p2"}
        assert result["p1"]["status"] == "unknown"
        assert result["p2"]["status"] == "unknown"

    def test_reflects_marked_status(self):
        """反映 mark_* 后的状态。"""
        configs = [
            _make_config("p1", priority=1),
            _make_config("p2", priority=5),
        ]
        mgr = _build_manager(configs)
        mgr.mark_unhealthy("p1", detail="boom")
        mgr.mark_healthy("p2", latency_ms=42.0)

        result = mgr.get_all_health_status()
        assert result["p1"]["status"] == "error"
        assert result["p1"]["consecutive_failures"] == 1
        assert result["p1"]["priority"] == 1
        assert result["p2"]["status"] == "ok"
        assert result["p2"]["latency_ms"] == 42.0
        assert result["p2"]["priority"] == 5


# ── 9. health_monitor._check_provider_health ──────────────────


class TestCheckProviderHealth:
    """阶段 3.3：health_monitor._check_provider_health 状态驱动。"""

    @pytest.mark.asyncio
    async def test_ok_result_marks_healthy(self):
        """check_health 返回 ok → mark_healthy。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")
        provider.set_health_result(HealthStatus(status="ok", latency_ms=15.0))

        await _check_provider_health(mgr, "p1")

        assert provider.health_status.status == "ok"
        assert provider.health_status.latency_ms == 15.0
        assert provider.consecutive_failures == 0

    @pytest.mark.asyncio
    async def test_error_result_marks_unhealthy(self):
        """check_health 返回 error → mark_unhealthy。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")
        provider.set_health_result(HealthStatus(status="error", detail="conn refused"))

        await _check_provider_health(mgr, "p1")

        assert provider.health_status.status == "error"
        assert provider.consecutive_failures == 1

    @pytest.mark.asyncio
    async def test_degraded_result_marks_degraded(self):
        """check_health 返回 degraded → mark_degraded（不递增 failures）。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")
        provider.set_health_result(HealthStatus(status="degraded", detail="slow"))

        await _check_provider_health(mgr, "p1")

        assert provider.health_status.status == "degraded"
        assert provider.consecutive_failures == 0

    @pytest.mark.asyncio
    async def test_timeout_marks_degraded(self):
        """check_health 超时 → mark_degraded（不是 unhealthy，避免完全禁用）。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")

        # 让 check_health 永远超时
        async def _slow_health():
            await asyncio.sleep(100)
            return HealthStatus(status="ok")

        provider.check_health = _slow_health  # type: ignore

        # 用 monkeypatch 把 wait_for 的 timeout 缩小到 0.05s
        import api.providers.health_monitor as hm

        original_wait_for = asyncio.wait_for

        async def _fast_wait_for(coro, timeout):
            return await original_wait_for(coro, 0.05)

        with patch.object(hm.asyncio, "wait_for", _fast_wait_for):
            await _check_provider_health(mgr, "p1")

        assert provider.health_status.status == "degraded"
        assert provider.health_status.detail is not None
        assert "timeout" in provider.health_status.detail.lower()

    @pytest.mark.asyncio
    async def test_exception_marks_unhealthy(self):
        """check_health 抛异常 → mark_unhealthy。"""
        mgr = _build_manager([_make_config("p1")])
        provider = mgr.get("p1")

        async def _boom_health():
            raise RuntimeError("network unreachable")

        provider.check_health = _boom_health  # type: ignore

        await _check_provider_health(mgr, "p1")

        assert provider.health_status.status == "error"
        assert provider.consecutive_failures == 1

    @pytest.mark.asyncio
    async def test_unknown_provider_is_noop(self):
        """对不存在的 provider_id 调用 _check_provider_health 不抛异常。"""
        mgr = _build_manager([_make_config("p1")])
        # 不抛 KeyError 即可
        await _check_provider_health(mgr, "nonexistent")


# ── 10. 端到端 fallback 场景 ───────────────────────────────────


class TestEndToEndFallback:
    """阶段 3.3：端到端 fallback 场景。"""

    def test_main_fails_fallback_succeeds(self):
        """主 provider 失败 → 标记 unhealthy → get_fallback 返回下一个。"""
        configs = [
            _make_config("main", priority=1),
            _make_config("backup", priority=5),
        ]
        mgr = _build_manager(configs)

        # 初始：main 是健康首选
        assert mgr.get_healthy().config.id == "main"

        # main 失败，标记 unhealthy
        mgr.mark_unhealthy("main", detail="500 error")
        assert mgr.get_healthy().config.id == "backup"

        # fallback 排除 main，得到 backup
        fallback = mgr.get_fallback(exclude_ids={"main"})
        assert fallback is not None
        assert fallback.config.id == "backup"

    def test_main_fails_all_fail_returns_none(self):
        """所有 provider 都失败 → get_healthy 返回 None。"""
        configs = [
            _make_config("main", priority=1),
            _make_config("backup", priority=5),
        ]
        mgr = _build_manager(configs)

        mgr.mark_unhealthy("main")
        mgr.mark_unhealthy("backup")

        assert mgr.get_healthy() is None
        assert mgr.get_fallback(exclude_ids={"main"}) is None

    def test_main_recovers_via_mark_healthy(self):
        """主 provider 恢复 → mark_healthy → 重新被 get_healthy 选中。"""
        configs = [
            _make_config("main", priority=1),
            _make_config("backup", priority=5),
        ]
        mgr = _build_manager(configs)

        # main 故障，切到 backup
        mgr.mark_unhealthy("main")
        assert mgr.get_healthy().config.id == "backup"

        # main 恢复
        mgr.mark_healthy("main", latency_ms=20.0)
        assert mgr.get_healthy().config.id == "main"

    def test_priority_ordering_drives_fallback(self):
        """多 provider 按 priority 排序，fallback 链路严格按 priority。"""
        configs = [
            _make_config("p3", priority=30),
            _make_config("p1", priority=10),
            _make_config("p2", priority=20),
        ]
        mgr = _build_manager(configs)

        # 验证初始顺序
        order = [p.config.id for p in mgr.iter_enabled()]
        assert order == ["p1", "p2", "p3"]

        # p1 失败 → fallback 到 p2（不是 p3）
        mgr.mark_unhealthy("p1")
        result = mgr.get_fallback(exclude_ids={"p1"})
        assert result.config.id == "p2"

        # p1 + p2 失败 → fallback 到 p3
        mgr.mark_unhealthy("p2")
        result = mgr.get_fallback(exclude_ids={"p1", "p2"})
        assert result.config.id == "p3"

        # 全部失败 → None
        mgr.mark_unhealthy("p3")
        result = mgr.get_fallback(exclude_ids={"p1", "p2"})
        assert result is None
