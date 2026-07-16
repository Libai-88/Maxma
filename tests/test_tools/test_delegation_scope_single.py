# GUARD: agent.delegation_scope
try:
    import agent.delegation_scope
except ImportError:
    import pytest
    pytest.skip("agent.delegation_scope module removed — OMP replaces it", allow_module_level=True)

"""DelegationScope 应用于 call_sub_agent 的测试。

复用 tool_parallel 的 _filter_tools_by_scope 逻辑，验证单 subagent 路径同样收窄。
"""
import pytest


class TestSingleSubAgentScope:
    def test_reuses_filter_function(self):
        """单 subagent 路径复用 tool_parallel 的过滤函数。"""
        from tools.sub_agent.tool_parallel import _filter_tools_by_scope
        from agent.delegation_scope import DelegationScope

        tools = ["file_read", "file_write", "kb_search"]
        scope = DelegationScope(
            allowed_tools=frozenset({"file_read", "kb_search"}),
            allowed_paths=frozenset({"D:/Projects"}),
        )
        filtered = _filter_tools_by_scope(tools, scope)
        assert set(filtered) == {"file_read", "kb_search"}

    def test_call_sub_agent_imports_helpers(self):
        """tool_call_sub_agent 模块能正常导入（验证导入路径正确）。"""
        from tools.sub_agent.tool_call_sub_agent import CallSubAgentTool
        tool = CallSubAgentTool()
        assert tool is not None
