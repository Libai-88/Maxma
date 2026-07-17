"""Tests for ``agent.context_manager``.

Covers the pure compaction/trimming helpers, the cache-preserving compaction
builder, the structured-summary (de)serialisation, file-operation extraction,
and the backward-compat stubs.  ``count_tokens`` is monkeypatched to a cheap
deterministic fake so token thresholds are precise and tests stay fast.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

import agent.context_manager as cm


# ── shared helpers ─────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _fake_count_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic token estimate: 1 token per 4 chars + 1.

    Makes threshold-based logic in should_trim_context/trim_messages precise.
    """

    def _fake(text: str) -> int:
        if not isinstance(text, str) or not text:
            return 0
        return len(text) // 4 + 1

    monkeypatch.setattr(cm, "count_tokens", _fake)


class _FakeLLM:
    """Minimal async LLM stub for _llm_summarize tests."""

    def __init__(self, response_content: str = "## Goal\nsummary\n", exc: BaseException | None = None):
        self._content = response_content
        self._exc = exc
        self.calls: list = []

    async def ainvoke(self, messages):
        self.calls.append(messages)
        if self._exc is not None:
            raise self._exc
        return SimpleNamespace(content=self._content)


# ── CachePreservingCompaction + digest ─────────────────────────


def test_cache_preserving_compaction_messages_property() -> None:
    prefix = (SystemMessage(content="sys"),)
    summary = SystemMessage(content="[压缩] s")
    retained = (HumanMessage(content="hi"), AIMessage(content="yo"))
    c = cm.CachePreservingCompaction(prefix, summary, retained, metadata={"k": "v"})
    assert c.messages == [prefix[0], summary, retained[0], retained[1]]
    assert c.metadata == {"k": "v"}


def test_message_digest_stable_and_sensitive() -> None:
    msgs = [HumanMessage(content="hello"), AIMessage(content="world")]
    d1 = cm._message_digest(msgs)
    d2 = cm._message_digest(list(msgs))
    assert d1 == d2  # stable
    # different content -> different digest
    d3 = cm._message_digest([HumanMessage(content="hellox"), AIMessage(content="world")])
    assert d1 != d3


def test_message_digest_handles_non_str_content() -> None:
    msgs = [HumanMessage(content=[{"type": "text", "text": "x"}])]  # type: ignore[arg-type]
    # should not raise; str() fallback used
    d = cm._message_digest(msgs)
    assert isinstance(d, str) and len(d) == 64


# ── build_cache_preserving_compaction ──────────────────────────


def test_build_cache_preserving_compaction_happy_path() -> None:
    prefix = [SystemMessage(content="p")]
    source = [HumanMessage(content="old"), AIMessage(content="ans")]
    retained = [HumanMessage(content="new")]
    counter_calls: list[int] = []

    def counter(msgs) -> int:
        counter_calls.append(len(msgs))
        return 42

    result = cm.build_cache_preserving_compaction(
        fixed_prefix=prefix,
        source_messages=source,
        retained_messages=retained,
        summary_text="  condensed text  ",
        token_counter=counter,
    )

    assert result.fixed_prefix == tuple(prefix)
    assert result.retained_messages == tuple(retained)
    assert isinstance(result.summary_message, SystemMessage)
    assert result.summary_message.content.startswith("[上下文压缩 v1]")
    assert "condensed text" in result.summary_message.content
    meta = result.summary_message.additional_kwargs[cm.COMPACTION_METADATA_KEY]
    assert meta["summary_version"] == cm.COMPACTION_SUMMARY_VERSION
    for key in (
        "fixed_prefix_sha256",
        "source_sha256",
        "retained_sha256",
        "source_turn_boundary",
        "source_message_count",
        "retained_message_count",
        "source_token_count",
        "result_token_count",
    ):
        assert key in meta
    assert meta["source_message_count"] == 2
    assert meta["retained_message_count"] == 1
    assert meta["source_token_count"] == 42
    assert meta["result_token_count"] == 42
    # token_counter called once for source (4 msgs: prefix+source+retained),
    # once for result (3 msgs: prefix+summary+retained)
    assert counter_calls == [4, 3]
    # messages property reassembles in order
    assert result.messages[0] is prefix[0]
    assert result.messages[1] is result.summary_message
    assert result.messages[2] is retained[0]


def test_build_cache_preserving_compaction_empty_summary_raises() -> None:
    with pytest.raises(ValueError, match="summary_text must not be empty"):
        cm.build_cache_preserving_compaction(
            fixed_prefix=[],
            source_messages=[],
            retained_messages=[],
            summary_text="   ",
            token_counter=lambda _m: 0,
        )


# ── truncate_text_head_tail ────────────────────────────────────


def test_truncate_text_head_tail_short_text() -> None:
    text = "short text"
    head, tail = cm.truncate_text_head_tail(text, max_bytes=4096)
    assert head == text
    assert tail == ""


def test_truncate_text_head_tail_default_max_bytes() -> None:
    # default 4096 -> short text returned whole
    head, tail = cm.truncate_text_head_tail("x")
    assert head == "x"
    assert tail == ""


def test_truncate_text_head_tail_long_ascii() -> None:
    text = "a" * 10_000
    head, tail = cm.truncate_text_head_tail(text, max_bytes=120)
    assert "...(省略)..." in head
    assert "...(省略)..." in tail
    # reconstructed bytes within budget (head + tail content roughly bounded)
    assert len(head.encode("utf-8")) <= 120
    assert len(tail.encode("utf-8")) <= 120
    # tail contains the original ending
    assert head.startswith("a")
    assert tail.endswith("a")


def test_truncate_text_head_tail_multibyte_no_broken_utf8() -> None:
    # CJK chars are 3 bytes each in UTF-8; force a split that would land mid-char
    text = "语" * 1000  # 3000 bytes
    head, tail = cm.truncate_text_head_tail(text, max_bytes=100)
    # both halves must decode cleanly (no exception) and contain only whole chars
    assert all(ch == "语" for ch in head if ch not in ".\n（省略)…") or "语" in head
    assert "语" in tail or "...(省略)..." in tail


def test_truncate_text_head_tail_two_byte_leader_boundary() -> None:
    # Tiny max_bytes so head_size=1; first byte is a 2-byte UTF-8 leader (é=0xC3 0xA9).
    # Exercises the `(last & 0xE0) == 0xC0 and len < 2` fallback (line 123).
    text = "é" * 200
    head, tail = cm.truncate_text_head_tail(text, max_bytes=4)
    # must not raise; both halves decode cleanly
    assert "...(省略)..." in head
    assert "...(省略)..." in tail


def test_truncate_text_head_tail_three_byte_leader_boundary() -> None:
    # head_size=2 (max_bytes=6); 3-byte CJK leader trimmed to a lone leader byte.
    # Exercises the `(last & 0xF0) == 0xE0 and len < 3` fallback (line 125).
    text = "语" * 200  # 3 bytes per char
    head, tail = cm.truncate_text_head_tail(text, max_bytes=6)
    assert "...(省略)..." in head
    assert "...(省略)..." in tail


def test_truncate_text_head_tail_four_byte_leader_boundary() -> None:
    # head_size=3 (max_bytes=9); 4-byte char (𝄞 = U+1D11E) leader trimmed.
    # Exercises the `(last & 0xF8) == 0xF0 and len < 4` fallback (line 127).
    text = "𝄞" * 200  # 4 bytes per char
    head, tail = cm.truncate_text_head_tail(text, max_bytes=9)
    assert "...(省略)..." in head
    assert "...(省略)..." in tail


# ── _calc_min_turns / _count_turns ─────────────────────────────


def test_calc_min_turns_no_human_returns_default() -> None:
    assert cm._calc_min_turns([AIMessage(content="x")]) == cm.MIN_RECENT_TURNS_DEFAULT


def test_calc_min_turns_tool_heavy_returns_min() -> None:
    msgs = [HumanMessage(content="h"), ToolMessage(content="t", tool_call_id="1"), ToolMessage(content="t", tool_call_id="2"), ToolMessage(content="t", tool_call_id="3")]
    assert cm._calc_min_turns(msgs) == cm.MIN_RECENT_TURNS_MIN


def test_calc_min_turns_normal_returns_default() -> None:
    msgs = [HumanMessage(content="h"), ToolMessage(content="t", tool_call_id="1")]
    assert cm._calc_min_turns(msgs) == cm.MIN_RECENT_TURNS_DEFAULT


def test_calc_min_turns_text_only_returns_max() -> None:
    msgs = [HumanMessage(content="h"), AIMessage(content="a")]
    assert cm._calc_min_turns(msgs) == cm.MIN_RECENT_TURNS_MAX


def test_count_turns_counts_human_only() -> None:
    msgs = [HumanMessage(content="h1"), AIMessage(content="a"), HumanMessage(content="h2"), ToolMessage(content="t", tool_call_id="1")]
    assert cm._count_turns(msgs) == 2


# ── _find_trim_boundary ────────────────────────────────────────


def test_find_trim_boundary_single_message() -> None:
    assert cm._find_trim_boundary([HumanMessage(content="x")], min_turns=3) == 0


def test_find_trim_boundary_fewer_than_min() -> None:
    msgs = [HumanMessage(content="h1"), AIMessage(content="a1"), HumanMessage(content="h2")]
    assert cm._find_trim_boundary(msgs, min_turns=5) == 0


def test_find_trim_boundary_returns_nth_human_from_end() -> None:
    msgs = [
        HumanMessage(content="h1"),  # index 0
        AIMessage(content="a1"),
        HumanMessage(content="h2"),  # index 2
        AIMessage(content="a2"),
        HumanMessage(content="h3"),  # index 4
    ]
    # keep last 2 turns -> boundary at index 2 (h2)
    assert cm._find_trim_boundary(msgs, min_turns=2) == 2
    # keep last 1 turn -> boundary at index 4 (h3)
    assert cm._find_trim_boundary(msgs, min_turns=1) == 4


# ── _extract_entities ──────────────────────────────────────────


def test_extract_entities_paths_and_urls() -> None:
    msgs = [
        HumanMessage(content="see /etc/hosts and C:\\Users\\me\\file.txt and https://example.com/a?q=1 ."),
        AIMessage(content="also http://foo.io/x"),
    ]
    result = cm._extract_entities(msgs)
    assert "涉及的文件/路径" in result
    assert "涉及的 URL" in result
    assert "/etc/hosts" in result
    assert "C:\\Users\\me\\file.txt" in result
    assert "https://example.com/a?q=1" in result
    assert "http://foo.io/x" in result


def test_extract_entities_empty_when_none() -> None:
    assert cm._extract_entities([HumanMessage(content="just chat")]) == ""


def test_extract_entities_handles_non_str_and_empty() -> None:
    msgs = [HumanMessage(content=""), AIMessage(content=[{"x": 1}])]  # type: ignore[arg-type]
    assert cm._extract_entities(msgs) == ""


def test_extract_entities_caps_and_sorts() -> None:
    # 25 distinct paths -> capped at 20, sorted
    paths = [f"/dir{i}/file.txt" for i in range(25)]
    msgs = [HumanMessage(content=" ".join(paths))]
    result = cm._extract_entities(msgs)
    path_section = result.split("涉及的文件/路径")[1]
    listed = [line for line in path_section.splitlines() if line.startswith("- ")]
    assert len(listed) == 20
    # sorted -> first listed is /dir0/... or /dir1/...
    assert listed[0] == "- /dir0/file.txt"


# ── _summarize_old_messages ────────────────────────────────────


def test_summarize_old_messages_counts_and_recent() -> None:
    msgs = [
        HumanMessage(content="first question"),
        AIMessage(content="answer"),
        ToolMessage(content="tool output", tool_call_id="1"),
        HumanMessage(content="second " + "x" * 200),
    ]
    result = cm._summarize_old_messages(msgs)
    assert "2 条用户消息" in result
    assert "1 条 AI 回复" in result
    assert "1 次工具调用" in result
    assert "first question" in result
    # long user message truncated to 100 chars + ...
    assert "..." in result
    assert "second" in result


def test_summarize_old_messages_empty() -> None:
    result = cm._summarize_old_messages([])
    assert result.startswith("[历史对话摘要:")


def test_summarize_old_messages_appends_entities() -> None:
    msgs = [HumanMessage(content="see /etc/hosts and https://example.com")]
    result = cm._summarize_old_messages(msgs)
    # line 312: entities block appended
    assert "涉及的文件/路径" in result
    assert "/etc/hosts" in result
    assert "https://example.com" in result


# ── _llm_summarize ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_llm_summarize_happy_path() -> None:
    msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
    llm = _FakeLLM(response_content="## Goal\nstructured summary")
    result = await cm._llm_summarize(msgs, llm)
    assert "structured summary" in result
    assert llm.calls  # ainvoke was called


@pytest.mark.asyncio
async def test_llm_summarize_appends_entities() -> None:
    msgs = [HumanMessage(content="open /tmp/file.txt")]
    llm = _FakeLLM(response_content="summary")
    result = await cm._llm_summarize(msgs, llm)
    assert "涉及的文件/路径" in result
    assert "/tmp/file.txt" in result


@pytest.mark.asyncio
async def test_llm_summarize_fallback_when_no_conversation_parts() -> None:
    # only ToolMessage -> conversation_parts empty -> falls back to extraction summary
    msgs = [ToolMessage(content="t1", tool_call_id="1"), ToolMessage(content="t2", tool_call_id="2")]
    llm = _FakeLLM()
    result = await cm._llm_summarize(msgs, llm)
    assert not llm.calls  # ainvoke never called
    assert "2 次工具调用" in result


@pytest.mark.asyncio
async def test_llm_summarize_per_msg_limit_tier_large() -> None:
    # > 30 messages -> per_msg_limit 100; ensures the branch is exercised
    msgs = [HumanMessage(content=f"msg {i}") for i in range(35)]
    msgs += [AIMessage(content=f"ans {i}") for i in range(35)]
    llm = _FakeLLM(response_content="big summary")
    result = await cm._llm_summarize(msgs, llm)
    assert "big summary" in result
    assert llm.calls


@pytest.mark.asyncio
async def test_llm_summarize_per_msg_limit_tier_medium() -> None:
    # 16-30 messages -> per_msg_limit 200 (line 336)
    msgs = [HumanMessage(content=f"msg {i}") for i in range(20)]
    llm = _FakeLLM(response_content="mid summary")
    result = await cm._llm_summarize(msgs, llm)
    assert "mid summary" in result
    assert llm.calls


@pytest.mark.asyncio
async def test_llm_summarize_skips_empty_ai_content() -> None:
    # AIMessage with empty content is skipped in conversation_parts (line ~348 `if content`)
    msgs = [HumanMessage(content="hi"), AIMessage(content=""), AIMessage(content="real")]
    llm = _FakeLLM(response_content="ok")
    await cm._llm_summarize(msgs, llm)
    assert llm.calls


@pytest.mark.asyncio
async def test_llm_summarize_fallback_on_error() -> None:
    msgs = [HumanMessage(content="hi")]
    llm = _FakeLLM(exc=RuntimeError("boom"))
    result = await cm._llm_summarize(msgs, llm, raise_on_error=False)
    # fell back to extraction summary
    assert "1 条用户消息" in result


@pytest.mark.asyncio
async def test_llm_summarize_raise_on_error_propagates() -> None:
    msgs = [HumanMessage(content="hi")]
    llm = _FakeLLM(exc=RuntimeError("boom"))
    with pytest.raises(RuntimeError, match="boom"):
        await cm._llm_summarize(msgs, llm, raise_on_error=True)


# ── should_trim_context / trim_messages ────────────────────────


def test_should_trim_context_too_few_messages() -> None:
    msgs = [HumanMessage(content="h"), AIMessage(content="a")]
    # min_turns for text-only = 6 -> need >= 12 messages; only 2 -> False
    assert cm.should_trim_context(msgs, system_prompt_tokens=10, max_tokens=1000) is False


def test_should_trim_context_under_threshold() -> None:
    # many messages but tiny content -> ratio low
    msgs = [HumanMessage(content="h"), AIMessage(content="a")] * 20
    assert cm.should_trim_context(msgs, system_prompt_tokens=10, max_tokens=1_000_000) is False


def test_should_trim_context_over_threshold() -> None:
    # many messages with big content + small max_tokens -> over 0.6
    big = "x" * 4000
    msgs = []
    for i in range(12):
        msgs.append(HumanMessage(content=big))
        msgs.append(AIMessage(content=big))
    assert cm.should_trim_context(msgs, system_prompt_tokens=0, max_tokens=1000) is True


def test_should_trim_context_zero_max_tokens() -> None:
    msgs = [HumanMessage(content="h")] * 20
    assert cm.should_trim_context(msgs, system_prompt_tokens=10, max_tokens=0) is False


def test_trim_messages_no_trim_returns_copy() -> None:
    msgs = [HumanMessage(content="h"), AIMessage(content="a")]
    result = cm.trim_messages(msgs, system_prompt_tokens=10, max_tokens=1_000_000)
    assert result == msgs
    assert result is not msgs  # a copy, not the same list


def test_trim_messages_inserts_summary_and_drops_old() -> None:
    # A SystemMessage at index 0 sits before the trim boundary, so it lands in
    # old_messages and is replaced by a compaction summary.
    big = "x" * 4000
    msgs = [SystemMessage(content="sys")]
    for _ in range(12):
        msgs.append(HumanMessage(content=big))
        msgs.append(AIMessage(content=big))
    result = cm.trim_messages(msgs, system_prompt_tokens=0, max_tokens=1000)
    # a compaction summary SystemMessage is inserted
    compaction = [m for m in result if isinstance(m, SystemMessage) and m.content.startswith("[上下文压缩]")]
    assert compaction
    # original sys content is gone (it was trimmed into the summary)
    assert all(m.content != "sys" for m in result)
    # fewer messages than original
    assert len(result) < len(msgs)


def test_trim_messages_keeps_leading_system_when_in_kept_window() -> None:
    # The "keep SystemMessage at front of kept window" guard (lines 438-440) is
    # only reachable when the trim boundary lands exactly on a SystemMessage,
    # which cannot happen via _find_trim_boundary (it always returns a
    # HumanMessage index). Exercise the defensive guard by patching the
    # boundary so kept_messages[0] is a SystemMessage.
    big = "x" * 4000
    msgs = [
        HumanMessage(content=big),
        AIMessage(content=big),
        SystemMessage(content="mid-sys"),
        HumanMessage(content=big),
        AIMessage(content=big),
    ]
    with patch.object(cm, "should_trim_context", return_value=True), \
         patch.object(cm, "_calc_min_turns", return_value=1), \
         patch.object(cm, "_find_trim_boundary", return_value=2):
        result = cm.trim_messages(msgs, system_prompt_tokens=0, max_tokens=1000)
    # kept_messages[0] is the SystemMessage at index 2 -> preserved first
    assert isinstance(result[0], SystemMessage)
    assert result[0].content == "mid-sys"
    # followed by a compaction summary
    assert any(isinstance(m, SystemMessage) and m.content.startswith("[上下文压缩]") for m in result)


def test_trim_messages_boundary_zero_returns_copy() -> None:
    # Force should_trim True but boundary 0 (fewer HumanMessages than min_turns).
    # Build messages with huge content so ratio > 0.6, but only 1 human turn so
    # _find_trim_boundary returns 0.
    big = "x" * 4000
    msgs = [AIMessage(content=big), HumanMessage(content=big), AIMessage(content=big)]
    # min_turns for this set: 1 human, 0 tools -> text-only -> 6 -> len < 12 -> should_trim False normally.
    # So patch should_trim to True and boundary logic to 0 via patching helpers.
    with patch.object(cm, "should_trim_context", return_value=True), patch.object(cm, "_calc_min_turns", return_value=10), patch.object(cm, "_find_trim_boundary", return_value=0):
        result = cm.trim_messages(msgs, system_prompt_tokens=0, max_tokens=1000)
    assert result == msgs
    assert result is not msgs


# ── backward-compat stubs ──────────────────────────────────────


@pytest.mark.asyncio
async def test_maybe_trim_checkpoint_stub() -> None:
    result = await cm.maybe_trim_checkpoint(
        state=object(),
        config={"a": 1},
        llm=object(),
        checkpointer=object(),
        ws_callback=lambda _x: None,
        token_counter=lambda _m: 0,
        max_tokens=1000,
        cache_preserving=True,
    )
    assert result == {"compressed": False}


@pytest.mark.asyncio
async def test_fresh_compact_stub() -> None:
    result = await cm.fresh_compact(thread_id="t1", llm=object())
    assert result == {"refreshed": False, "reason": "oh-my-pi sidecar mode"}


# ── _build_summary_prompt ──────────────────────────────────────


def test_build_summary_prompt_contains_sections_and_roles() -> None:
    long = "y" * 600
    msgs = [HumanMessage(content="hi"), AIMessage(content=long)]
    prompt = cm._build_summary_prompt(msgs)
    for section in ("## Goal", "## Constraints", "## Progress", "## Key Decisions", "## Next Steps"):
        assert section in prompt
    assert "[human]" in prompt
    assert "[ai]" in prompt
    # AIMessage content truncated to 500 chars
    assert "y" * 600 not in prompt


# ── extract_file_operations ────────────────────────────────────


def _msg_with_tool_calls(tool_calls):
    """Build a lightweight message with a ``tool_calls`` attribute.

    ``extract_file_operations`` only reads ``getattr(m, 'tool_calls', None)``
    (no isinstance check), so a SimpleNamespace is sufficient and avoids
    langchain's strict tool_call parsing/validation.
    """
    return SimpleNamespace(tool_calls=tool_calls)


def test_extract_file_operations_extracts_and_dedups() -> None:
    m1 = _msg_with_tool_calls([
        {"name": "file_read", "args": {"path": "/a/b.py"}},
        {"name": "file_write", "args": {"file_path": "/a/c.py"}},
        {"name": "file_read", "args": {"path": "/a/b.py"}},  # dup
    ])
    m2 = _msg_with_tool_calls([
        {"name": "tool_file_edit", "args": {"path": "/d.py"}},
        {"name": "file_delete", "args": {"path": "/e.py"}},
    ])
    ops = cm.extract_file_operations([m1, m2])
    assert {"path": "/a/b.py", "op": "read"} in ops
    assert {"path": "/a/c.py", "op": "write"} in ops
    assert {"path": "/d.py", "op": "edit"} in ops
    assert {"path": "/e.py", "op": "delete"} in ops
    # dup removed
    assert sum(1 for o in ops if o == {"path": "/a/b.py", "op": "read"}) == 1


def test_extract_file_operations_skips_invalid() -> None:
    m = _msg_with_tool_calls([
        "not a dict",  # non-dict skipped
        {"name": "unknown_tool", "args": {"path": "/x"}},  # unknown name
        {"name": "file_read", "args": {}},  # missing path
        {"name": "file_read"},  # missing args
        42,  # non-dict
    ])
    assert cm.extract_file_operations([m]) == []


def test_extract_file_operations_no_tool_calls() -> None:
    # messages without tool_calls attr -> getattr returns None -> skipped
    assert cm.extract_file_operations([HumanMessage(content="hi"), AIMessage(content="a")]) == []
    # explicit None tool_calls
    assert cm.extract_file_operations([_msg_with_tool_calls(None)]) == []


# ── append_file_ops_to_summary ─────────────────────────────────


def test_append_file_ops_empty_returns_unchanged() -> None:
    assert cm.append_file_ops_to_summary("base", []) == "base"


def test_append_file_ops_with_labels() -> None:
    file_ops = [
        {"path": "/a", "op": "read"},
        {"path": "/b", "op": "write"},
        {"path": "/c", "op": "edit"},
        {"path": "/d", "op": "delete"},
        {"path": "/e", "op": "custom"},  # unknown op -> raw label
    ]
    result = cm.append_file_ops_to_summary("base summary", file_ops)
    assert result.startswith("base summary")
    assert "## 本次会话文件操作" in result
    assert "读取: /a" in result
    assert "写入: /b" in result
    assert "编辑: /c" in result
    assert "删除: /d" in result
    assert "custom: /e" in result


# ── format_structured_summary ──────────────────────────────────


def test_format_structured_summary_full() -> None:
    s = cm.StructuredSummary(
        goal="ship it",
        constraints=["c1", "c2"],
        progress=["p1"],
        key_decisions=["d1"],
        next_steps=["n1"],
    )
    out = cm.format_structured_summary(s)
    assert "## Goal\nship it" in out
    assert "- c1" in out and "- c2" in out
    assert "- p1" in out and "- d1" in out and "- n1" in out


def test_format_structured_summary_empty_fields() -> None:
    s = cm.StructuredSummary()
    out = cm.format_structured_summary(s)
    assert "## Goal\n(未明确)" in out
    for section in ("Constraints", "Progress", "Key Decisions", "Next Steps"):
        assert f"## {section}\n(无)" in out


# ── _parse_bullet_section ──────────────────────────────────────


def test_parse_bullet_section_bullets() -> None:
    text = "- a\n- b\nplain\n(无)\n"
    assert cm._parse_bullet_section(text) == ["a", "b", "plain"]


def test_parse_bullet_section_empty() -> None:
    assert cm._parse_bullet_section("") == []
    assert cm._parse_bullet_section("(无)") == []


# ── parse_structured_summary ───────────────────────────────────


def test_parse_structured_summary_well_formed() -> None:
    text = (
        "## Goal\nship feature\n\n"
        "## Constraints\n- c1\n- c2\n\n"
        "## Progress\n- p1\n\n"
        "## Key Decisions\n- d1\n\n"
        "## Next Steps\n- n1\n"
    )
    s = cm.parse_structured_summary(text)
    assert s.goal == "ship feature"
    assert s.constraints == ["c1", "c2"]
    assert s.progress == ["p1"]
    assert s.key_decisions == ["d1"]
    assert s.next_steps == ["n1"]


def test_parse_structured_summary_normalizes_placeholder_goal() -> None:
    text = (
        "## Goal\n(未明确)\n\n"
        "## Constraints\n(无)\n\n"
        "## Progress\n(无)\n\n"
        "## Key Decisions\n(无)\n\n"
        "## Next Steps\n(无)\n"
    )
    s = cm.parse_structured_summary(text)
    assert s.goal == ""
    assert s.constraints == []


def test_parse_structured_summary_no_match_fallback() -> None:
    text = "just some random notes without sections"
    s = cm.parse_structured_summary(text)
    assert s.goal == text[:200]
    assert s.constraints == []


def test_parse_structured_summary_empty_text() -> None:
    s = cm.parse_structured_summary("")
    assert s.goal == ""
