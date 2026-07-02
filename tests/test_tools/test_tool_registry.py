"""Tests for tools registry consistency checks."""

from types import SimpleNamespace

import pytest

import tools


def _fake_tools(names: list[str]) -> list[SimpleNamespace]:
    return [SimpleNamespace(name=name) for name in names]


def test_validate_tool_registry_accepts_current_declarations():
    declared_names = sorted({
        name
        for category_names in tools.TOOL_CATEGORIES.values()
        for name in category_names
    })

    tools.validate_tool_registry(_fake_tools(declared_names))


def test_validate_tool_registry_rejects_stale_tool_name():
    declared_names = {
        name
        for category_names in tools.TOOL_CATEGORIES.values()
        for name in category_names
    }
    declared_names.remove("geocode_address")
    declared_names.add("geocode")

    with pytest.raises(tools.ToolRegistryError, match="unregistered tools"):
        tools.validate_tool_registry(_fake_tools(sorted(declared_names)))
