"""Focused contract tests for the four-mode backend authorization policy."""
from __future__ import annotations

try:
    import agent.permission_policy
except ImportError:
    import pytest
    pytest.skip('agent.permission_policy module removed — OMP replaces it', allow_module_level=True)
import pytest
from types import SimpleNamespace

from agent.delegation_scope import DelegationScope, intersect
from agent.permission_policy import (
    AuthorizationAction,
    PermissionMode,
    authorize_tool,
    narrow_permission_mode,
)


@pytest.mark.parametrize(
    ("mode", "tool_name", "expected"),
    [
        (PermissionMode.READ_ONLY, "file_read", AuthorizationAction.ALLOW),
        (PermissionMode.READ_ONLY, "file_write", AuthorizationAction.DENY),
        (PermissionMode.READ_ONLY, "shell_exec", AuthorizationAction.DENY),
        (PermissionMode.ASK, "file_read", AuthorizationAction.ALLOW),
        (PermissionMode.ASK, "file_write", AuthorizationAction.ASK),
        (PermissionMode.ASK, "shell_exec", AuthorizationAction.ASK),
        (PermissionMode.OPERATE, "file_read", AuthorizationAction.ALLOW),
        (PermissionMode.OPERATE, "file_write", AuthorizationAction.ALLOW),
        (PermissionMode.OPERATE, "shell_exec", AuthorizationAction.ASK),
        (PermissionMode.AUTO, "file_read", AuthorizationAction.ALLOW),
        (PermissionMode.AUTO, "file_write", AuthorizationAction.ASK),
        (PermissionMode.AUTO, "shell_exec", AuthorizationAction.ASK),
    ],
)
def test_permission_mode_authorization_matrix(mode, tool_name, expected):
    assert authorize_tool(tool_name, mode).action is expected


def test_auto_mode_requires_explicit_whitelist_and_never_auto_executes_shell():
    allowed = frozenset({"file_write", "shell_exec"})
    assert authorize_tool(
        "file_write", PermissionMode.AUTO, auto_allowed_tools=allowed
    ).action is AuthorizationAction.ALLOW
    assert authorize_tool(
        "shell_exec", PermissionMode.AUTO, auto_allowed_tools=allowed
    ).action is AuthorizationAction.ASK


def test_unknown_tool_is_not_treated_as_safe_in_any_elevated_mode():
    assert authorize_tool("new_unclassified_tool", PermissionMode.READ_ONLY).action is AuthorizationAction.DENY
    assert authorize_tool("new_unclassified_tool", PermissionMode.OPERATE).action is AuthorizationAction.ASK
    assert authorize_tool("new_unclassified_tool", PermissionMode.AUTO).action is AuthorizationAction.ASK


def test_scope_allowlist_denies_even_anotherwise_safe_tool():
    decision = authorize_tool(
        "file_read", PermissionMode.AUTO, allowed_tools=frozenset({"kb_search"})
    )
    assert decision.action is AuthorizationAction.DENY
    assert decision.reason_code == "tool_not_in_scope"


@pytest.mark.parametrize(
    ("parent", "requested", "expected"),
    [
        (PermissionMode.READ_ONLY, PermissionMode.AUTO, PermissionMode.READ_ONLY),
        (PermissionMode.ASK, PermissionMode.OPERATE, PermissionMode.ASK),
        (PermissionMode.OPERATE, PermissionMode.ASK, PermissionMode.ASK),
        (PermissionMode.AUTO, PermissionMode.AUTO, PermissionMode.AUTO),
        (PermissionMode.OPERATE, "invalid", PermissionMode.READ_ONLY),
    ],
)
def test_child_permission_mode_can_only_inherit_or_narrow(parent, requested, expected):
    assert narrow_permission_mode(parent, requested) is expected


def test_scope_intersection_narrows_permission_mode_with_other_capabilities():
    parent = DelegationScope(
        allowed_tools=frozenset({"file_read", "file_write"}),
        allowed_paths=frozenset({"D:/work"}),
        permission_mode=PermissionMode.OPERATE,
    )
    child = DelegationScope(
        allowed_tools=frozenset({"file_read"}),
        allowed_paths=frozenset({"D:/work"}),
        permission_mode=PermissionMode.AUTO,
    )
    result = intersect(parent, child)
    assert result.permission_mode is PermissionMode.OPERATE
    assert result.allowed_tools == frozenset({"file_read"})


def test_gateway_keeps_legacy_behavior_until_permission_flag_is_enabled(monkeypatch):
    from agent import approval_gateway as gateway_module

    settings = SimpleNamespace(
        permission_modes_enabled=False,
        approval_gateway_enabled=True,
        approval_required_tools=["file_write"],
    )
    monkeypatch.setattr(gateway_module, "get_settings", lambda: settings)

    assert gateway_module.approval_gateway.authorize(
        "file_write", "session", auto_approve=False
    ).action is AuthorizationAction.ASK
    assert gateway_module.approval_gateway.authorize(
        "file_write", "session", auto_approve=True
    ).action is AuthorizationAction.ALLOW


def test_gateway_applies_mode_and_auto_allowlist_when_enabled(monkeypatch):
    from agent import approval_gateway as gateway_module

    settings = SimpleNamespace(
        permission_modes_enabled=True,
        approval_gateway_enabled=True,
        approval_required_tools=[],
        permission_auto_allowed_tools=["file_write"],
    )
    monkeypatch.setattr(gateway_module, "get_settings", lambda: settings)

    assert gateway_module.approval_gateway.authorize(
        "file_write", "session", permission_mode=PermissionMode.READ_ONLY
    ).action is AuthorizationAction.DENY
    assert gateway_module.approval_gateway.authorize(
        "file_write", "session", permission_mode=PermissionMode.AUTO
    ).action is AuthorizationAction.ALLOW
    assert gateway_module.approval_gateway.authorize(
        "shell_exec", "session", permission_mode=PermissionMode.AUTO
    ).action is AuthorizationAction.ASK


import pytest
try:
    import agent.delegation_scope
except ImportError:
    pytest.skip("agent.delegation_scope module removed — OMP replaces it", allow_module_level=True)
try:
    import agent.permission_policy
except ImportError:
    pytest.skip("agent.permission_policy module removed — OMP replaces it", allow_module_level=True)
