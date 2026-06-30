"""Tests for api/logging_config.py — 日志配置模块。"""

import json
import logging

import pytest

from api.logging_config import (
    JsonFormatter,
    ConsoleFormatter,
    ctx_request_id,
    ctx_session_id,
)


class TestJsonFormatter:
    """JSON 格式化器测试。"""

    def test_basic_format(self):
        """基本日志记录应该输出有效 JSON。"""
        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="hello world",
            args=(),
            exc_info=None,
        )
        output = formatter.format(record)
        data = json.loads(output)

        assert data["level"] == "INFO"
        assert data["logger"] == "test"
        assert data["msg"] == "hello world"
        assert data["module"] == "test"
        assert "ts" in data

    def test_extra_fields(self):
        """额外字段应该被包含在 JSON 中。"""
        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="request done",
            args=(),
            exc_info=None,
        )
        record.duration_ms = 42.5
        record.status_code = 200
        record.method = "GET"
        record.path = "/api/test"

        output = formatter.format(record)
        data = json.loads(output)

        assert data["duration_ms"] == 42.5
        assert data["status_code"] == 200
        assert data["method"] == "GET"
        assert data["path"] == "/api/test"

    def test_context_vars_injected(self):
        """ContextVar 应该被注入到 JSON 中。"""
        formatter = JsonFormatter()

        token_rid = ctx_request_id.set("abc123")
        token_sid = ctx_session_id.set("session-xyz")

        try:
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="test.py",
                lineno=1,
                msg="with context",
                args=(),
                exc_info=None,
            )
            output = formatter.format(record)
            data = json.loads(output)

            assert data["request_id"] == "abc123"
            assert data["session_id"] == "session-xyz"
        finally:
            ctx_request_id.reset(token_rid)
            ctx_session_id.reset(token_sid)

    def test_context_vars_empty_not_included(self):
        """空的 ContextVar 不应该出现在 JSON 中。"""
        formatter = JsonFormatter()

        # 确保 ContextVar 是默认值
        token_rid = ctx_request_id.set("")
        token_sid = ctx_session_id.set("")

        try:
            record = logging.LogRecord(
                name="test",
                level=logging.INFO,
                pathname="test.py",
                lineno=1,
                msg="no context",
                args=(),
                exc_info=None,
            )
            output = formatter.format(record)
            data = json.loads(output)

            assert "request_id" not in data
            assert "session_id" not in data
        finally:
            ctx_request_id.reset(token_rid)
            ctx_session_id.reset(token_sid)

    def test_exception_info(self):
        """异常信息应该被包含在 JSON 中。"""
        formatter = JsonFormatter()
        try:
            raise ValueError("test error")
        except ValueError:
            import sys
            exc_info = sys.exc_info()
            record = logging.LogRecord(
                name="test",
                level=logging.ERROR,
                pathname="test.py",
                lineno=1,
                msg="error occurred",
                args=(),
                exc_info=exc_info,
            )
            output = formatter.format(record)
            data = json.loads(output)

            assert "exception" in data
            assert "ValueError" in data["exception"]
            assert "test error" in data["exception"]


class TestConsoleFormatter:
    """控制台格式化器测试。"""

    def test_basic_format(self):
        """基本格式应该包含时间和消息。"""
        formatter = ConsoleFormatter()
        record = logging.LogRecord(
            name="test_module",
            level=logging.INFO,
            pathname="test.py",
            lineno=1,
            msg="hello",
            args=(),
            exc_info=None,
        )
        output = formatter.format(record)
        assert "hello" in output
        assert "INFO" in output
        assert "test_module" in output
