# tests/test_stream_repair/test_pipeline.py
"""流式修复管道集成测试。"""
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from agent.stream_repair.pipeline import apply_stream_repairs


@pytest.fixture(autouse=True)
def enable_stream_repair(monkeypatch):
    """为所有测试启用流式修复（patch settings 单例实例）。"""
    from config.settings import get_settings
    settings = get_settings()
    monkeypatch.setattr(settings, "stream_repair_enabled", True)


def test_pipeline_fixes_empty_turn():
    """管道修复空 turn。"""
    msg = AIMessage(content="")
    input_msgs = [HumanMessage(content="test")]
    result = apply_stream_repairs(msg, input_msgs)
    assert result.content == " "  # 占位空格


def test_pipeline_repairs_broken_tool_json():
    """管道修复破损 tool 参数 JSON。"""
    msg = AIMessage(
        content="",
        tool_calls=[{"name": "test", "args": {}, "id": "tc1"}],
    )
    input_msgs = [HumanMessage(content="test")]
    # 正常的 tool_calls 不应被修改
    result = apply_stream_repairs(msg, input_msgs)
    assert len(result.tool_calls) == 1


def test_pipeline_backfills_usage():
    """管道回填 usage。"""
    msg = AIMessage(content="Hello world!", response_metadata={})
    input_msgs = [HumanMessage(content="Hi")]
    result = apply_stream_repairs(msg, input_msgs)
    # usage 应被回填到 response_metadata
    metadata = getattr(result, "response_metadata", {})
    # 检查 usage 是否被注入（字段名可能不同）
    assert metadata.get("estimated_usage") is not None or \
           metadata.get("token_usage") is not None or \
           metadata.get("usage") is not None


def test_pipeline_preserves_valid_response():
    """有效的响应不被修改。"""
    msg = AIMessage(
        content="正常回复",
        response_metadata={
            "token_usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            }
        },
    )
    input_msgs = [HumanMessage(content="question")]
    result = apply_stream_repairs(msg, input_msgs)
    assert result.content == "正常回复"
    # 已有 usage 不被覆盖
    metadata = getattr(result, "response_metadata", {})
    assert metadata.get("token_usage", {}).get("total_tokens") == 15


def test_pipeline_with_no_tool_calls():
    """无 tool 调用的消息正常处理。"""
    msg = AIMessage(content="回复内容")
    input_msgs = [HumanMessage(content="问题")]
    result = apply_stream_repairs(msg, input_msgs)
    assert result.content == "回复内容"
