"""Pure, fail-closed authorization policy for tool execution.

The policy deliberately decides only whether a call may run, needs an
interactive approval, or must be denied.  It does not replace the individual
tool's path, network, sandbox, or allow-list checks.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import AbstractSet


class PermissionMode(str, Enum):
    """Session and delegated-run permission modes, from most to least strict."""

    READ_ONLY = "read_only"
    ASK = "ask"
    OPERATE = "operate"
    AUTO = "auto"


class AuthorizationAction(str, Enum):
    ALLOW = "allow"
    ASK = "ask"
    DENY = "deny"


class ToolRisk(str, Enum):
    READ = "read"
    LOCAL_WRITE = "local_write"
    EXTERNAL = "external"
    EXECUTION = "execution"
    DESTRUCTIVE = "destructive"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class AuthorizationDecision:
    action: AuthorizationAction
    reason_code: str
    risk: ToolRisk


# These names are intentionally conservative.  A new tool is UNKNOWN until it
# is explicitly classified, which prevents it from inheriting an unsafe mode.
_READ_TOOLS = frozenset({
    "file_read", "file_list", "list_files", "project_info", "git_status",
    "git_diff", "kb_search", "list_memories", "system_diagnose",
    "rag_diagnose", "web_fetch",
})
_LOCAL_WRITE_TOOLS = frozenset({
    "file_write", "file_edit", "todo_create", "todo_update", "todo_complete",
    "manage_skills", "git_branch", "git_checkout",
})
_EXTERNAL_TOOLS = frozenset({
    "web_search", "tavily_search", "browser_open", "browser_click",
    "mcp_call", "mcp_tool", "send_email", "send_message",
})
_EXECUTION_TOOLS = frozenset({"shell_exec", "run_python", "run_code"})
_DESTRUCTIVE_TOOLS = frozenset({
    "file_delete", "git_commit", "git_push", "git_reset", "git_clean",
})

_MODE_RANK = {
    PermissionMode.READ_ONLY: 0,
    PermissionMode.ASK: 1,
    PermissionMode.OPERATE: 2,
    PermissionMode.AUTO: 3,
}


def parse_permission_mode(value: PermissionMode | str | None) -> PermissionMode:
    """Return a validated mode, defaulting absent state to compatible ``ask``."""
    if value is None:
        return PermissionMode.ASK
    if isinstance(value, PermissionMode):
        return value
    try:
        return PermissionMode(value)
    except ValueError as exc:
        raise ValueError(f"Unsupported permission mode: {value!r}") from exc


def narrow_permission_mode(
    parent: PermissionMode | str | None,
    requested: PermissionMode | str | None,
) -> PermissionMode:
    """Return the more restrictive parent/child mode.

    An invalid requested mode fails closed to ``read_only``.  Parent state is
    expected to be persisted/validated before delegation; treating malformed
    child input as the least permissive mode prevents a privilege escalation.
    """
    parent_mode = parse_permission_mode(parent)
    try:
        requested_mode = parse_permission_mode(requested)
    except ValueError:
        requested_mode = PermissionMode.READ_ONLY
    return min((parent_mode, requested_mode), key=_MODE_RANK.__getitem__)


def classify_tool(tool_name: str) -> ToolRisk:
    """Classify a tool by its externally observable side-effect class."""
    if tool_name in _READ_TOOLS:
        return ToolRisk.READ
    if tool_name in _LOCAL_WRITE_TOOLS:
        return ToolRisk.LOCAL_WRITE
    if tool_name in _EXTERNAL_TOOLS:
        return ToolRisk.EXTERNAL
    if tool_name in _EXECUTION_TOOLS:
        return ToolRisk.EXECUTION
    if tool_name in _DESTRUCTIVE_TOOLS:
        return ToolRisk.DESTRUCTIVE
    return ToolRisk.UNKNOWN


def authorize_tool(
    tool_name: str,
    mode: PermissionMode | str | None,
    *,
    allowed_tools: AbstractSet[str] | None = None,
    auto_allowed_tools: AbstractSet[str] | None = None,
) -> AuthorizationDecision:
    """Apply the four-mode authorization matrix at the invocation boundary."""
    permission_mode = parse_permission_mode(mode)
    risk = classify_tool(tool_name)

    if allowed_tools is not None and tool_name not in allowed_tools:
        return AuthorizationDecision(AuthorizationAction.DENY, "tool_not_in_scope", risk)

    if permission_mode is PermissionMode.READ_ONLY:
        if risk is ToolRisk.READ:
            return AuthorizationDecision(AuthorizationAction.ALLOW, "read_only_read", risk)
        return AuthorizationDecision(AuthorizationAction.DENY, "read_only_blocks_side_effect", risk)

    if permission_mode is PermissionMode.ASK:
        if risk is ToolRisk.READ:
            return AuthorizationDecision(AuthorizationAction.ALLOW, "ask_read", risk)
        return AuthorizationDecision(AuthorizationAction.ASK, "ask_requires_confirmation", risk)

    if permission_mode is PermissionMode.OPERATE:
        if risk in (ToolRisk.READ, ToolRisk.LOCAL_WRITE):
            return AuthorizationDecision(AuthorizationAction.ALLOW, "operate_local_capability", risk)
        return AuthorizationDecision(AuthorizationAction.ASK, "operate_requires_confirmation", risk)

    # AUTO is deliberately not an unrestricted variant of OPERATE.  Only a
    # caller-provided capability allow-list may promote a local write; high
    # risk, external, executable, and unknown tools continue to require a user.
    if risk is ToolRisk.READ:
        return AuthorizationDecision(AuthorizationAction.ALLOW, "auto_read", risk)
    if risk is ToolRisk.LOCAL_WRITE and tool_name in (auto_allowed_tools or frozenset()):
        return AuthorizationDecision(AuthorizationAction.ALLOW, "auto_whitelisted_local_capability", risk)
    return AuthorizationDecision(AuthorizationAction.ASK, "auto_requires_confirmation", risk)
