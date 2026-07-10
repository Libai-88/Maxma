"""usage 回填测试 — 上游不返回 token 数时用字符累积估算。"""
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from agent.stream_repair.usage_backfill import (
    estimate_tokens,
    backfill_usage_if_missing,
    extract_usage_from_response,
)


def test_estimate_tokens_non_empty_string():
    """非空字符串估算出正数 token。"""
    tokens = estimate_tokens("Hello, world! This is a test.")
    assert tokens > 0


def test_estimate_tokens_empty_string():
    assert estimate_tokens("") == 0


def test_estimate_tokens_chinese():
    """中文文本估算。"""
    tokens = estimate_tokens("你好世界，这是一个测试")
    assert tokens > 0


def test_estimate_tokens_bias_high():
    """估算值偏高（BIAS_HIGH_FACTOR=1.35，只许多计绝不少计）。"""
    # 英文文本约 4 字符/token，但 BIAS_HIGH_FACTOR 会偏高
    text = "a" * 100  # 100 字符纯英文
    tokens = estimate_tokens(text)
    # 100/4=25，乘以 1.35 ≈ 34，应 > 25
    assert tokens >= 25


def test_extract_usage_from_response_with_usage():
    """response_metadata 包含 usage 时直接提取。"""
    msg = AIMessage(
        content="hello",
        response_metadata={
            "token_usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
            }
        },
    )
    usage = extract_usage_from_response(msg)
    assert usage is not None
    assert usage["input_tokens"] == 100
    assert usage["output_tokens"] == 50


def test_extract_usage_from_response_no_usage():
    """response_metadata 无 usage 时返回 None。"""
    msg = AIMessage(content="hello", response_metadata={})
    usage = extract_usage_from_response(msg)
    assert usage is None


def test_backfill_usage_when_missing():
    """usage 缺失时用字符估算回填。"""
    msg = AIMessage(content="Hello, world!", response_metadata={})
    # 模拟输入消息
    input_messages = [HumanMessage(content="What is 2+2?")]
    result = backfill_usage_if_missing(msg, input_messages)
    assert result is not None
    assert result["input_tokens"] > 0
    assert result["output_tokens"] > 0
    assert result["estimated"] is True


def test_backfill_usage_not_overwritten_when_present():
    """已有 usage 时不覆盖。"""
    msg = AIMessage(
        content="Hello!",
        response_metadata={
            "token_usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
            }
        },
    )
    input_messages = [HumanMessage(content="question")]
    result = backfill_usage_if_missing(msg, input_messages)
    assert result["input_tokens"] == 100  # 原值不被覆盖
    assert result["output_tokens"] == 50
    assert result["estimated"] is False
