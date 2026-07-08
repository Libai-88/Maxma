# memory/memory_scheduler.py
"""断点续跑记忆调度器。

按天滚动记忆传送带：
- 每 10 轮：滚动摘要
- session 结束：final 滚动摘要
- 每天：Deep Memory 提取

断点续跑：daily-state.json 持久化每个步骤完成状态，进程重启后跳过已完成步骤。
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DAILY_STATE_SCHEMA_VERSION = 1


@dataclass
class StepHealth:
    """步骤健康状态。"""
    last_success_at: float = 0
    last_error_at: float = 0
    fail_count: int = 0
    last_error: str = ""


@dataclass
class DailyState:
    """每日状态持久化。"""
    schema_version: int = DAILY_STATE_SCHEMA_VERSION
    date: str = ""
    completed_steps: dict[str, list[str]] = field(default_factory=dict)  # step_name -> [session_id]
    step_health: dict[str, dict[str, Any]] = field(default_factory=dict)  # f"{step}:{session}" -> health dict


class MemoryScheduler:
    """断点续跑记忆调度器。"""

    def __init__(self, *, state_file: str | None = None) -> None:
        if state_file is None:
            from app_paths import DATA_DIR
            state_file = str(Path(DATA_DIR) / "memory-daily-state.json")
        self._state_file = Path(state_file)
        self._state = DailyState(date=time.strftime("%Y-%m-%d"))
        self._load_state()

    def _load_state(self) -> None:
        """从文件加载状态。"""
        if not self._state_file.exists():
            return
        try:
            data = json.loads(self._state_file.read_text(encoding="utf-8"))
            if data.get("schema_version") != DAILY_STATE_SCHEMA_VERSION:
                logger.warning("Daily state schema version mismatch, starting fresh")
                return
            self._state.date = data.get("date", "")
            self._state.completed_steps = data.get("completed_steps", {})
            self._state.step_health = data.get("step_health", {})
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Failed to load daily state: {e}")

    def save_state(self) -> None:
        """保存状态到文件。"""
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        data = asdict(self._state)
        self._state_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def mark_step_done(self, step: str, session_id: str) -> None:
        """标记步骤完成。"""
        if step not in self._state.completed_steps:
            self._state.completed_steps[step] = []
        if session_id not in self._state.completed_steps[step]:
            self._state.completed_steps[step].append(session_id)

    def is_step_done(self, step: str, session_id: str) -> bool:
        """检查步骤是否已完成。"""
        return session_id in self._state.completed_steps.get(step, [])

    def record_step_success(self, step: str, session_id: str) -> None:
        """记录步骤成功。"""
        key = f"{step}:{session_id}"
        self._state.step_health[key] = {
            "last_success_at": time.time(),
            "last_error_at": 0,
            "fail_count": 0,
            "last_error": "",
        }

    def record_step_failure(self, step: str, session_id: str, error: str) -> None:
        """记录步骤失败。"""
        key = f"{step}:{session_id}"
        existing = self._state.step_health.get(key, {})
        self._state.step_health[key] = {
            "last_success_at": existing.get("last_success_at", 0),
            "last_error_at": time.time(),
            "fail_count": existing.get("fail_count", 0) + 1,
            "last_error": error[:500],
        }

    def get_step_health(self, step: str, session_id: str) -> StepHealth:
        """获取步骤健康状态。"""
        key = f"{step}:{session_id}"
        data = self._state.step_health.get(key, {})
        return StepHealth(
            last_success_at=data.get("last_success_at", 0),
            last_error_at=data.get("last_error_at", 0),
            fail_count=data.get("fail_count", 0),
            last_error=data.get("last_error", ""),
        )

    def reset_daily(self) -> None:
        """重置每日状态（新的一天开始时调用）。"""
        self._state = DailyState(date=time.strftime("%Y-%m-%d"))
        self.save_state()
