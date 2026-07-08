# tests/test_memory/test_memory_scheduler.py
import pytest
import json
from pathlib import Path
from memory.memory_scheduler import MemoryScheduler, DailyState

def test_daily_state_persistence(tmp_path):
    """daily-state.json 应持久化步骤完成状态"""
    state_file = tmp_path / "daily-state.json"
    scheduler = MemoryScheduler(state_file=str(state_file))

    # 标记步骤完成
    scheduler.mark_step_done("rolling_summary", "sess-1")
    scheduler.save_state()

    # 重新加载，应该记得已完成
    scheduler2 = MemoryScheduler(state_file=str(state_file))
    assert scheduler2.is_step_done("rolling_summary", "sess-1") is True
    assert scheduler2.is_step_done("deep_memory", "sess-1") is False

def test_step_health_tracking(tmp_path):
    """步骤健康状态追踪"""
    scheduler = MemoryScheduler(state_file=str(tmp_path / "daily-state.json"))

    scheduler.record_step_failure("deep_memory", "sess-1", "LLM timeout")
    scheduler.record_step_failure("deep_memory", "sess-1", "LLM timeout")
    health = scheduler.get_step_health("deep_memory", "sess-1")
    assert health.fail_count == 2

    # 成功一次清零
    scheduler.record_step_success("deep_memory", "sess-1")
    health = scheduler.get_step_health("deep_memory", "sess-1")
    assert health.fail_count == 0

def test_skip_completed_steps(tmp_path):
    """断点续跑：跳过已完成步骤"""
    scheduler = MemoryScheduler(state_file=str(tmp_path / "daily-state.json"))
    scheduler.mark_step_done("rolling_summary", "sess-1")
    scheduler.save_state()

    # 重新加载
    scheduler2 = MemoryScheduler(state_file=str(tmp_path / "daily-state.json"))
    # rolling_summary 应该被跳过
    assert scheduler2.is_step_done("rolling_summary", "sess-1") is True
