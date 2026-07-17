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
            ("file_write", "write"),
            ("file_manage", "write"),
            ("file_edit", "write"),
            ("file_read", "read"),
            ("file_search", "read"),
            ("run_python", "write"),
            ("tavily_search", "read"),
            ("tavily_extract", "read"),
            ("get_current_weather", "read"),
            ("call_sub_agent", "write"),
            ("parallel_execute", "write"),
            ("ask_user_qa", "interactive"),
            ("ask_user_confirm", "interactive"),
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
            ("file_write", True),
            ("file_edit", True),
            ("run_python", True),
            ("call_sub_agent", True),
            ("parallel_execute", True),
            ("ask_user_qa", True),
            ("ask_user_confirm", True),
            ("file_read", False),
            ("file_search", False),
            ("tavily_search", False),
            ("tavily_extract", False),
            ("get_current_weather", False),
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

    def test_map_has_expected_entries(self) -> None:
        expected_keys = {
            "file_write", "file_manage", "file_edit",
            "file_read", "file_search",
            "run_python",
            "tavily_search", "tavily_extract", "get_current_weather",
            "call_sub_agent", "parallel_execute",
            "ask_user_qa", "ask_user_confirm",
        }
        assert set(TOOL_APPROVAL_MAP.keys()) == expected_keys

    def test_all_values_valid_levels(self) -> None:
        for level in TOOL_APPROVAL_MAP.values():
            assert level in ("read", "write", "interactive")
