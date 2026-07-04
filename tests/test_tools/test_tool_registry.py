"""Tests for tools registry consistency checks."""

from types import SimpleNamespace

import pytest

import tools
from tools.registry import (
    ToolRegistryError,
    clear_registry,
    discover_tools,
    get_registered_classes,
    register_tool,
)


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


# ── 工具发现与装饰器注册测试 ──


def test_discover_tools_finds_all_decorated_classes():
    """目录扫描应发现所有带 @register_tool 的类。"""
    # discover_tools 是幂等的，多次调用不影响结果
    discover_tools()
    registered = get_registered_classes()
    assert len(registered) > 0, "应至少发现一个工具"
    # 再次调用应得到相同结果（幂等）
    discover_tools()
    assert len(get_registered_classes()) == len(registered)


def test_get_all_tools_returns_same_count_as_registry():
    """get_all_tools() 返回数 = 装饰器注册数。"""
    discover_tools()
    expected = len(get_registered_classes())
    all_tools = tools.get_all_tools()
    assert len(all_tools) == expected, (
        f"get_all_tools() returned {len(all_tools)} tools, "
        f"but registry has {expected}"
    )


def test_register_tool_rejects_duplicate_name():
    """装饰器重复注册同名工具应抛错。"""

    class _ToolA:
        __module__ = "test_module_a"
        __qualname__ = "_ToolA"
        model_fields = {"name": type("F", (), {"default": "dup_tool_test"})()}

    class _ToolB:
        __module__ = "test_module_b"
        __qualname__ = "_ToolB"
        model_fields = {"name": type("F", (), {"default": "dup_tool_test"})()}

    register_tool(_ToolA)
    with pytest.raises(ToolRegistryError, match="已被"):
        register_tool(_ToolB)
    # 清理测试工具
    from tools.registry import _REGISTRY
    _REGISTRY.pop("dup_tool_test", None)


def test_registry_matches_tool_categories():
    """装饰器注册的工具与 TOOL_CATEGORIES 声明一致。"""
    discover_tools()
    registered = set(get_registered_classes().keys())
    categorized = {
        name for cat in tools.TOOL_CATEGORIES.values() for name in cat
    }
    uncategorized = sorted(registered - categorized)
    missing = sorted(categorized - registered)
    assert not uncategorized, f"已注册但未分类: {uncategorized}"
    assert not missing, f"已分类但未注册: {missing}"
