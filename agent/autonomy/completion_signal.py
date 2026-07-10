# agent/autonomy/completion_signal.py
"""report_to_user 完成信号 — 后台 run 的唯一权威完成信号。

设计参考 Halo execute.ts:820-836：
- report_to_user 是后台 run 的唯一权威完成信号
- 未调用 report_to_user → 自动 continue（最多 10 次）
- 10 次后仍未调用 → 标记为 error

与 Maxma 现有自治 runner 的关系：
- 在 graph.ainvoke 完成后，检查输出消息是否包含 report_to_user 工具调用
- 如果没有，自动注入 continue 消息重新执行
- 通过 settings 的 feature flag 控制（默认关闭）
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from langchain_core.messages import AIMessage, BaseMessage

logger = logging.getLogger(__name__)

# 最大自动 continue 次数（参考 Halo execute.ts:115，从 3 提到 10 容忍更长上下文压力期）
MAX_AUTO_CONTINUES = 10

# report_to_user 工具名（LangChain tool name 可能带前缀，用 includes 匹配）
_REPORT_TOOL_NAME = "report_to_user"


@dataclass
class RunOutcome:
    """单次 run 的结果判定。

    Attributes:
        signal_detected: 是否检测到 report_to_user 工具调用
        report_type: report_to_user 的 type 参数（run_complete/run_skipped/escalation 等）
        auto_continue_count: 当前已自动 continue 的次数
        final_text: AI 最终输出的文本
    """
    signal_detected: bool = False
    report_type: Optional[str] = None
    auto_continue_count: int = 0
    final_text: str = ""

    @property
    def final_status(self) -> str:
        """判定最终状态。

        - signal_detected=True → "ok"（任务完成）
        - signal_detected=False + auto_continue_count >= MAX_AUTO_CONTINUES → "error"
        - signal_detected=False + auto_continue_count < MAX_AUTO_CONTINUES → "pending"（应 continue）
        """
        if self.signal_detected:
            return "ok"
        if self.auto_continue_count >= MAX_AUTO_CONTINUES:
            return "error"
        return "pending"


def detect_completion_signal(messages: List[BaseMessage]) -> RunOutcome:
    """从消息列表中检测 report_to_user 完成信号。

    遍历所有 AIMessage 的 tool_calls，查找 report_to_user 工具调用。

    Args:
        messages: graph.ainvoke 输出的消息列表

    Returns:
        RunOutcome 描述检测结果
    """
    final_text = ""

    for msg in reversed(messages):
        if not isinstance(msg, AIMessage):
            continue

        # 收集最终文本（最后一条有内容的 AIMessage）
        if not final_text and msg.content:
            final_text = str(msg.content)

        # 检查 tool_calls
        tool_calls = getattr(msg, "tool_calls", None) or []
        for tc in tool_calls:
            tool_name = tc.get("name", "")
            if _REPORT_TOOL_NAME in tool_name:
                args = tc.get("args", {}) or {}
                report_type = args.get("type", "run_complete")
                logger.info(
                    "[completion_signal] 检测到完成信号: type=%s", report_type
                )
                return RunOutcome(
                    signal_detected=True,
                    report_type=report_type,
                    final_text=final_text,
                )

    return RunOutcome(
        signal_detected=False,
        report_type=None,
        final_text=final_text,
    )


def should_auto_continue(outcome: RunOutcome) -> bool:
    """判断是否应该自动 continue。

    条件：
    - 未检测到完成信号
    - 未达到最大 continue 次数

    Args:
        outcome: 当前 run 的结果判定

    Returns:
        True 如果应该自动 continue
    """
    if outcome.signal_detected:
        return False
    if outcome.auto_continue_count >= MAX_AUTO_CONTINUES:
        return False
    return True


def build_auto_continue_message(count: int, max_count: int = MAX_AUTO_CONTINUES) -> str:
    """构建自动 continue 的提示消息。

    参考 Halo execute.ts:118-120 的 AUTO_CONTINUE_MESSAGE。

    Args:
        count: 当前是第几次 continue（1-based）
        max_count: 最大 continue 次数

    Returns:
        continue 提示消息
    """
    return (
        f"Continue. (Auto-continue {count}/{max_count}) "
        f"You ended your response without calling report_to_user. "
        f"Every execution MUST end with a report_to_user call. "
        f"If the task is complete, call report_to_user with type='run_complete'. "
        f"If there's nothing to do, call report_to_user with type='run_skipped'. "
        f"If you need user input, call report_to_user with type='escalation'."
    )
