"""审批适配器 — 映射 Maxma 的审批规则到 oh-my-pi 的工具审批级别。

oh-my-pi 的工具可以声明 approval 属性：
- "read": 读操作，不需要审批
- "write": 写操作，需要用户确认
- "interactive": 交互式操作，需要用户参与

Maxma 的审批网关通过此映射与 oh-my-pi 集成。
"""

from __future__ import annotations

from typing import Any

# Maxma 工具名 → oh-my-pi approval 级别
# 当 oh-my-pi agent 调用这些工具时，会触发相应级别的用户确认流程
TOOL_APPROVAL_MAP: dict[str, str] = {
    # 文件写操作 — 需要审批
    "file_write": "write",
    "file_manage": "write",
    "file_edit": "write",
    # 文件读操作 — 不需要审批
    "file_read": "read",
    "file_search": "read",
    # 系统操作 — 需要审批
    "run_python": "write",
    # 网络操作 — 读级别
    "tavily_search": "read",
    "tavily_extract": "read",
    "get_current_weather": "read",
    # 子 Agent — 需要审批
    "call_sub_agent": "write",
    "parallel_execute": "write",
    # 交互 — 交互级别
    "ask_user_qa": "interactive",
    "ask_user_confirm": "interactive",
}


def get_approval_level(tool_name: str) -> str:
    """获取工具的审批级别。
    
    Args:
        tool_name: 工具名称
        
    Returns:
        "read" / "write" / "interactive" / "auto"（默认自动）
    """
    return TOOL_APPROVAL_MAP.get(tool_name, "ask")


def is_high_risk(tool_name: str) -> bool:
    """判断工具是否高风险（需要审批）。"""
    return get_approval_level(tool_name) in ("write", "interactive")
