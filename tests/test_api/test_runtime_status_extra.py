"""补充测试 — api/runtime_status.py reason_code 分支与 sanitize 边界。

已有 test_runtime_status.py 覆盖 authentication_failed / invalid_configuration
与一条 sanitize 用例；本文件覆盖剩余 reason_code 分支与边界。
"""

import time

import pytest

from api.runtime_status import (
    RuntimeStatus,
    reason_code_for,
    sanitize_user_detail,
    user_summary_for,
)


class TestSanitizeUserDetail:
    def test_none_returns_none(self):
        assert sanitize_user_detail(None) is None

    def test_empty_returns_empty(self):
        assert sanitize_user_detail("") == ""

    def test_redacts_bearer_header(self):
        out = sanitize_user_detail("Authorization: Bearer abc123")
        assert "abc123" not in out
        assert "redacted" in out

    def test_redacts_query_param_token(self):
        out = sanitize_user_detail("https://x.test/cb?token=query-secret&ok=1")
        assert "query-secret" not in out

    def test_redacts_password_assignment(self):
        out = sanitize_user_detail("password=hunter2")
        assert "hunter2" not in out

    def test_keeps_non_sensitive_text(self):
        out = sanitize_user_detail("just a normal message")
        assert out == "just a normal message"


class TestReasonCodeFor:
    def test_ok_returns_none(self):
        assert reason_code_for("ok") is None

    def test_rate_limited_429(self):
        assert reason_code_for("error", "HTTP 429 Too Many Requests") == "rate_limited"

    def test_rate_limited_rate_limit_text(self):
        assert reason_code_for("degraded", "rate limit exceeded") == "rate_limited"

    def test_request_timed_out(self):
        assert reason_code_for("error", "operation timed out") == "request_timed_out"

    def test_network_unavailable(self):
        assert reason_code_for("error", "connection refused") == "network_unavailable"

    def test_network_unavailable_dns(self):
        assert reason_code_for("error", "dns lookup failed") == "network_unavailable"

    def test_degraded_default_runtime_degraded(self):
        # 无匹配关键词，status=degraded → runtime_degraded
        assert reason_code_for("degraded", "something odd") == "runtime_degraded"

    def test_error_default_runtime_error(self):
        # 无匹配关键词，status=error → runtime_error
        assert reason_code_for("error", "unknown boom") == "runtime_error"

    def test_authentication_403(self):
        assert reason_code_for("error", "403 Forbidden") == "authentication_failed"

    def test_authentication_unauthorized(self):
        assert reason_code_for("error", "unauthorized access") == "authentication_failed"


class TestUserSummaryFor:
    def test_known_reason_codes_return_summary(self):
        assert user_summary_for("authentication_failed") == "Configuration could not be authenticated."
        assert user_summary_for("rate_limited") == "The upstream service is rate limited."
        assert user_summary_for("invalid_configuration") == "The provider configuration needs attention."
        assert user_summary_for("request_timed_out") == "The upstream request timed out."
        assert user_summary_for("network_unavailable") == "The upstream service is unreachable."
        assert user_summary_for("runtime_degraded") == "The component is temporarily degraded."
        assert user_summary_for("runtime_error") == "The component is unavailable."

    def test_unknown_returns_none(self):
        assert user_summary_for("not_a_real_code") is None
        assert user_summary_for(None) is None


class TestRuntimeStatusPublicDetail:
    def test_public_detail_redacts_credentials(self):
        status = RuntimeStatus.health(
            "error", "Authorization: Bearer my-secret"
        )
        assert "my-secret" not in (status.public_detail() or "")

    def test_public_detail_none_when_no_technical_detail(self):
        status = RuntimeStatus.health("ok")
        assert status.public_detail() is None

    def test_health_defaults_updated_at_when_none(self):
        before = time.time()
        status = RuntimeStatus.health("ok", updated_at=None)
        after = time.time()
        assert before <= status.updated_at <= after

    def test_health_explicit_updated_at_preserved(self):
        status = RuntimeStatus.health("ok", updated_at=42.0)
        assert status.updated_at == 42.0

    def test_health_explicit_retry_at_preserved(self):
        status = RuntimeStatus.health("error", "401", retry_at=99.0)
        assert status.retry_at == 99.0
        assert status.reason_code == "authentication_failed"
