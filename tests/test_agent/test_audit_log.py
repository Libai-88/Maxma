# GUARD: agent.audit_log
try:
    import agent.audit_log
except ImportError:
    import pytest
    pytest.skip("agent.audit_log module removed — OMP replaces it", allow_module_level=True)

"""阶段 4.2 专项测试 — MCP 调用审计日志。

覆盖 log_mcp_call + get_mcp_summary：
- 写入/读取/过滤
- 聚合统计（per server_id+tool_name）
- 状态分类（ok / error / rate_limited）
- 耗时统计
- 截断保护（长入参/结果）
"""

import json
import os
from pathlib import Path

import pytest

from agent import audit_log


@pytest.fixture(autouse=True)
def _isolated_audit_log(tmp_path, monkeypatch):
    """每个测试使用独立的临时审计日志文件，避免污染真实日志。"""
    fake_path = tmp_path / "audit.jsonl"
    monkeypatch.setattr(audit_log, "AUDIT_LOG_PATH", fake_path)
    # 同时确保目录存在
    monkeypatch.setattr(audit_log, "LOGS_DIR", tmp_path)
    yield
    # 清理（tmp_path 自动清理，但显式清空避免跨测试影响）
    if fake_path.exists():
        fake_path.unlink()


class TestLogMcpCall:
    """log_mcp_call 写入测试。"""

    def test_write_basic_ok_call(self):
        audit_log.log_mcp_call(
            server_id="github",
            tool_name="github_search",
            args_summary='{"query": "test"}',
            result_summary='{"count": 10}',
            duration_ms=150,
            status="ok",
        )

        records = audit_log.read_log(limit=10)
        assert len(records) == 1
        r = records[0]
        assert r["type"] == audit_log.EVENT_MCP_CALL
        assert r["status"] == "ok"
        assert r["target"] == "github/github_search"
        assert r["extra"]["server_id"] == "github"
        assert r["extra"]["tool_name"] == "github_search"
        assert r["extra"]["duration_ms"] == 150

    def test_write_error_call(self):
        audit_log.log_mcp_call(
            server_id="github",
            tool_name="github_create",
            status="error",
            error="connection refused",
            duration_ms=50,
        )

        records = audit_log.read_log(limit=10, event_type=audit_log.EVENT_MCP_CALL)
        assert len(records) == 1
        assert records[0]["status"] == "error"
        assert records[0]["extra"]["error"] == "connection refused"

    def test_write_rate_limited_call(self):
        audit_log.log_mcp_call(
            server_id="github",
            tool_name="github_search",
            status="rate_limited",
            error="rate limit: retry_after=5s",
        )

        records = audit_log.read_log(limit=10, event_type=audit_log.EVENT_MCP_CALL)
        assert len(records) == 1
        assert records[0]["status"] == "rate_limited"

    def test_long_args_are_truncated(self):
        long_args = "x" * 2000
        audit_log.log_mcp_call(
            server_id="srv",
            tool_name="srv_tool",
            args_summary=long_args,
            result_summary=long_args,
            status="ok",
        )

        records = audit_log.read_log(limit=10)
        r = records[0]
        # extra 内的 args_summary 被截断到 500 字符
        assert len(r["extra"]["args_summary"]) == 500
        assert len(r["extra"]["result_summary"]) == 500

    def test_empty_args_and_result_omitted(self):
        audit_log.log_mcp_call(
            server_id="srv",
            tool_name="srv_tool",
            status="ok",
        )

        records = audit_log.read_log(limit=10)
        r = records[0]
        assert "args_summary" not in r["extra"]
        assert "result_summary" not in r["extra"]
        assert "error" not in r["extra"]

    def test_multiple_writes_accumulate(self):
        for i in range(5):
            audit_log.log_mcp_call(
                server_id="srv",
                tool_name=f"srv_tool_{i}",
                status="ok",
                duration_ms=i * 10,
            )

        records = audit_log.read_log(limit=10, event_type=audit_log.EVENT_MCP_CALL)
        assert len(records) == 5
        # read_log 返回最新在前
        tool_names = [r["extra"]["tool_name"] for r in records]
        assert "srv_tool_4" in tool_names
        assert "srv_tool_0" in tool_names


class TestGetMcpSummary:
    """get_mcp_summary 聚合统计测试。"""

    def test_empty_log_returns_empty_list(self):
        assert audit_log.get_mcp_summary() == []

    def test_summary_aggregates_per_server_tool(self):
        # github/search: 3 ok + 1 error
        for _ in range(3):
            audit_log.log_mcp_call("github", "github_search", status="ok", duration_ms=100)
        audit_log.log_mcp_call("github", "github_search", status="error", duration_ms=200, error="x")

        # github/create: 1 ok
        audit_log.log_mcp_call("github", "github_create", status="ok", duration_ms=50)

        # fs/read: 2 ok + 1 rate_limited
        for _ in range(2):
            audit_log.log_mcp_call("fs", "fs_read", status="ok", duration_ms=10)
        audit_log.log_mcp_call("fs", "fs_read", status="rate_limited")

        summary = audit_log.get_mcp_summary()

        # 3 个 (server_id, tool_name) 组合
        assert len(summary) == 3

        # 按 total 降序
        assert summary[0]["total"] == 4  # github_search: 3 ok + 1 error
        assert summary[0]["server_id"] == "github"
        assert summary[0]["tool_name"] == "github_search"
        assert summary[0]["ok"] == 3
        assert summary[0]["error"] == 1
        assert summary[0]["rate_limited"] == 0
        assert summary[0]["avg_duration_ms"] == 125.0  # (100*3 + 200) / 4
        assert summary[0]["success_rate"] == 0.75  # 3/4

        # 第二个：fs_read (3 total)
        assert summary[1]["total"] == 3
        assert summary[1]["ok"] == 2
        assert summary[1]["rate_limited"] == 1
        assert summary[1]["success_rate"] == round(2 / 3, 4)

        # 第三个：github_create (1 total)
        assert summary[2]["total"] == 1

    def test_summary_only_includes_mcp_call_events(self):
        # 写入其他类型的事件，不应出现在 mcp_summary
        audit_log.log_event(event_type="api_call", target="other", status="ok")
        audit_log.log_mcp_call("srv", "srv_tool", status="ok")

        summary = audit_log.get_mcp_summary()
        assert len(summary) == 1
        assert summary[0]["server_id"] == "srv"

    def test_summary_last_call_at_is_latest_timestamp(self):
        audit_log.log_mcp_call("srv", "srv_tool", status="ok")
        audit_log.log_mcp_call("srv", "srv_tool", status="ok")
        audit_log.log_mcp_call("srv", "srv_tool", status="error")

        summary = audit_log.get_mcp_summary()
        assert len(summary) == 1
        # last_call_at 应为最后一条记录的时间戳
        records = audit_log.read_log(limit=10, event_type=audit_log.EVENT_MCP_CALL)
        # read_log 返回最新在前，最后写入的是 records[0]
        assert summary[0]["last_call_at"] == records[0]["timestamp"]


class TestAuditLogPiiScrubbing:
    """审计日志 PII 脱敏测试（Task D5）。"""

    def test_audit_log_scrubs_pii(self):
        """审计日志应脱敏 PII（邮箱、手机号）"""
        audit_log.log_event(
            event_type="tool_call",
            target="file_write",
            detail="联系 test@example.com",
            extra={
                "path": "test.txt",
                "content": "联系 test@example.com",
                "user_input": "我的手机号是 13812345678",
            },
        )

        events = audit_log.read_log(limit=10)
        dumped = "\n".join(str(e) for e in events)
        assert "test@example.com" not in dumped
        assert "13812345678" not in dumped
        assert "[EMAIL]" in dumped or "[PHONE]" in dumped
