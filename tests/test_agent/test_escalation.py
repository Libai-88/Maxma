# tests/test_agent/test_escalation.py
"""Escalation run 边界测试。"""
import pytest
from agent.autonomy.escalation import (
    EscalationRecord,
    EscalationStore,
    ESCALATION_TIMEOUT_HOURS,
)


def test_escalation_record_creation():
    """创建 escalation 记录。"""
    record = EscalationRecord(
        escalation_id="esc-1",
        run_id="run-1",
        question="需要确认：是否执行此操作？",
        choices=["确认", "取消"],
    )
    assert record.escalation_id == "esc-1"
    assert record.status == "waiting"
    assert record.question == "需要确认：是否执行此操作？"


def test_escalation_store_create():
    """存储创建 escalation。"""
    store = EscalationStore()
    record = store.create(
        run_id="run-1",
        question="确认？",
        choices=["是", "否"],
    )
    assert record.escalation_id is not None
    assert record.status == "waiting"
    assert store.get(record.escalation_id) is not None


def test_escalation_store_resolve():
    """存储解决 escalation。"""
    store = EscalationStore()
    record = store.create(
        run_id="run-1",
        question="确认？",
        choices=["是", "否"],
    )
    store.resolve(record.escalation_id, user_response="是")
    resolved = store.get(record.escalation_id)
    assert resolved.status == "resolved"
    assert resolved.user_response == "是"


def test_escalation_store_list_waiting():
    """列出所有等待中的 escalation。"""
    store = EscalationStore()
    store.create(run_id="r1", question="q1", choices=["a", "b"])
    store.create(run_id="r2", question="q2", choices=["c", "d"])
    waiting = store.list_waiting()
    assert len(waiting) == 2


def test_escalation_store_list_excludes_resolved():
    """已解决的 escalation 不在 waiting 列表中。"""
    store = EscalationStore()
    r1 = store.create(run_id="r1", question="q1", choices=["a"])
    store.create(run_id="r2", question="q2", choices=["b"])
    store.resolve(r1.escalation_id, "a")
    waiting = store.list_waiting()
    assert len(waiting) == 1
    assert waiting[0].run_id == "r2"


def test_escalation_timeout_check():
    """超时的 escalation 被自动标记为 expired。"""
    import time
    store = EscalationStore()
    record = store.create(run_id="r1", question="q", choices=["a"])
    # 手动设置创建时间为超时前
    record.created_at = time.time() - (ESCALATION_TIMEOUT_HOURS + 1) * 3600
    store.check_timeouts()
    expired = store.get(record.escalation_id)
    assert expired.status == "expired"


def test_escalation_build_resume_prompt():
    """构建恢复提示词。"""
    record = EscalationRecord(
        escalation_id="esc-1",
        run_id="run-1",
        question="原始问题？",
        choices=["是", "否"],
    )
    record.user_response = "是"
    prompt = record.build_resume_prompt()
    assert "原始问题" in prompt
    assert "是" in prompt
