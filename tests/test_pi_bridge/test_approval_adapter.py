"""Coverage for api.pi_bridge.approval_adapter — tool approval-level mapping."""

from __future__ import annotations

import pytest

from api.pi_bridge.approval_adapter import (
    TOOL_APPROVAL_MAP,
    get_approval_level,
    is_high_risk,
)


class TestGetApprovalLevel:
    """get_approval_level(tool_name) -> 'read'/'write'/'interactive'/'ask'."""

    @pytest.mark.parametrize(
        "tool,expected",
        [
            # OMP 原生工具 — read
            ("read", "read"),
            ("glob", "read"),
            ("grep", "read"),
            ("inspect_image", "read"),
            ("web_search", "read"),
            ("ast_grep", "read"),
            ("recall", "read"),
            ("reflect", "read"),
            ("retain", "read"),
            # OMP 原生工具 — write
            ("write", "write"),
            ("edit", "write"),
            ("ast_edit", "write"),
            ("bash", "write"),
            ("eval", "write"),
            ("debug", "write"),
            ("github", "write"),
            ("ssh", "write"),
            ("browser", "write"),
            ("launch", "write"),
            ("task", "write"),
            ("job", "write"),
            ("checkpoint", "write"),
            ("rewind", "write"),
            ("todo", "write"),
            ("manage_skill", "write"),
            ("learn", "write"),
            ("memory_edit", "write"),
            # OMP 原生工具 — interactive
            ("ask", "interactive"),
        ],
    )
    def test_known_tools(self, tool: str, expected: str) -> None:
        assert get_approval_level(tool) == expected

    def test_unknown_tool_returns_ask_default(self) -> None:
        assert get_approval_level("nonexistent_tool") == "ask"

    def test_empty_string_returns_ask(self) -> None:
        assert get_approval_level("") == "ask"

    def test_every_map_entry_consistent(self) -> None:
        for tool, level in TOOL_APPROVAL_MAP.items():
            assert get_approval_level(tool) == level
            assert level in ("read", "write", "interactive")


class TestIsHighRisk:
    """is_high_risk(tool_name) -> bool. True for write/interactive."""

    @pytest.mark.parametrize(
        "tool,expected",
        [
            ("write", True),
            ("edit", True),
            ("bash", True),
            ("eval", True),
            ("github", True),
            ("ask", True),
            ("read", False),
            ("glob", False),
            ("grep", False),
            ("web_search", False),
            ("inspect_image", False),
        ],
    )
    def test_known_tools(self, tool: str, expected: bool) -> None:
        assert is_high_risk(tool) is expected

    def test_unknown_tool_not_high_risk(self) -> None:
        assert is_high_risk("nonexistent_tool") is False

    def test_empty_string_not_high_risk(self) -> None:
        assert is_high_risk("") is False


class TestToolApprovalMapContents:
    """Sanity-check the constant mapping."""

    def test_map_is_dict(self) -> None:
        assert isinstance(TOOL_APPROVAL_MAP, dict)

    def test_all_values_valid_levels(self) -> None:
        for level in TOOL_APPROVAL_MAP.values():
            assert level in ("read", "write", "interactive")

    def test_map_covers_omp_core_tools(self) -> None:
        """Ensure all core OMP tools are mapped."""
        core_tools = {"read", "write", "edit", "bash", "eval", "glob", "grep", "ask"}
        assert core_tools.issubset(set(TOOL_APPROVAL_MAP.keys()))
