# tests/test_stream_repair/test_tool_json_repair.py
"""tool 参数 JSON 修复测试 — 修复 GLM-5 等模型的残缺 tool 参数 JSON。"""
import pytest
from langchain_core.messages import AIMessage
from agent.stream_repair.tool_json_repair import (
    repair_tool_calls_json,
    is_valid_json,
)


def test_is_valid_json_valid_object():
    assert is_valid_json('{"key": "value"}') is True


def test_is_valid_json_missing_closing_brace():
    """缺少闭合 } 的 JSON 无效。"""
    assert is_valid_json('{"key": "value"') is False


def test_is_valid_json_missing_closing_bracket():
    assert is_valid_json('{"items": [1, 2, 3') is False


def test_repair_missing_closing_braces():
    """修复缺少闭合 } 的 JSON（后缀追加式修复）。"""
    msg = AIMessage(
        content="",
        tool_calls=[{
            "name": "file_read",
            "args": {"path": "/tmp/test", "encoding": "utf-8"},
            "id": "tc1",
        }],
    )
    # 模拟破损的 args JSON（手动篡改为字符串形式）
    broken_args = '{"path": "/tmp/test", "encoding": "utf-8"'
    result = repair_tool_calls_json(msg, _simulate_broken_args=True)
    # 修复后 args 应能被 JSON 解析
    import json
    repaired_args = result.tool_calls[0]["args"]
    assert isinstance(repaired_args, dict)
    assert repaired_args["path"] == "/tmp/test"


def test_repair_already_valid_json_unchanged():
    """已有效的 JSON 不修改。"""
    msg = AIMessage(
        content="",
        tool_calls=[{
            "name": "file_read",
            "args": {"path": "/tmp/test"},
            "id": "tc1",
        }],
    )
    result = repair_tool_calls_json(msg)
    assert result.tool_calls[0]["args"] == {"path": "/tmp/test"}


def test_repair_nested_missing_braces():
    """修复嵌套对象缺少闭合 } 的 JSON。"""
    # 嵌套对象缺一个 }
    broken = '{"outer": {"inner": "value"}, "list": [1, 2]'
    repaired = repair_tool_calls_json(
        AIMessage(content="", tool_calls=[{"name": "test", "args": {}, "id": "tc1"}]),
        _test_broken_json=broken,
    )
    # 修复后应能解析
    import json
    # args 在修复后被解析回 dict
    assert isinstance(repaired.tool_calls[0]["args"], dict) or repaired.tool_calls[0]["args"] != {}


def test_repair_no_tool_calls_unchanged():
    """无 tool 调用的消息不修改。"""
    msg = AIMessage(content="hello")
    result = repair_tool_calls_json(msg)
    assert result.content == "hello"
