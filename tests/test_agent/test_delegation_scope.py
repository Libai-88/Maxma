"""DelegationScope 单元测试 — agent/delegation_scope.py。

测试策略：
- 纯数据 + 集合运算，无 I/O、无 LLM、无图依赖
- 覆盖：交集、空集拒绝、路径收窄、token/time 上限取 min
"""
import pytest

from agent.delegation_scope import DelegationScope, intersect, from_parent_context


class TestDelegationScopeDataclass:
    def test_construct_full_scope(self):
        s = DelegationScope(
            allowed_tools={"file_read", "file_write", "kb_search"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        assert s.allowed_tools == {"file_read", "file_write", "kb_search"}
        assert s.allowed_paths == {"D:/Projects"}
        assert s.max_tokens == 4000
        assert s.time_limit_seconds == 120

    def test_empty_scope_is_valid(self):
        s = DelegationScope(
            allowed_tools=set(),
            allowed_paths=set(),
            max_tokens=0,
            time_limit_seconds=0,
        )
        assert s.is_empty()


class TestIntersect:
    def test_intersection_yields_common_tools_and_paths(self):
        parent = DelegationScope(
            allowed_tools={"file_read", "file_write", "kb_search", "tavily_search"},
            allowed_paths={"D:/Projects", "D:/Docs"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_read", "kb_search", "git_status"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        assert result.allowed_tools == {"file_read", "kb_search"}
        assert result.allowed_paths == {"D:/Projects"}
        assert result.max_tokens == 4000
        assert result.time_limit_seconds == 120

    def test_intersection_with_disjoint_tools_yields_empty(self):
        parent = DelegationScope(
            allowed_tools={"file_read"},
            allowed_paths={"D:/Projects"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_delete", "run_python"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        assert result.allowed_tools == set()
        assert result.is_empty()

    def test_intersection_is_monotonic_child_never_exceeds_parent(self):
        """核心安全不变量：交集结果永远不会大于父范围。"""
        parent = DelegationScope(
            allowed_tools={"file_read", "file_write"},
            allowed_paths={"D:/Projects"},
            max_tokens=8000,
            time_limit_seconds=180,
        )
        child_request = DelegationScope(
            allowed_tools={"file_read", "file_write", "file_delete"},
            allowed_paths={"D:/Projects", "C:/Windows"},
            max_tokens=10000,
            time_limit_seconds=300,
        )
        result = intersect(parent, child_request)
        assert result.allowed_tools <= parent.allowed_tools
        assert result.allowed_paths <= parent.allowed_paths
        assert result.max_tokens <= parent.max_tokens
        assert result.time_limit_seconds <= parent.time_limit_seconds
        assert "file_delete" not in result.allowed_tools
        assert "C:/Windows" not in result.allowed_paths


class TestFromParentContext:
    def test_construct_from_lists(self):
        s = from_parent_context(
            allowed_tools=["file_read", "kb_search"],
            allowed_paths=["D:/Projects"],
            max_tokens=8000,
            time_limit_seconds=180,
        )
        assert s.allowed_tools == frozenset({"file_read", "kb_search"})
        assert s.allowed_paths == frozenset({"D:/Projects"})

    def test_empty_parent_makes_everything_empty(self):
        """父范围为空时，任何子请求都收窄为空。"""
        parent = DelegationScope()
        child_request = DelegationScope(
            allowed_tools={"file_read"},
            allowed_paths={"D:/Projects"},
            max_tokens=4000,
            time_limit_seconds=120,
        )
        result = intersect(parent, child_request)
        assert result.is_empty()
