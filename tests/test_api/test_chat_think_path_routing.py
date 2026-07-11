"""Server-side ThinkPath execution and model-routing boundaries."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from api.routes.chat import _resolve_think_path_execution, _think_path_runtime_context


class _ProviderManager:
    def __init__(self, selected=None):
        self.selected = selected
        self.roles = []

    def select_for_role(self, role):
        self.roles.append(role)
        return self.selected


def _roles_file(tmp_path: Path) -> Path:
    path = tmp_path / "model_roles.yaml"
    path.write_text("roles:\n  analysis:\n    min_context_window: 32768\n", encoding="utf-8")
    return path


def test_think_path_is_inert_while_its_feature_flag_is_disabled(tmp_path):
    manager = _ProviderManager()

    result = _resolve_think_path_execution(
        "deep",
        think_path_enabled=False,
        declarative_model_routing_enabled=True,
        has_explicit_model_selection=False,
        provider_manager=manager,
        model_roles_path=_roles_file(tmp_path),
    )

    assert result.path is None
    assert result.provider is None
    assert manager.roles == []


def test_explicit_provider_or_model_wins_over_think_path_routing(tmp_path):
    provider = SimpleNamespace(config=SimpleNamespace(id="analysis-provider"))
    manager = _ProviderManager((provider, "analysis-model"))

    result = _resolve_think_path_execution(
        "deep",
        think_path_enabled=True,
        declarative_model_routing_enabled=True,
        has_explicit_model_selection=True,
        provider_manager=manager,
        model_roles_path=_roles_file(tmp_path),
    )

    assert result.path is not None and result.path.id == "deep"
    assert result.provider is None
    assert result.model_name is None
    assert manager.roles == []


def test_enabled_deep_path_routes_only_through_declared_server_role(tmp_path):
    provider = SimpleNamespace(config=SimpleNamespace(id="analysis-provider"))
    manager = _ProviderManager((provider, "analysis-model"))

    result = _resolve_think_path_execution(
        "DEEP",
        think_path_enabled=True,
        declarative_model_routing_enabled=True,
        has_explicit_model_selection=False,
        provider_manager=manager,
        model_roles_path=_roles_file(tmp_path),
    )

    assert result.path is not None and result.path.id == "deep"
    assert result.provider is provider
    assert result.model_name == "analysis-model"
    assert manager.roles[0].name == "analysis"


def test_unknown_path_or_missing_role_keeps_default_model_route(tmp_path):
    manager = _ProviderManager()

    unknown = _resolve_think_path_execution(
        "arbitrary-role",
        think_path_enabled=True,
        declarative_model_routing_enabled=True,
        has_explicit_model_selection=False,
        provider_manager=manager,
        model_roles_path=_roles_file(tmp_path),
    )
    missing_role = _resolve_think_path_execution(
        "deep",
        think_path_enabled=True,
        declarative_model_routing_enabled=True,
        has_explicit_model_selection=False,
        provider_manager=manager,
        model_roles_path=tmp_path / "does-not-exist.yaml",
    )

    assert unknown.path is None
    assert missing_role.path is not None
    assert missing_role.provider is None
    assert manager.roles[-1] is None


def test_runtime_guidance_uses_only_fixed_server_owned_path_content():
    result = _resolve_think_path_execution(
        "light",
        think_path_enabled=True,
        declarative_model_routing_enabled=False,
        has_explicit_model_selection=False,
        provider_manager=None,
    )

    context = _think_path_runtime_context(result.path)

    assert "用户已确认" in context
    assert "轻量" in context
    assert "<script" not in context
