"""Contract tests for API-facing runtime status and diagnostic redaction."""

from api.health import ComponentHealth
from api.runtime_status import JOB_STATES, RuntimeStatus, sanitize_user_detail


def test_runtime_status_uses_stable_reason_codes_and_safe_summary():
    status = RuntimeStatus.health(
        "error",
        "401 Unauthorized: Authorization: Bearer super-secret-value",
        updated_at=123.0,
    )

    assert status.reason_code == "authentication_failed"
    assert status.summary == "Configuration could not be authenticated."
    assert status.updated_at == 123.0
    assert "super-secret-value" not in (status.public_detail() or "")


def test_component_health_sanitizes_credential_values_before_serialization():
    component = ComponentHealth.from_runtime(
        "error",
        technical_detail=(
            "401 api_key=super-secret Authorization: Bearer another-secret "
            "https://example.test/check?token=query-secret"
        ),
    )
    payload = component.model_dump_json()

    assert component.reason_code == "authentication_failed"
    assert component.summary == "Configuration could not be authenticated."
    assert "super-secret" not in payload
    assert "another-secret" not in payload
    assert "query-secret" not in payload


def test_runtime_status_keeps_job_states_separate_from_component_health():
    assert set(JOB_STATES) == {"queued", "running", "succeeded", "failed", "cancelled"}
    assert sanitize_user_detail("token=do-not-return") == "[redacted credential]"


def test_runtime_status_reports_invalid_provider_configuration_without_raw_detail():
    status = RuntimeStatus.health("error", "404 Invalid configuration for base URL")

    assert status.reason_code == "invalid_configuration"
    assert status.summary == "The provider configuration needs attention."
