"""LLM 审批网关 —— 工具执行前的统一审批决策层。

根据工具名和参数风险分级，决定是否需要用户审批。
复用 interaction.py 的 register/resolve 机制进行异步等待。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)


class ApprovalDecision(str, Enum):
    """审批决策结果。"""
    APPROVED = "approved"          # 已批准
    REJECTED = "rejected"          # 已拒绝
    AUTO_APPROVED = "auto_approved"  # 自动批准（无需审批）
    TIMEOUT = "timeout"            # 超时


@dataclass
class ApprovalRequest:
    """审批请求。"""
    tool_name: str
    tool_input: dict[str, Any]
    session_id: str
    turn_id: str = ""
    reason: str = ""  # 为什么需要审批
    risk_level: str = "medium"  # low / medium / high


class ApprovalGateway:
    """审批网关，全局单例。"""

    _instance: Optional["ApprovalGateway"] = None

    def __init__(self) -> None:
        pass  # 不缓存 settings，每次实时获取以支持热重载

    @classmethod
    def get(cls) -> "ApprovalGateway":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def needs_approval(self, tool_name: str, session_id: str, auto_approve: bool = False) -> bool:
        """判断工具是否需要审批。

        决策逻辑：
        1. 审批网关未启用 → False
        2. 会话级 auto_approve=True → False
        3. 工具在 approval_required_tools 列表中 → True
        4. 其他 → False
        """
        # 实时获取 settings，确保 reload_settings 后立即生效
        settings = get_settings()
        if not settings.approval_gateway_enabled:
            return False

        if auto_approve:
            return False

        return tool_name in settings.approval_required_tools

    def create_request(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        session_id: str,
        turn_id: str = "",
    ) -> ApprovalRequest:
        """创建审批请求对象。"""
        risk_level = self._assess_risk(tool_name, tool_input)
        reason = self._build_reason(tool_name, tool_input, risk_level)
        return ApprovalRequest(
            tool_name=tool_name,
            tool_input=tool_input,
            session_id=session_id,
            turn_id=turn_id,
            reason=reason,
            risk_level=risk_level,
        )

    def _assess_risk(self, tool_name: str, tool_input: dict[str, Any]) -> str:
        """评估风险等级。"""
        high_risk_tools = {"git_push", "shell_exec", "run_python"}
        medium_risk_tools = {"file_edit", "file_write", "git_commit"}

        if tool_name in high_risk_tools:
            return "high"
        if tool_name in medium_risk_tools:
            return "medium"
        return "low"

    def _build_reason(self, tool_name: str, tool_input: dict[str, Any], risk_level: str) -> str:
        """构建审批理由说明。"""
        risk_labels = {"high": "高风险", "medium": "中风险", "low": "低风险"}
        parts = [f"{risk_labels.get(risk_level, '未知风险')}工具：{tool_name}"]

        # 展示关键参数预览
        if "code" in tool_input:
            code_preview = str(tool_input["code"])[:100]
            parts.append(f"代码预览：{code_preview}")
        elif "path" in tool_input or "file_path" in tool_input:
            path = tool_input.get("path") or tool_input.get("file_path", "")
            parts.append(f"路径：{path}")
        elif "command" in tool_input:
            cmd_preview = str(tool_input["command"])[:100]
            parts.append(f"命令预览：{cmd_preview}")

        return "，".join(parts)


# 模块级单例
approval_gateway = ApprovalGateway.get()
