# agent/autonomy/escalation.py
"""Escalation run 边界 — 让后台任务能请求用户输入。

设计参考 Halo report-tool.ts:202-227 + service.ts:581-665：
- AI 调用 report_to_user(type="escalation") 时，当前 run 结束，状态变 waiting_user
- 用户回复后触发新 run，接收：原始问题 + 用户回复
- 24h 超时自动 resolve + 标记 expired

与 Maxma 现有自治 runner 的关系：
- runner 执行后检查是否调用了 escalation
- 如果是，run 状态变 waiting_user，等待用户回复
- 用户回复后，用 build_resume_prompt 构建新 run 的初始消息
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# Escalation 超时时间（小时）
ESCALATION_TIMEOUT_HOURS = 24


@dataclass
class EscalationRecord:
    """单次 escalation 记录。

    Attributes:
        escalation_id: 唯一 ID
        run_id: 关联的 run ID
        question: AI 提出的问题
        choices: 可选选项列表
        status: waiting / resolved / expired
        user_response: 用户的回复（resolved 后填入）
        created_at: 创建时间戳
        resolved_at: 解决时间戳
    """
    escalation_id: str
    run_id: str
    question: str
    choices: List[str] = field(default_factory=list)
    status: str = "waiting"
    user_response: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    resolved_at: Optional[float] = None

    def build_resume_prompt(self) -> str:
        """构建恢复 run 的初始消息。

        当用户回复后，新 run 接收此消息作为 HumanMessage。

        Returns:
            恢复提示词
        """
        choices_text = " / ".join(self.choices) if self.choices else "自由回复"
        return (
            f"[Escalation 恢复]\n"
            f"你的问题: {self.question}\n"
            f"可选项: {choices_text}\n"
            f"用户的回复: {self.user_response or '(无回复)'}\n\n"
            f"请根据用户的回复继续执行任务。"
        )


class EscalationStore:
    """Escalation 记录存储（内存实现，进程内单例）。

    生产环境可替换为 SQLite 持久化存储。
    """

    def __init__(self):
        self._records: dict[str, EscalationRecord] = {}
        self._lock = None  # asyncio 场景需用 asyncio.Lock

    def create(
        self,
        run_id: str,
        question: str,
        choices: Optional[List[str]] = None,
    ) -> EscalationRecord:
        """创建新的 escalation 记录。

        Args:
            run_id: 关联的 run ID
            question: AI 提出的问题
            choices: 可选选项列表

        Returns:
            创建的 EscalationRecord
        """
        escalation_id = f"esc-{uuid.uuid4().hex[:8]}"
        record = EscalationRecord(
            escalation_id=escalation_id,
            run_id=run_id,
            question=question,
            choices=choices or [],
        )
        self._records[escalation_id] = record
        logger.info(
            "[escalation] 创建 escalation: id=%s, run=%s, question=%s",
            escalation_id, run_id, question[:100],
        )
        return record

    def get(self, escalation_id: str) -> Optional[EscalationRecord]:
        """获取 escalation 记录。"""
        return self._records.get(escalation_id)

    def resolve(self, escalation_id: str, user_response: str) -> Optional[EscalationRecord]:
        """解决 escalation。

        Args:
            escalation_id: escalation ID
            user_response: 用户的回复

        Returns:
            更新后的 EscalationRecord，或 None（不存在）
        """
        record = self._records.get(escalation_id)
        if record is None:
            return None
        record.status = "resolved"
        record.user_response = user_response
        record.resolved_at = time.time()
        logger.info(
            "[escalation] 解决 escalation: id=%s, response=%s",
            escalation_id, user_response[:100],
        )
        return record

    def list_waiting(self) -> List[EscalationRecord]:
        """列出所有等待中的 escalation。"""
        return [r for r in self._records.values() if r.status == "waiting"]

    def check_timeouts(self) -> List[EscalationRecord]:
        """检查超时的 escalation 并标记为 expired。

        Returns:
            被标记为 expired 的记录列表
        """
        now = time.time()
        timeout_seconds = ESCALATION_TIMEOUT_HOURS * 3600
        expired = []
        for record in self._records.values():
            if record.status == "waiting":
                if now - record.created_at > timeout_seconds:
                    record.status = "expired"
                    record.resolved_at = now
                    expired.append(record)
                    logger.warning(
                        "[escalation] escalation 超时: id=%s, run=%s",
                        record.escalation_id, record.run_id,
                    )
        return expired


# 全局单例
_escalation_store: Optional[EscalationStore] = None


def get_escalation_store() -> EscalationStore:
    """获取全局 EscalationStore 单例。"""
    global _escalation_store
    if _escalation_store is None:
        _escalation_store = EscalationStore()
    return _escalation_store
