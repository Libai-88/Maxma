# tests/test_agent/test_session_health.py
import pytest
from agent.session_health import evaluate_session_health, HealthStatus

def test_healthy_session():
    """正常会话返回 healthy"""
    messages = [
        {"role": "assistant", "stop_reason": "end_turn"},
        {"role": "assistant", "stop_reason": "end_turn"},
        {"role": "assistant", "stop_reason": "end_turn"},
    ]
    result = evaluate_session_health(messages)
    assert result.status == HealthStatus.HEALTHY

def test_unhealthy_session_too_many_errors():
    """连续 3 次 error 视为 unhealthy"""
    messages = [
        {"role": "assistant", "stop_reason": "error"},
        {"role": "assistant", "stop_reason": "error"},
        {"role": "assistant", "stop_reason": "error"},
    ]
    result = evaluate_session_health(messages)
    assert result.status == HealthStatus.UNHEALTHY
    assert result.error_count == 3

def test_empty_messages():
    """空消息列表返回 unknown"""
    result = evaluate_session_health([])
    assert result.status == HealthStatus.UNKNOWN
