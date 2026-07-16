# GUARD: agent.delegation_scope
try:
    import agent.delegation_scope
except ImportError:
    import pytest
    pytest.skip("agent.delegation_scope module removed — OMP replaces it", allow_module_level=True)

"""DelegationScope 应用于 parallel_execute 的测试。

测试策略：
- 验证 delegation_scope_enforced=False 时行为不变（向后兼容）
- 验证 enforcement 启用时，子 agent 的工具集被收窄
"""

import pytest
try:
    import agent.delegation_scope
except ImportError:
    pytest.skip("agent.delegation_scope module removed — OMP replaces it", allow_module_level=True)

import pytest

from agent.delegation_scope import DelegationScope, intersect


class TestDelegationScopeNotEnforced:
    """delegation_scope_enforced=False（默认）时，不应用 scope。"""

    def test_parallel_execute_tool_exists(self):
        from tools.sub_agent.tool_parallel import ParallelExecuteTool
        tool = ParallelExecuteTool()
        assert tool is not None


class TestDelegationScopeEnforced:
    """delegation_scope_enforced=True 时，子 agent 工具被收窄。"""

    def test_filter_tools_by_scope(self):
        """scope 过滤函数：保留交集内工具，剔除交集外工具。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope

        all_tools = ["file_read", "file_write", "file_delete", "kb_search", "run_python"]
        # 注：intersect() 对 paths 也是 fail-closed，因此两侧 allowed_paths 必须有交集
        parent_scope = DelegationScope(
            allowed_tools=frozenset({"file_read", "kb_search", "tavily_search"}),
            allowed_paths=frozenset({"D:/Projects"}),
        )
        child_request = DelegationScope(
            allowed_tools=frozenset({"file_read", "file_write", "kb_search"}),
            allowed_paths=frozenset({"D:/Projects"}),
        )
        effective = intersect(parent_scope, child_request)
        filtered = _filter_tools_by_scope(all_tools, effective)
        assert set(filtered) == {"file_read", "kb_search"}
        assert "file_delete" not in filtered
        assert "run_python" not in filtered

    def test_empty_scope_yields_empty_tools(self):
        """空 scope 时所有工具被剔除。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope

        all_tools = ["file_read", "file_write"]
        empty_scope = DelegationScope()
        filtered = _filter_tools_by_scope(all_tools, empty_scope)
        assert filtered == []
