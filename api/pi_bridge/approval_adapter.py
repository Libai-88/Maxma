"""审批适配器 — 映射 OMP 原生工具到审批级别。

oh-my-pi 的工具可以声明 approval 属性：
- "read": 读操作，不需要审批
- "write": 写操作，需要用户确认
- "interactive": 交互式操作，需要用户参与

Maxma 的审批网关通过此映射与 oh-my-pi 集成。
"""

from __future__ import annotations

from typing import Any

# OMP 原生工具名 → approval 级别
# 当 oh-my-pi agent 调用这些工具时，会触发相应级别的用户确认流程
TOOL_APPROVAL_MAP: dict[str, str] = {
    # 文件读 — 不需要审批
    "read": "read",
    "glob": "read",
    "grep": "read",
    "inspect_image": "read",
    "web_search": "read",
    "ast_grep": "read",
    "recall": "read",
    "reflect": "read",
    "retain": "read",
    # 文件写 — 需要审批
    "write": "write",
    "edit": "write",
    "ast_edit": "write",
    # 代码执行 — 需要审批
    "bash": "write",
    "eval": "write",
    "debug": "write",
    # 系统操作 — 需要审批
    "github": "write",
    "ssh": "write",
    "browser": "write",
    "launch": "write",
    "task": "write",
    "job": "write",
    "checkpoint": "write",
    "rewind": "write",
    "todo": "write",
    "manage_skill": "write",
    "learn": "write",
    "memory_edit": "write",
    # 交互 — 交互级别
    "ask": "interactive",
}


def get_approval_level(tool_name: str) -> str:
    """获取工具的审批级别。

    Args:
        tool_name: 工具名称

    Returns:
        "read" / "write" / "interactive" / "ask"（默认询问）
    """
    return TOOL_APPROVAL_MAP.get(tool_name, "ask")


def is_high_risk(tool_name: str) -> bool:
    """判断工具是否高风险（需要审批）。"""
    return get_approval_level(tool_name) in ("write", "interactive")
