"""Focused contracts for the default-off cache-preserving compaction helper."""
import pytest

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from agent.context_manager import (
    COMPACTION_METADATA_KEY,
    build_cache_preserving_compaction,
    maybe_trim_checkpoint,
)


def _token_counter(messages):
    return sum(len(str(message.content)) for message in messages)


def test_cache_prefix_is_byte_stable_and_metadata_has_boundary():
    prefix = [SystemMessage(content="system\npersona\ntools")]
    source = [HumanMessage(content="old request"), AIMessage(content="old answer")]
    retained = [HumanMessage(content="new request"), AIMessage(content="new answer")]

    result = build_cache_preserving_compaction(
        fixed_prefix=prefix,
        source_messages=source,
        retained_messages=retained,
        summary_text="old work completed",
        token_counter=_token_counter,
    )

    assert result.messages[0].content.encode("utf-8") == prefix[0].content.encode("utf-8")
    assert result.metadata["source_turn_boundary"] == 1
    assert result.metadata["source_message_count"] == 2
    assert result.metadata["result_token_count"] < result.metadata["source_token_count"] + 100
    persisted = result.summary_message.additional_kwargs[COMPACTION_METADATA_KEY]
    assert persisted == result.metadata


def test_compaction_metadata_is_deterministic_and_omits_tool_output():
    prefix = [SystemMessage(content="system")]
    source = [
        HumanMessage(content="inspect credentials"),
        AIMessage(content="I will inspect them"),
        ToolMessage(content="Authorization: secret-token", tool_call_id="call-1"),
    ]
    retained = [HumanMessage(content="continue")]
    kwargs = dict(
        fixed_prefix=prefix,
        source_messages=source,
        retained_messages=retained,
        summary_text="credentials inspection was requested",
        token_counter=_token_counter,
    )

    first = build_cache_preserving_compaction(**kwargs)
    second = build_cache_preserving_compaction(**kwargs)

    assert first.metadata == second.metadata
    assert "secret-token" not in str(first.metadata)
    assert "secret-token" not in first.summary_message.content


@pytest.mark.asyncio
async def test_compaction_keeps_legacy_summary_format_when_rollout_is_disabled():
    messages = [
        SystemMessage(content="system"),
        HumanMessage(content="old request"),
        AIMessage(content="old answer"),
        HumanMessage(content="new request"),
        AIMessage(content="new answer"),
    ]

    result = await maybe_trim_checkpoint(
        {"messages": messages},
        {"configurable": {"thread_id": "test"}},
        token_counter=lambda _messages: 10_000,
        max_tokens=100,
        cache_preserving=False,
    )

    summary = next(message for message in result["messages"] if isinstance(message, SystemMessage) and message.content.startswith("[上下文压缩]"))
    assert COMPACTION_METADATA_KEY not in summary.additional_kwargs
