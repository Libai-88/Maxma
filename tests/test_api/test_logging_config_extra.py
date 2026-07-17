"""Tests for api/logging_config.py — 补充覆盖 setup_logging 与 ConsoleFormatter 上下文注入。

现有 test_logging_config.py 覆盖 JsonFormatter 与 ConsoleFormatter 基本格式，
本文件补充：
- ConsoleFormatter 的 ContextVar 注入（sid/rid/both，行 83/85/87）
- setup_logging() 全函数（行 97-141）：默认配置、自定义级别、非法级别降级、
  JSON 控制台、禁用文件、自定义文件路径、清除既有 handler、第三方库级别设置。
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys

import pytest

from api.logging_config import (
    ConsoleFormatter,
    JsonFormatter,
    ctx_request_id,
    ctx_session_id,
    setup_logging,
)

# setup_logging 影响的第三方 logger 名称
_THIRD_PARTY_LOGGERS = ("httpx", "httpcore", "uvicorn.access", "openai", "playwright")
# setup_logging 读取的环境变量
_ENV_VARS = ("MAXMA_LOG_LEVEL", "MAXMA_LOG_JSON", "MAXMA_LOG_FILE")


@pytest.fixture(autouse=True)
def _restore_root_logger(monkeypatch, tmp_path):
    """快照并恢复 root logger 与相关全局状态，避免污染其它测试。

    - root logger 的 handlers 与 level
    - 第三方库 logger 的 level
    - MAXMA_LOG_* 环境变量
    - api.logging_config._LOG_DIR（默认文件路径指向处）
    """
    root = logging.getLogger()
    saved_handlers = root.handlers[:]
    saved_level = root.level
    saved_levels = {name: logging.getLogger(name).level for name in _THIRD_PARTY_LOGGERS}
    saved_env = {name: os.environ.get(name) for name in _ENV_VARS}

    # 默认把 _LOG_DIR 重定向到 tmp，避免写入项目 logs 目录
    import api.logging_config as cfg

    monkeypatch.setattr(cfg, "_LOG_DIR", tmp_path / "logs")

    yield

    root.handlers = saved_handlers
    root.setLevel(saved_level)
    for name, lvl in saved_levels.items():
        logging.getLogger(name).setLevel(lvl)
    for name, val in saved_env.items():
        if val is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = val


def _make_record(msg: str = "hello", level: int = logging.INFO) -> logging.LogRecord:
    return logging.LogRecord(
        name="test_mod",
        level=level,
        pathname="test.py",
        lineno=10,
        msg=msg,
        args=(),
        exc_info=None,
    )


class TestConsoleFormatterContextInjection:
    """ConsoleFormatter 注入 ContextVar 上下文（行 83/85/87）。"""

    def test_session_id_injected(self):
        """设置 sid 时应在消息前缀 [sid=...]。"""
        formatter = ConsoleFormatter()
        token = ctx_session_id.set("abcdefgh-session")
        try:
            out = formatter.format(_make_record("hi"))
        finally:
            ctx_session_id.reset(token)
        assert out.startswith("[sid=abcdefgh]")
        assert "hi" in out

    def test_request_id_injected(self):
        """设置 rid 时应在消息前缀 [rid=...]。"""
        formatter = ConsoleFormatter()
        token = ctx_request_id.set("12345678-req")
        try:
            out = formatter.format(_make_record("hi"))
        finally:
            ctx_request_id.reset(token)
        assert out.startswith("[rid=12345678]")
        assert "hi" in out

    def test_both_contexts_injected(self):
        """同时设置 sid 与 rid 时前缀应包含两者（sid 在前）。"""
        formatter = ConsoleFormatter()
        # 使用恰好 8 字符的值，便于断言精确截断
        ts = ctx_session_id.set("abcdefgh")
        tr = ctx_request_id.set("12345678")
        try:
            out = formatter.format(_make_record("hi"))
        finally:
            ctx_session_id.reset(ts)
            ctx_request_id.reset(tr)
        assert out.startswith("[sid=abcdefgh rid=12345678]")
        assert "hi" in out

    def test_sid_truncated_to_8_chars(self):
        """sid/rid 应截断为前 8 字符。"""
        formatter = ConsoleFormatter()
        token = ctx_session_id.set("very-long-session-id-12345")
        try:
            out = formatter.format(_make_record("hi"))
        finally:
            ctx_session_id.reset(token)
        # 只取前 8 字符
        assert "sid=very-lon" in out

    def test_empty_contexts_no_prefix(self):
        """无上下文时不应有前缀方括号。"""
        formatter = ConsoleFormatter()
        out = formatter.format(_make_record("hi"))
        assert not out.startswith("[")
        assert "hi" in out


class TestSetupLogging:
    """setup_logging() 配置入口（行 97-141）。"""

    def test_default_sets_info_level(self):
        """默认（无环境变量）应设置 root 级别为 INFO。"""
        for v in _ENV_VARS:
            os.environ.pop(v, None)
        setup_logging()
        assert logging.getLogger().level == logging.INFO

    def test_custom_level(self):
        """MAXMA_LOG_LEVEL=DEBUG 应设置 root 级别为 DEBUG。"""
        os.environ["MAXMA_LOG_LEVEL"] = "DEBUG"
        setup_logging()
        assert logging.getLogger().level == logging.DEBUG

    def test_warning_level(self):
        """MAXMA_LOG_LEVEL=WARNING 应设置 root 级别为 WARNING。"""
        os.environ["MAXMA_LOG_LEVEL"] = "WARNING"
        setup_logging()
        assert logging.getLogger().level == logging.WARNING

    def test_invalid_level_falls_back_to_info(self):
        """非法级别应回退到 INFO（getattr 默认值）。"""
        os.environ["MAXMA_LOG_LEVEL"] = "BOGUS_LEVEL"
        setup_logging()
        assert logging.getLogger().level == logging.INFO

    def test_level_case_insensitive(self):
        """级别名应大写化后匹配。"""
        os.environ["MAXMA_LOG_LEVEL"] = "error"
        setup_logging()
        assert logging.getLogger().level == logging.ERROR

    def test_clears_existing_handlers(self):
        """应清除既有 handler 后重建。"""
        root = logging.getLogger()
        initial_count = len(root.handlers)
        root.addHandler(logging.NullHandler())
        root.addHandler(logging.NullHandler())
        assert len(root.handlers) == initial_count + 2
        assert any(isinstance(h, logging.NullHandler) for h in root.handlers)

        setup_logging()
        # NullHandler 应被清除
        assert not any(isinstance(h, logging.NullHandler) for h in root.handlers)

    def test_default_has_console_and_file_handlers(self):
        """默认应同时配置控制台和文件 handler。"""
        for v in _ENV_VARS:
            os.environ.pop(v, None)
        setup_logging()
        handlers = logging.getLogger().handlers
        assert any(isinstance(h, logging.StreamHandler) for h in handlers)
        assert any(isinstance(h, logging.handlers.RotatingFileHandler) for h in handlers)

    def test_json_console_uses_json_formatter(self):
        """MAXMA_LOG_JSON=1 时控制台应使用 JsonFormatter。"""
        os.environ["MAXMA_LOG_JSON"] = "1"
        setup_logging()
        stream_handlers = [
            h for h in logging.getLogger().handlers
            if isinstance(h, logging.StreamHandler)
            and not isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        assert stream_handlers, "应有控制台 StreamHandler"
        assert isinstance(stream_handlers[0].formatter, JsonFormatter)

    def test_default_console_uses_console_formatter(self):
        """默认（非 JSON）控制台应使用 ConsoleFormatter。"""
        os.environ.pop("MAXMA_LOG_JSON", None)
        setup_logging()
        stream_handlers = [
            h for h in logging.getLogger().handlers
            if isinstance(h, logging.StreamHandler)
            and not isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        assert isinstance(stream_handlers[0].formatter, ConsoleFormatter)

    def test_disables_file_when_log_file_empty(self):
        """MAXMA_LOG_FILE='' 时不应创建文件 handler。"""
        os.environ["MAXMA_LOG_FILE"] = ""
        setup_logging()
        handlers = logging.getLogger().handlers
        assert not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in handlers)
        # 仍应有控制台 handler
        assert any(isinstance(h, logging.StreamHandler) for h in handlers)

    def test_custom_log_file_path(self, tmp_path):
        """MAXMA_LOG_FILE 指定自定义路径时应使用该路径。"""
        custom = tmp_path / "custom.log"
        os.environ["MAXMA_LOG_FILE"] = str(custom)
        setup_logging()
        file_handlers = [
            h for h in logging.getLogger().handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        assert len(file_handlers) == 1
        # RotatingFileHandler.baseFilename 是绝对路径
        assert os.path.abspath(file_handlers[0].baseFilename) == os.path.abspath(str(custom))

    def test_third_party_loggers_set_to_warning(self):
        """第三方库 logger 应被设为 WARNING。"""
        for v in _ENV_VARS:
            os.environ.pop(v, None)
        setup_logging()
        for name in _THIRD_PARTY_LOGGERS:
            assert logging.getLogger(name).level == logging.WARNING, name

    def test_file_handler_uses_json_formatter(self):
        """文件 handler 应使用 JsonFormatter。"""
        os.environ.pop("MAXMA_LOG_FILE", None)
        setup_logging()
        file_handlers = [
            h for h in logging.getLogger().handlers
            if isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        assert file_handlers
        assert isinstance(file_handlers[0].formatter, JsonFormatter)

    def test_console_handler_writes_to_stderr(self):
        """控制台 handler 应输出到 stderr。"""
        setup_logging()
        stream_handlers = [
            h for h in logging.getLogger().handlers
            if isinstance(h, logging.StreamHandler)
            and not isinstance(h, logging.handlers.RotatingFileHandler)
        ]
        assert stream_handlers[0].stream is sys.stderr

    def test_setup_logging_emits_init_message(self, tmp_path):
        """setup_logging 末尾应通过 root logger 输出初始化日志到文件。"""
        log_file = tmp_path / "init.log"
        os.environ["MAXMA_LOG_FILE"] = str(log_file)
        for v in ("MAXMA_LOG_LEVEL", "MAXMA_LOG_JSON"):
            os.environ.pop(v, None)
        setup_logging()
        # flush 确保 RotatingFileHandler 写入落盘
        for h in logging.getLogger().handlers:
            h.flush()
        content = log_file.read_text(encoding="utf-8")
        assert "Logging initialized" in content
        # 文件启用时不应显示 (disabled)
        assert "(disabled)" not in content

    def test_init_message_reflects_disabled_file(self, capsys):
        """禁用文件时初始化消息应输出到 stderr 且显示 (disabled)。"""
        os.environ["MAXMA_LOG_FILE"] = ""
        setup_logging()
        for h in logging.getLogger().handlers:
            h.flush()
        captured = capsys.readouterr()
        assert "Logging initialized" in captured.err
        assert "(disabled)" in captured.err
