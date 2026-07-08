# tests/test_agent/test_capability_policy.py
import pytest
from agent.capability_policy import (
    Capability, PermissionMode, classify_permission, PermissionDecision
)

def test_capability_wildcard_match():
    """通配符能力匹配"""
    cap = Capability("file.*")
    assert cap.matches("file.read")
    assert cap.matches("file.write")
    assert not cap.matches("network.fetch")

def test_permission_mode_auto_allows_info_tools():
    """AUTO 模式放行信息类工具"""
    decision = classify_permission("file_read", "auto")
    assert decision == PermissionDecision.ALLOW

def test_permission_mode_ask_prompts_side_effect_tools():
    """ASK 模式需要确认副作用工具"""
    decision = classify_permission("file_write", "ask")
    assert decision == PermissionDecision.PROMPT

def test_permission_mode_readonly_denies_write():
    """READ_ONLY 模式拒绝写操作"""
    decision = classify_permission("file_write", "read_only")
    assert decision == PermissionDecision.DENY

def test_subagent_blocked_tools():
    """子 Agent 被阻止的工具"""
    decision = classify_permission("call_sub_agent", "auto", is_subagent=True)
    assert decision == PermissionDecision.DENY
