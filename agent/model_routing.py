"""Declarative, health-aware model-role routing.

Routing is deliberately opt-in and only applies when a user did not explicitly
choose a provider/model.  A role originates from a visible ThinkPath choice or
from a caller that already has an explicit, non-sensitive role; it is not
derived from opaque prompt classification.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class ModelRole:
    name: str
    preferred_provider_ids: tuple[str, ...] = ()
    preferred_models: tuple[str, ...] = ()
    required_capabilities: tuple[str, ...] = ()
    min_context_window: int = 0
    max_cost_tier: int | None = None


def load_model_roles(path: str | Path) -> dict[str, ModelRole]:
    """Load a deliberately small YAML schema, ignoring malformed entries.

    Invalid config must never make a chat request fail: callers fall back to
    the existing selected/default model when no usable rule is returned.
    """
    try:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return {}
    entries = raw.get("roles", raw) if isinstance(raw, dict) else {}
    if not isinstance(entries, dict):
        return {}

    roles: dict[str, ModelRole] = {}
    for role_name, value in entries.items():
        if not isinstance(role_name, str) or not isinstance(value, dict):
            continue
        name = role_name.strip().lower()
        if not name:
            continue
        roles[name] = ModelRole(
            name=name,
            preferred_provider_ids=_strings(value.get("preferred_provider_ids")),
            preferred_models=_strings(value.get("preferred_models")),
            required_capabilities=_strings(value.get("required_capabilities")),
            min_context_window=_non_negative_int(value.get("min_context_window")),
            max_cost_tier=_optional_non_negative_int(value.get("max_cost_tier")),
        )
    return roles


def resolve_model_role(path: str | Path, role_name: str | None) -> ModelRole | None:
    if not isinstance(role_name, str):
        return None
    return load_model_roles(path).get(role_name.strip().lower())


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item.strip() for item in value if isinstance(item, str) and item.strip())


def _non_negative_int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _optional_non_negative_int(value: Any) -> int | None:
    return _non_negative_int(value) if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
