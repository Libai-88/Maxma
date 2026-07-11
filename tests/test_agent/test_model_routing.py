"""Tests for PLAN-1's opt-in declarative model routing primitives."""

from __future__ import annotations

from api.providers import HealthStatus, Provider, ProviderConfig
from api.providers.manager import ProviderManager
from agent.model_routing import ModelRole, load_model_roles, resolve_model_role
from agent.think_path import get_think_path, get_think_paths, should_offer_think_paths


class _FakeProvider(Provider):
    def create_llm(self, model: str, **kwargs):  # pragma: no cover - selection only
        return (self.config.id, model)

    async def check_health(self):  # pragma: no cover - selection only
        return HealthStatus(status="ok")


class _FakeStore:
    def __init__(self, configs: list[ProviderConfig]):
        self.configs = configs

    def load_all(self) -> list[ProviderConfig]:
        return list(self.configs)


def _config(
    provider_id: str,
    *,
    models: list[str] | None = None,
    capabilities: list[str] | None = None,
    cost_tier: int = 0,
    context_window: int = 128_000,
    priority: int = 0,
) -> ProviderConfig:
    return ProviderConfig(
        id=provider_id,
        provider_type="openai",
        label=provider_id,
        api_key="test-key",
        base_url=f"https://{provider_id}.example.test/v1",
        models=models or [f"{provider_id}-model"],
        capabilities=capabilities or [],
        cost_tier=cost_tier,
        context_window=context_window,
        priority=priority,
    )


def _manager(configs: list[ProviderConfig]) -> ProviderManager:
    manager = ProviderManager(_FakeStore(configs))
    original = ProviderManager._build_provider
    ProviderManager._build_provider = staticmethod(_FakeProvider)
    try:
        manager.load_all()
    finally:
        ProviderManager._build_provider = original
    return manager


def test_think_paths_are_only_offered_for_transparently_complex_requests():
    assert not should_offer_think_paths("你好")
    assert should_offer_think_paths("请分析两种实现的风险和迁移步骤")
    assert [path.id for path in get_think_paths("请分析两种实现的风险")] == [
        "light", "standard", "deep"
    ]
    assert get_think_path("not-a-path") is None


def test_role_configuration_ignores_invalid_entries(tmp_path):
    path = tmp_path / "model_roles.yaml"
    path.write_text(
        "roles:\n  analysis:\n    required_capabilities: [reasoning]\n    max_cost_tier: 2\n  broken: []\n",
        encoding="utf-8",
    )

    roles = load_model_roles(path)

    assert set(roles) == {"analysis"}
    assert roles["analysis"].required_capabilities == ("reasoning",)
    assert resolve_model_role(path, "ANALYSIS") == roles["analysis"]


def test_role_selection_is_deterministic_and_honours_declared_constraints():
    manager = _manager(
        [
            _config("too-expensive", capabilities=["reasoning"], cost_tier=3, priority=0),
            _config("wrong-capability", capabilities=["vision"], cost_tier=0, priority=0),
            _config("preferred", models=["fallback", "chosen"], capabilities=["reasoning"], cost_tier=2, priority=9),
            _config("cheap", models=["cheap-model"], capabilities=["reasoning"], cost_tier=0, priority=0),
        ]
    )
    role = ModelRole(
        name="analysis",
        preferred_provider_ids=("preferred",),
        preferred_models=("chosen",),
        required_capabilities=("reasoning",),
        min_context_window=32_768,
        max_cost_tier=2,
    )

    first = manager.select_for_role(role)
    second = manager.select_for_role(role)

    assert first is not None
    assert (first[0].config.id, first[1]) == ("preferred", "chosen")
    assert second is not None
    assert (second[0].config.id, second[1]) == ("preferred", "chosen")


def test_role_selection_skips_error_provider_and_returns_none_without_match():
    manager = _manager([_config("primary", capabilities=["reasoning"])])
    manager.mark_unhealthy("primary", "test")

    assert manager.select_for_role(ModelRole(name="analysis", required_capabilities=("reasoning",))) is None
