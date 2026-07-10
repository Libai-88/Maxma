# tools/system/tool_report_to_user.py
"""report_to_user 工具 — 后台 run 的唯一权威完成信号。

设计参考 Halo report-tool.ts:93-231：
- 5 种 type：run_complete / run_skipped / milestone / escalation / output
- 仅在自治/headless 模式下注入工具列表
- completion_signal 模块检测此工具的调用来判定 run 是否完成

与 Maxma 现有工具系统的关系：
- 使用 @register_tool 装饰器注册
- 继承 ToolBase
- 在自治 runner 的 _ALLOWED_HEADLESS_TOOLS 中添加此工具
"""
from __future__ import annotations

import logging
from typing import List, Optional

from langchain_core.tools import tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class ReportToUserInput(BaseModel):
    """report_to_user 工具的输入参数。"""
    type: str = Field(
        ...,
        description=(
            "报告类型："
            "run_complete=任务完成, "
            "run_skipped=本次无事可做, "
            "milestone=任务中重要发现, "
            "escalation=需用户决策, "
            "output=产出了文件/报告"
        ),
    )
    message: str = Field(
        ...,
        description="报告内容摘要",
    )
    choices: Optional[List[str]] = Field(
        None,
        description="escalation 类型的可选选项列表",
    )


def _report_to_user(
    type: str,
    message: str,
    choices: Optional[List[str]] = None,
) -> str:
    """向用户报告执行结果。每个后台任务必须以此工具结束。

    Args:
        type: 报告类型（run_complete/run_skipped/milestone/escalation/output）
        message: 报告内容摘要
        choices: escalation 类型的可选选项列表

    Returns:
        确认消息
    """
    valid_types = {"run_complete", "run_skipped", "milestone", "escalation", "output"}
    if type not in valid_types:
        return f"错误：无效的报告类型 '{type}'，有效值：{valid_types}"

    if type == "escalation":
        # 创建 escalation 记录
        try:
            from agent.autonomy.escalation import get_escalation_store
            store = get_escalation_store()
            # 注意：run_id 在自治 runner 中注入，这里用占位
            store.create(
                run_id="current",
                question=message,
                choices=choices or [],
            )
        except Exception as e:
            logger.warning("[report_to_user] escalation 创建失败: %s", e)

        choices_text = " / ".join(choices) if choices else "自由回复"
        return (
            f"Escalation 已发送给用户。\n"
            f"问题: {message}\n"
            f"选项: {choices_text}\n"
            f"请结束当前 run — 用户回复后会恢复。"
        )

    return f"[{type}] {message}"


# 创建 LangChain tool 实例
# 注意：langchain_core 1.4.x 的 tool() 不接受 name 关键字参数，
# 需通过第一个位置参数（字符串）传入名称，返回装饰器再应用到函数。
report_to_user_tool = tool("report_to_user")(_report_to_user)


# Maxma ToolBase 兼容封装
try:
    from tools.registry import register_tool
    from tools.tool_base import ToolBase

    @register_tool
    class ReportToUserTool(ToolBase):
        """report_to_user 工具 — 后台 run 完成信号。"""

        # pydantic v2 BaseTool 要求 name/description 为类字段（非 @property），
        # 否则字段描述符与 property 冲突，实例访问返回 property 对象而非字符串。
        name: str = "report_to_user"
        description: str = (
            "向用户报告执行结果。每个后台任务必须以此工具结束。"
            "type=run_complete 表示任务完成，type=escalation 表示需要用户决策。"
        )

        def _run(self, type: str, message: str, choices: Optional[List[str]] = None) -> str:
            return _report_to_user(type, message, choices)

except ImportError:
    # 测试环境可能没有 ToolBase
    class ReportToUserTool:
        """测试用简化版。"""

        @property
        def name(self) -> str:
            return "report_to_user"

        @property
        def description(self) -> str:
            return "向用户报告执行结果"

        def _run(self, type: str, message: str, choices: Optional[List[str]] = None) -> str:
            return _report_to_user(type, message, choices)
