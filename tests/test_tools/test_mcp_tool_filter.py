"""阶段 4.1 专项测试 — MCP 工具级 allowlist / blocklist 过滤。

覆盖 _filter_tool_by_name 的：
- 无 allowlist/blocklist（全部放行）
- allowlist 精确匹配 / 通配符匹配
- blocklist 精确匹配 / 通配符匹配
- allowlist + blocklist 同时配置（blocklist 优先）
- 含前缀 / 不含前缀的工具名
"""

import pytest

from tools.mcp import _filter_tool_by_name


class TestNoFilter:
    """未配置 allowlist/blocklist 时全部放行。"""

    def test_no_filter_passes_all(self):
        assert _filter_tool_by_name("github_search", "github", None, None) is True
        assert _filter_tool_by_name("github_create_issue", "github", None, None) is True
        assert _filter_tool_by_name("any_tool", "any", None, None) is True


class TestAllowlist:
    """allowlist 命中则保留，未命中则过滤。"""

    def test_allowlist_exact_match_short_name(self):
        # allowlist 用短名（不含 server_id 前缀）
        assert _filter_tool_by_name("github_search", "github", ["search"], None) is True
        assert _filter_tool_by_name("github_create", "github", ["search"], None) is False

    def test_allowlist_exact_match_full_name(self):
        # allowlist 用完整名（含 server_id 前缀）
        assert _filter_tool_by_name(
            "github_search", "github", ["github_search"], None
        ) is True
        assert _filter_tool_by_name(
            "github_create", "github", ["github_search"], None
        ) is False

    def test_allowlist_wildcard_pattern(self):
        # 通配符匹配
        assert _filter_tool_by_name(
            "github_search", "github", ["github_*"], None
        ) is True
        assert _filter_tool_by_name(
            "github_create_issue", "github", ["github_*"], None
        ) is True
        assert _filter_tool_by_name(
            "other_tool", "github", ["github_*"], None
        ) is False

    def test_allowlist_wildcard_short_name(self):
        # 通配符短名匹配
        assert _filter_tool_by_name(
            "github_search", "github", ["search_*"], None
        ) is False  # search_* 不匹配 search
        assert _filter_tool_by_name(
            "github_search_repos", "github", ["search_*"], None
        ) is True

    def test_allowlist_multiple_patterns(self):
        # 多个模式，命中任一即可
        patterns = ["search", "create_*", "github_list_*"]
        assert _filter_tool_by_name("github_search", "github", patterns, None) is True
        assert _filter_tool_by_name(
            "github_create_issue", "github", patterns, None
        ) is True
        assert _filter_tool_by_name(
            "github_list_repos", "github", patterns, None
        ) is True
        assert _filter_tool_by_name("github_delete", "github", patterns, None) is False

    def test_allowlist_empty_list_treated_as_no_restriction(self):
        # 空列表 = 不限制（与 None 等价）
        assert _filter_tool_by_name("github_search", "github", [], None) is True


class TestBlocklist:
    """blocklist 命中则过滤，未命中则保留。"""

    def test_blocklist_exact_match(self):
        assert _filter_tool_by_name(
            "github_search", "github", None, ["search"]
        ) is False
        assert _filter_tool_by_name(
            "github_create", "github", None, ["search"]
        ) is True

    def test_blocklist_wildcard(self):
        assert _filter_tool_by_name(
            "github_search", "github", None, ["github_*"]
        ) is False
        assert _filter_tool_by_name(
            "github_create_issue", "github", None, ["github_*"]
        ) is False
        # 不含 github_ 前缀的工具不受影响（但实际不会发生，因为前缀由 server_id 决定）
        assert _filter_tool_by_name(
            "other_tool", "github", None, ["github_*"]
        ) is True

    def test_blocklist_multiple_patterns(self):
        patterns = ["delete_*", "admin_*", "github_search"]
        assert _filter_tool_by_name(
            "github_delete_repo", "github", None, patterns
        ) is False
        assert _filter_tool_by_name(
            "github_admin_users", "github", None, patterns
        ) is False
        assert _filter_tool_by_name(
            "github_search", "github", None, patterns
        ) is False
        assert _filter_tool_by_name(
            "github_create", "github", None, patterns
        ) is True


class TestAllowlistAndBlocklistCombined:
    """allowlist + blocklist 同时配置时，blocklist 优先。"""

    def test_blocklist_overrides_allowlist(self):
        # 工具在 allowlist 内，但同时也在 blocklist 内 → 被屏蔽
        assert _filter_tool_by_name(
            "github_search", "github", ["search"], ["search"]
        ) is False

    def test_blocklist_overrides_allowlist_wildcard(self):
        # allowlist 允许 github_*，但 blocklist 屏蔽 github_search
        assert _filter_tool_by_name(
            "github_search", "github", ["github_*"], ["github_search"]
        ) is False
        # 其他 github_* 工具仍可用
        assert _filter_tool_by_name(
            "github_create", "github", ["github_*"], ["github_search"]
        ) is True

    def test_allowlist_filters_non_listed_then_blocklist_filters_listed(self):
        # allowlist = [search, create]；blocklist = [create]
        # → search 可用，create 被屏蔽，其他工具被 allowlist 过滤
        patterns_allow = ["search", "create"]
        patterns_block = ["create"]
        assert _filter_tool_by_name(
            "github_search", "github", patterns_allow, patterns_block
        ) is True
        assert _filter_tool_by_name(
            "github_create", "github", patterns_allow, patterns_block
        ) is False
        assert _filter_tool_by_name(
            "github_delete", "github", patterns_allow, patterns_block
        ) is False  # 不在 allowlist 内


class TestPrefixHandling:
    """工具名前缀处理。"""

    def test_tool_without_prefix_still_matched(self):
        # 工具名不含 server_id 前缀（异常情况但需兜底）
        assert _filter_tool_by_name("search", "github", ["search"], None) is True
        assert _filter_tool_by_name("search", "github", None, ["search"]) is False

    def test_different_server_prefix_not_matched(self):
        # server_id=github 但工具名以 other_ 开头（异常情况）
        # 短名提取后是 other_search，不匹配 allowlist=search
        assert _filter_tool_by_name(
            "other_search", "github", ["search"], None
        ) is False
