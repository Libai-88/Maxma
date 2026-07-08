# agent/capability_policy.py
"""Capability + Permission + Grant 三层权限模型。

- Capability: 命名空间化的操作能力（file.read, network.fetch, file.*）
- Permission: 会话级 4 档模式（AUTO / OPERATE / ASK / READ_ONLY）
- Grant: 持久化的主体→能力映射（本 Task 只实现接口，不实现持久化）
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from fnmatch import fnmatch
from typing import Any


class PermissionMode(Enum):
    AUTO = "auto"           # 自动执行所有工具
    OPERATE = "operate"     # 自动执行，但高风险需确认
    ASK = "ask"             # 副作用工具需确认
    READ_ONLY = "read_only" # 只读，拒绝所有写操作


class PermissionDecision(Enum):
    ALLOW = "allow"
    DENY = "deny"
    PROMPT = "prompt"
    REVIEW = "review"


@dataclass(frozen=True)
class Capability:
    """命名空间化的操作能力。"""
    name: str

    def matches(self, action: str) -> bool:
        """检查此能力是否覆盖给定的操作（支持通配符）。"""
        return fnmatch(action, self.name)


# 工具分类
INFORMATION_TOOLS: set[str] = {
    "file_read", "file_search", "grep", "list_dir",
    "web_search", "web_fetch", "kb_search",
    "search_episodic", "search_semantic", "search_memories", "read_memories",
    "git_status", "git_log", "git_diff",
    "project_info", "weather", "holiday",
    "list_todo", "query_todo",
}

SIDE_EFFECT_TOOLS: set[str] = {
    "file_write", "file_edit", "file_delete",
    "run_python", "shell_exec",
    "git_commit", "git_push", "git_branch",
    "create_memory", "update_memory", "delete_memory", "merge_memories",
    "add_todo", "update_todo", "complete_todo", "delete_todo",
    "kb_add", "create_persona",
}

SUBAGENT_BLOCKED_TOOLS: set[str] = {
    "call_sub_agent", "parallel_sub_agent",
    "pin_memory", "create_persona",
    "automation", "cron",
}


def classify_permission(
    tool_name: str,
    mode: str,
    *,
    is_subagent: bool = False,
    auto_approve: bool = False,
) -> PermissionDecision:
    """分类工具权限。

    拦截分层：subagent_blocklist → subagent_access → mode 决策
    """
    # 1. SubAgent 阻止列表
    if is_subagent and tool_name in SUBAGENT_BLOCKED_TOOLS:
        return PermissionDecision.DENY

    # 2. READ_ONLY 模式：硬性安全约束，不被 auto_approve 覆盖
    if mode == "read_only":
        if tool_name in SIDE_EFFECT_TOOLS:
            return PermissionDecision.DENY
        if tool_name in INFORMATION_TOOLS:
            return PermissionDecision.ALLOW
        return PermissionDecision.DENY

    # 3. AUTO 模式 + auto_approve
    if mode == "auto" or auto_approve:
        return PermissionDecision.ALLOW

    # 4. 信息类工具：所有模式都放行
    if tool_name in INFORMATION_TOOLS:
        return PermissionDecision.ALLOW

    # 5. 副作用工具：根据模式决策
    if tool_name in SIDE_EFFECT_TOOLS:
        if mode == "ask":
            return PermissionDecision.PROMPT
        if mode == "operate":
            # OPERATE 模式下，高风险工具仍需确认（由 approval_gateway 处理）
            return PermissionDecision.REVIEW
        return PermissionDecision.ALLOW

    # 6. 未知工具：保守策略
    if mode == "ask":
        return PermissionDecision.PROMPT
    return PermissionDecision.REVIEW
