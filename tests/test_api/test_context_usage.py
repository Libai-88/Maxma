"""测试 — api/context_usage.py 上下文窗口用量估算。

覆盖 count_tokens / _normalize_message_content / _count_message_tokens /
estimate_context_usage。
"""

import pytest

from api.context_usage import (
    _count_message_tokens,
    _normalize_message_content,
    count_tokens,
    estimate_context_usage,
)


class TestCountTokens:
    def test_empty_string(self):
        assert count_tokens("") == 0

    def test_non_string(self):
        assert count_tokens(None) == 0
        assert count_tokens(123) == 0
        assert count_tokens([]) == 0

    def test_normal_text(self):
        n = count_tokens("hello world")
        assert n > 0
        # 更长的文本 token 更多
        assert count_tokens("hello world foo bar baz") > n

    def test_unicode(self):
        n = count_tokens("你好世界")
        assert n > 0


class TestNormalizeMessageContent:
    def test_string_passthrough(self):
        assert _normalize_message_content("hello") == "hello"

    def test_none_returns_empty(self):
        assert _normalize_message_content(None) == ""

    def test_non_string_non_none_to_str(self):
        assert _normalize_message_content(42) == "42"

    def test_list_with_text_blocks(self):
        content = [
            {"type": "text", "text": "hello"},
            {"type": "text", "text": "world"},
        ]
        assert _normalize_message_content(content) == "hello world"

    def test_list_with_non_text_blocks(self):
        content = [
            {"type": "image", "url": "http://x"},
        ]
        result = _normalize_message_content(content)
        assert "image" in result
        assert "url" in result

    def test_list_with_non_dict_items(self):
        content = ["plain", "strings"]
        assert _normalize_message_content(content) == "plain strings"

    def test_list_empty_parts_filtered(self):
        content = [
            {"type": "text", "text": ""},
            {"type": "text", "text": "kept"},
        ]
        assert _normalize_message_content(content) == "kept"


class _FakeMsg:
    """模拟 LangChain 消息对象。"""

    def __init__(self, content, type="human", tool_calls=None,
                 additional_kwargs=None, tool_call_id=None):
        self.content = content
        self.type = type
        self.tool_calls = tool_calls
        self.additional_kwargs = additional_kwargs
        self.tool_call_id = tool_call_id


class TestCountMessageTokens:
    def test_basic_message(self):
        msg = _FakeMsg(content="hello world", type="human")
        t = _count_message_tokens(msg)
        assert t > 4  # content tokens + 4 overhead

    def test_with_tool_calls(self):
        msg = _FakeMsg(
            content="do thing",
            type="ai",
            tool_calls=[{"name": "bash", "args": {"cmd": "ls"}}],
        )
        t = _count_message_tokens(msg)
        assert t > 4

    def test_with_additional_kwargs(self):
        msg = _FakeMsg(
            content="hi",
            type="ai",
            additional_kwargs={"refusal": "I cannot"},
        )
        t = _count_message_tokens(msg)
        assert t > 4

    def test_with_tool_call_id(self):
        msg = _FakeMsg(
            content="result",
            type="tool",
            tool_call_id="call_123",
        )
        t = _count_message_tokens(msg)
        assert t > 4

    def test_no_content_attr(self):
        # 没有 content 属性时用 str(msg)
        class Bare:
            def __str__(self):
                return "bare"
        t = _count_message_tokens(Bare())
        assert t >= 4


class TestEstimateContextUsage:
    def test_basic_without_parts(self):
        msgs = [_FakeMsg("hello", type="human"), _FakeMsg("world", type="ai")]
        result = estimate_context_usage(msgs, system_prompt="sys", max_tokens=1000)
        assert result["current_tokens"] > 0
        assert result["max_tokens"] == 1000
        assert result["usage_percent"] > 0
        assert result["model_name"] == ""
        assert "breakdown" not in result

    def test_with_system_prompt_parts(self):
        msgs = [_FakeMsg("hello", type="human")]
        parts = [
            {"key": "identity", "label": "身份", "content": "you are an agent"},
            {"key": "rules", "label": "规则", "content": "follow rules"},
        ]
        result = estimate_context_usage(
            msgs, system_prompt="", max_tokens=1000,
            system_prompt_parts=parts,
        )
        assert "breakdown" in result
        bd = result["breakdown"]
        assert bd["system_prompt"]["total"] > 0
        assert len(bd["system_prompt"]["parts"]) == 2
        assert bd["system_prompt"]["parts"][0]["label"] == "身份"
        assert bd["messages"]["total"] > 0
        # human 消息应在 breakdown 中
        human_parts = [p for p in bd["messages"]["parts"] if p["key"] == "human"]
        assert len(human_parts) == 1
        assert human_parts[0]["count"] == 1

    def test_max_tokens_zero(self):
        msgs = [_FakeMsg("hello", type="human")]
        result = estimate_context_usage(msgs, system_prompt="", max_tokens=0)
        assert result["usage_percent"] == 0.0

    def test_unknown_role_fallbacks_to_human(self):
        msg = _FakeMsg("mystery", type="unknown_role")
        result = estimate_context_usage([msg], system_prompt="", max_tokens=1000,
                                        system_prompt_parts=[
                                            {"key": "k", "label": "L", "content": "x"}
                                        ])
        # unknown_role 不在 known buckets 中 → fallback 到 human
        bd = result["breakdown"]
        assert bd["messages"]["parts"][0]["key"] == "human"

    def test_tool_messages_in_breakdown(self):
        msgs = [
            _FakeMsg("use tool", type="human"),
            _FakeMsg("calling", type="ai"),
            _FakeMsg("result", type="tool"),
        ]
        result = estimate_context_usage(msgs, system_prompt="", max_tokens=1000,
                                        system_prompt_parts=[
                                            {"key": "k", "label": "L", "content": "x"}
                                        ])
        bd = result["breakdown"]
        keys = {p["key"] for p in bd["messages"]["parts"]}
        assert keys == {"human", "ai", "tool"}
