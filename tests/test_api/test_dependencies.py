"""测试 — api/dependencies.py 共享资源惰性单例。

覆盖 get_system_prompt / get_tools 的惰性初始化与单例缓存行为。

安全相关：
- 验证单例缓存一旦建立后不再重复调用底层 builder（避免重复构造/资源泄漏）
- 验证 build_system_prompt 抛异常时不污染缓存，下次可重试
- 验证 get_tools 返回的可变列表在多次调用间保持同一引用（设计契约）
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

import api.dependencies as deps
from api.dependencies import get_system_prompt, get_tools


# ── 隔离 fixture ──────────────────────────────────────────────


@pytest.fixture(autouse=True)
def reset_singletons(monkeypatch):
    """每个测试前重置模块级单例为 None，确保测试隔离。

    使用 monkeypatch 在测试后自动恢复原始值。
    """
    monkeypatch.setattr(deps, "_system_prompt", None)
    monkeypatch.setattr(deps, "_tools", None)


@pytest.fixture
def mock_build_system_prompt(monkeypatch):
    """替换 build_system_prompt，返回受控的 fake 值。

    返回 MagicMock 实例，便于断言调用次数与参数。
    """
    fake = MagicMock(return_value="FAKE_SYSTEM_PROMPT")
    monkeypatch.setattr(deps, "build_system_prompt", fake)
    return fake


# ── get_system_prompt：缓存命中与未命中 ──────────────────────────


class TestGetSystemPrompt:
    def test_returns_string_from_build_system_prompt(self, mock_build_system_prompt):
        """缓存未命中 → 调用 build_system_prompt 并返回其结果。"""
        result = get_system_prompt()
        assert result == "FAKE_SYSTEM_PROMPT"

    def test_calls_build_system_prompt_when_cache_miss(self, mock_build_system_prompt):
        """缓存未命中时调用 build_system_prompt 恰好一次。"""
        get_system_prompt()
        mock_build_system_prompt.assert_called_once()
        mock_build_system_prompt.assert_called_once_with()

    def test_does_not_call_build_when_cache_hit(self, mock_build_system_prompt):
        """缓存命中后不再调用 build_system_prompt。"""
        first = get_system_prompt()
        second = get_system_prompt()
        assert first is second  # 同一对象引用
        mock_build_system_prompt.assert_called_once()

    def test_caches_first_value_even_if_build_changes(
        self, mock_build_system_prompt
    ):
        """单例缓存后即使 build_system_prompt 返回值变化也返回旧值。"""
        first = get_system_prompt()
        # 改变 build_system_prompt 的返回值
        mock_build_system_prompt.return_value = "DIFFERENT_VALUE"
        second = get_system_prompt()
        assert second is first  # 同一对象引用
        assert second == "FAKE_SYSTEM_PROMPT"
        mock_build_system_prompt.assert_called_once()

    def test_returns_empty_string_when_build_returns_empty(
        self, mock_build_system_prompt
    ):
        """build_system_prompt 返回空字符串时正常缓存。"""
        mock_build_system_prompt.return_value = ""
        result = get_system_prompt()
        assert result == ""
        assert isinstance(result, str)

    def test_empty_string_is_cached_not_rebuilt(self, mock_build_system_prompt):
        """空字符串是 truthy cache（非 None），下次不会重复调用 build。

        注意：缓存判断用 `is None`，空字符串不是 None，所以会命中缓存。
        """
        mock_build_system_prompt.return_value = ""
        first = get_system_prompt()
        second = get_system_prompt()
        assert first is second
        mock_build_system_prompt.assert_called_once()

    def test_returns_none_if_build_returns_none(self, mock_build_system_prompt):
        """如果 build_system_prompt 返回 None，get_system_prompt 返回 None。

        注意：由于缓存判断用 `is None`，返回 None 等价于未缓存，
        下次调用会重新调用 build_system_prompt。
        """
        mock_build_system_prompt.return_value = None
        result = get_system_prompt()
        assert result is None

    def test_none_return_does_not_cache(self, mock_build_system_prompt):
        """build_system_prompt 返回 None 时不缓存，下次会重新调用。"""
        mock_build_system_prompt.return_value = None
        get_system_prompt()
        get_system_prompt()
        get_system_prompt()
        # 每次都因为 _system_prompt 仍是 None 而重新调用
        assert mock_build_system_prompt.call_count == 3


# ── get_system_prompt：异常路径 ─────────────────────────────────


class TestGetSystemPromptExceptions:
    def test_build_exception_propagates(self, monkeypatch):
        """build_system_prompt 抛异常时，get_system_prompt 应向上传播异常。"""

        def raise_error():
            raise RuntimeError("build failed")

        monkeypatch.setattr(deps, "build_system_prompt", raise_error)
        with pytest.raises(RuntimeError, match="build failed"):
            get_system_prompt()

    def test_build_exception_does_not_cache(self, monkeypatch):
        """build_system_prompt 抛异常后，_system_prompt 仍为 None，下次会重试。"""
        call_count = {"n": 0}

        def raise_then_succeed():
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("first call fails")
            return "RECOVERED"

        monkeypatch.setattr(deps, "build_system_prompt", raise_then_succeed)

        # 第一次抛异常
        with pytest.raises(RuntimeError, match="first call fails"):
            get_system_prompt()
        assert call_count["n"] == 1

        # 第二次应成功（异常路径未赋值给 _system_prompt）
        result = get_system_prompt()
        assert result == "RECOVERED"
        assert call_count["n"] == 2

    def test_build_exception_then_cache_hit(self, monkeypatch):
        """异常后第二次成功，第三次应命中缓存不再调用 build。"""
        call_count = {"n": 0}

        def fail_then_succeed():
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise ValueError("fail")
            return "OK"

        monkeypatch.setattr(deps, "build_system_prompt", fail_then_succeed)

        with pytest.raises(ValueError):
            get_system_prompt()
        result = get_system_prompt()
        result2 = get_system_prompt()
        assert result == "OK"
        assert result2 is result
        assert call_count["n"] == 2  # 第三次命中缓存

    def test_build_exception_type_preserved(self, monkeypatch):
        """不同异常类型都应原样传播。"""

        def raise_type_error():
            raise TypeError("type issue")

        monkeypatch.setattr(deps, "build_system_prompt", raise_type_error)
        with pytest.raises(TypeError, match="type issue"):
            get_system_prompt()


# ── get_tools：惰性初始化与单例 ──────────────────────────────────


class TestGetTools:
    def test_returns_list(self):
        """get_tools 返回 list 类型。"""
        result = get_tools()
        assert isinstance(result, list)

    def test_returns_empty_list_on_first_call(self):
        """首次调用返回空列表。"""
        result = get_tools()
        assert result == []

    def test_returns_same_instance_on_subsequent_calls(self):
        """多次调用返回同一 list 对象引用（单例）。"""
        first = get_tools()
        second = get_tools()
        third = get_tools()
        assert first is second
        assert second is third

    def test_mutations_persist_across_calls(self):
        """修改返回的列表后，下次调用能看到这些修改（单例缓存契约）。"""
        first = get_tools()
        first.append("tool_a")
        first.append("tool_b")
        second = get_tools()
        assert second == ["tool_a", "tool_b"]
        assert second is first

    def test_extend_persists(self):
        """extend 操作也持久化。"""
        tools = get_tools()
        tools.extend([1, 2, 3])
        assert get_tools() == [1, 2, 3]

    def test_clear_then_append(self):
        """clear 后 append 仍作用于同一单例。"""
        tools = get_tools()
        tools.extend(["a", "b"])
        tools.clear()
        assert get_tools() == []
        get_tools().append("c")
        assert get_tools() == ["c"]

    def test_initial_list_is_mutable(self):
        """首次返回的空列表可修改。"""
        tools = get_tools()
        tools.append({"name": "test_tool"})
        assert tools == [{"name": "test_tool"}]

    def test_nested_objects_preserved(self):
        """嵌套对象在列表中保持引用。"""
        tools = get_tools()
        nested = {"name": "complex", "config": {"option": True}}
        tools.append(nested)
        result = get_tools()
        assert result[0] is nested
        assert result[0]["config"]["option"] is True


# ── 单例重置与显式注入 ──────────────────────────────────────────


class TestSingletonResetAndInjection:
    def test_reset_system_prompt_triggers_rebuild(
        self, mock_build_system_prompt, monkeypatch
    ):
        """重置 _system_prompt 后会重新调用 build_system_prompt。"""
        first = get_system_prompt()
        assert mock_build_system_prompt.call_count == 1
        # 模拟重置
        monkeypatch.setattr(deps, "_system_prompt", None)
        second = get_system_prompt()
        assert mock_build_system_prompt.call_count == 2
        # 第二次返回同一个 fake 的返回值（MagicMock 默认返回相同对象）
        assert second == first

    def test_reset_tools_returns_new_empty_list(self, monkeypatch):
        """重置 _tools 后 get_tools 返回新的空列表（不同于之前）。"""
        first = get_tools()
        first.append("persisted")
        # 重置
        monkeypatch.setattr(deps, "_tools", None)
        second = get_tools()
        assert second is not first
        assert second == []

    def test_explicit_system_prompt_cache_returned(
        self, monkeypatch, mock_build_system_prompt
    ):
        """显式设置 _system_prompt 后 get_system_prompt 直接返回，不调用 build。"""
        monkeypatch.setattr(deps, "_system_prompt", "PRESET_VALUE")
        result = get_system_prompt()
        assert result == "PRESET_VALUE"
        mock_build_system_prompt.assert_not_called()

    def test_explicit_tools_list_returned(self, monkeypatch):
        """显式设置 _tools 后 get_tools 直接返回该列表。"""
        preset = ["preset_tool"]
        monkeypatch.setattr(deps, "_tools", preset)
        result = get_tools()
        assert result is preset
        assert result == ["preset_tool"]

    def test_explicit_tools_list_mutations_persist(self, monkeypatch):
        """显式设置的 tools 列表修改也持久化。"""
        preset = []
        monkeypatch.setattr(deps, "_tools", preset)
        get_tools().append("dynamic")
        assert preset == ["dynamic"]

    def test_explicit_non_empty_system_prompt_not_rebuilt(
        self, monkeypatch, mock_build_system_prompt
    ):
        """显式设置非空字符串后不会触发 rebuild。"""
        monkeypatch.setattr(deps, "_system_prompt", "CACHED")
        for _ in range(10):
            assert get_system_prompt() == "CACHED"
        mock_build_system_prompt.assert_not_called()


# ── 模块级全局变量 ─────────────────────────────────────────────


class TestModuleGlobals:
    def test_system_prompt_global_initial_none(self):
        """reset_singletons fixture 后 _system_prompt 应为 None。"""
        assert deps._system_prompt is None

    def test_tools_global_initial_none(self):
        """reset_singletons fixture 后 _tools 应为 None。"""
        assert deps._tools is None

    def test_get_system_prompt_sets_global(self, mock_build_system_prompt):
        """调用 get_system_prompt 后 _system_prompt 被赋值。"""
        assert deps._system_prompt is None
        get_system_prompt()
        assert deps._system_prompt == "FAKE_SYSTEM_PROMPT"

    def test_get_tools_sets_global(self):
        """调用 get_tools 后 _tools 被赋值为空列表。"""
        assert deps._tools is None
        result = get_tools()
        assert deps._tools is result
        assert deps._tools == []

    def test_module_exports_get_system_prompt(self):
        """模块导出 get_system_prompt 函数。"""
        assert callable(deps.get_system_prompt)

    def test_module_exports_get_tools(self):
        """模块导出 get_tools 函数。"""
        assert callable(deps.get_tools)

    def test_get_system_prompt_returns_str(self, mock_build_system_prompt):
        """get_system_prompt 返回类型为 str（注解契约）。"""
        result = get_system_prompt()
        assert isinstance(result, str)

    def test_get_tools_returns_list_type(self):
        """get_tools 返回类型为 list（注解契约）。"""
        result = get_tools()
        assert isinstance(result, list)


# ── 安全边界 ───────────────────────────────────────────────────


class TestSecurityBoundaries:
    def test_system_prompt_string_immutable(self, mock_build_system_prompt):
        """返回的字符串不可变，调用方无法修改缓存。"""
        result = get_system_prompt()
        # str 是不可变类型，任何"修改"都会创建新对象
        assert isinstance(result, str)
        # 再次调用返回同一对象
        assert get_system_prompt() is result

    def test_tools_list_external_mutation_is_persistent(
        self, mock_build_system_prompt
    ):
        """验证 get_tools 返回的列表可被调用方修改，且修改持久化（设计行为）。

        这是一个已知的"按引用共享"行为，调用方需谨慎不要污染共享列表。
        """
        tools = get_tools()
        # 模拟外部代码修改列表
        tools.append({"name": "external_tool", "data": "payload"})
        # 下次调用返回的列表包含这个工具
        assert get_tools() == [{"name": "external_tool", "data": "payload"}]

    def test_malicious_tool_injected_via_shared_list(
        self, mock_build_system_prompt
    ):
        """安全测试：模拟恶意调用方在 tools 列表中注入恶意项。"""
        tools = get_tools()
        malicious_entry = {
            "name": "evil",
            "execute": "os.system('rm -rf /')",  # 模拟恶意 payload
        }
        tools.append(malicious_entry)
        # 后续调用能看到恶意项
        retrieved = get_tools()
        assert malicious_entry in retrieved

    def test_build_system_prompt_not_called_after_tools_access(
        self, mock_build_system_prompt
    ):
        """访问 get_tools 不应触发 get_system_prompt（独立单例）。"""
        get_tools()
        get_tools()
        get_tools()
        mock_build_system_prompt.assert_not_called()

    def test_tools_access_does_not_affect_system_prompt(
        self, mock_build_system_prompt
    ):
        """访问 get_tools 不影响 _system_prompt 的缓存状态。"""
        get_tools()
        assert deps._system_prompt is None
        get_system_prompt()
        assert deps._system_prompt == "FAKE_SYSTEM_PROMPT"

    def test_large_system_prompt_cached(self, mock_build_system_prompt):
        """大型 system prompt 也应被正确缓存。"""
        large_prompt = "x" * 100_000
        mock_build_system_prompt.return_value = large_prompt
        first = get_system_prompt()
        second = get_system_prompt()
        assert first is second
        assert len(first) == 100_000
        mock_build_system_prompt.assert_called_once()

    def test_unicode_system_prompt_cached(self, mock_build_system_prompt):
        """Unicode prompt 应被正确缓存。"""
        unicode_prompt = "系统提示 — 日本語 — العربية — emoji 🔒"
        mock_build_system_prompt.return_value = unicode_prompt
        result = get_system_prompt()
        assert result == unicode_prompt
        assert result is get_system_prompt()


# ── 并发与多次调用 ──────────────────────────────────────────────


class TestMultipleCalls:
    def test_many_calls_to_get_system_prompt_one_build(
        self, mock_build_system_prompt
    ):
        """100 次调用 get_system_prompt 只触发一次 build_system_prompt。"""
        for _ in range(100):
            get_system_prompt()
        mock_build_system_prompt.assert_called_once()

    def test_many_calls_to_get_tools_one_allocation(self):
        """100 次调用 get_tools 返回同一 list 实例。"""
        results = [get_tools() for _ in range(100)]
        first = results[0]
        assert all(r is first for r in results)

    def test_interleaved_calls(self, mock_build_system_prompt):
        """交替调用 get_system_prompt / get_tools 互不影响。"""
        sp1 = get_system_prompt()
        t1 = get_tools()
        t1.append("tool_1")
        sp2 = get_system_prompt()
        t2 = get_tools()
        sp3 = get_system_prompt()

        assert sp1 is sp2 is sp3
        assert t1 is t2
        assert t2 == ["tool_1"]
        mock_build_system_prompt.assert_called_once()
