"""Immutable execution context for delegated sub-agent work.

The context deliberately lives next to the delegation tools rather than in the
websocket route.  This keeps the background execution path self-contained and
makes a nested delegated call inherit the same provider, permissions and
deadline instead of rediscovering global defaults.
"""
from __future__ import annotations

import contextvars
import math
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import ConfigDict

from tools.base import ToolBase, format_error

DEFAULT_MAX_TOKENS = 8_000
DEFAULT_TIME_LIMIT_SECONDS = 180
DEFAULT_FALLBACK_RESERVE_SECONDS = 45
_PATH_ARGUMENT_NAMES = frozenset({"file_path", "repo_path", "directory", "path", "folder_path"})


@dataclass(frozen=True)
class DelegationContext:
    """The capabilities and runtime identity inherited by one sub-agent.

    ``model`` is intentionally an object reference rather than a provider
    configuration.  A delegated run therefore cannot silently switch models
    because a global provider setting changed while it was waiting to start.
    """

    model: Any = field(default=None, repr=False, compare=False)
    provider_id: str = ""
    model_name: str = ""
    allowed_tools: frozenset[str] = field(default_factory=frozenset)
    allowed_paths: frozenset[str] = field(default_factory=frozenset)
    max_tokens: int = DEFAULT_MAX_TOKENS
    time_limit_seconds: int = DEFAULT_TIME_LIMIT_SECONDS
    trace_id: str = ""
    parent_turn_id: str | None = None
    deadline_monotonic: float = 0.0
    enforce_scope: bool = False
    auto_approve: bool = False

    def remaining_seconds(self) -> float:
        """Return the shared deadline remainder (zero means expired)."""
        if self.deadline_monotonic <= 0:
            return float(max(self.time_limit_seconds, 0))
        return max(0.0, self.deadline_monotonic - time.monotonic())

    def timeout_seconds(self) -> int:
        return max(0, math.ceil(self.remaining_seconds()))

    def frontend_wait_seconds(self, maximum_seconds: float) -> float:
        """Limit connection wait time so an unconnected child can still run.

        All parallel children share one deadline.  Waiting for the full
        remainder would leave their background fallback no execution time.
        Reserve up to 45 seconds (or a quarter of a short deadline) for that
        fallback without extending the parent deadline.
        """
        remaining = self.remaining_seconds()
        reserve = min(
            DEFAULT_FALLBACK_RESERVE_SECONDS,
            max(1.0, remaining * 0.25),
        )
        return max(0.0, min(float(maximum_seconds), remaining - reserve))


_active_context: contextvars.ContextVar[DelegationContext | None] = contextvars.ContextVar(
    "active_delegation_context", default=None
)


def current_delegation_context() -> DelegationContext | None:
    return _active_context.get()


def activate_delegation_context(context: DelegationContext):
    """Set *context* for nested async work and return its reset token."""
    return _active_context.set(context)


def reset_delegation_context(token) -> None:
    _active_context.reset(token)


def create_delegation_context(
    app_state,
    parent_turn_id: str | None,
    *,
    model: Any = None,
    provider_id: str | None = None,
    model_name: str | None = None,
    auto_approve: bool = False,
) -> DelegationContext:
    """Capture the parent's model, permissions and shared deadline once.

    When a sub-agent invokes another sub-agent, the ContextVar preserves the
    original model/trace/deadline and can only narrow the available tools.
    """
    inherited = current_delegation_context()
    available_tools = tuple(getattr(tool, "name", "") for tool in getattr(app_state, "tools", ()) if getattr(tool, "name", ""))
    paths = _whitelisted_paths()
    enforce_scope = _scope_enforced()

    if inherited is not None:
        return DelegationContext(
            model=inherited.model,
            provider_id=inherited.provider_id,
            model_name=inherited.model_name,
            allowed_tools=frozenset(name for name in available_tools if name in inherited.allowed_tools),
            allowed_paths=inherited.allowed_paths,
            max_tokens=inherited.max_tokens,
            time_limit_seconds=inherited.time_limit_seconds,
            trace_id=inherited.trace_id,
            parent_turn_id=parent_turn_id or inherited.parent_turn_id,
            deadline_monotonic=inherited.deadline_monotonic,
            enforce_scope=inherited.enforce_scope,
            auto_approve=inherited.auto_approve,
        )

    selected_model = model if model is not None else getattr(app_state, "llm", None)
    selected_model_name = model_name or _model_name(selected_model)
    return DelegationContext(
        model=selected_model,
        provider_id=provider_id
        or _provider_id(getattr(app_state, "provider_manager", None), selected_model_name),
        model_name=selected_model_name,
        allowed_tools=frozenset(available_tools),
        allowed_paths=frozenset(paths),
        trace_id=uuid.uuid4().hex,
        parent_turn_id=parent_turn_id,
        deadline_monotonic=time.monotonic() + DEFAULT_TIME_LIMIT_SECONDS,
        enforce_scope=enforce_scope,
        auto_approve=bool(auto_approve),
    )


def prepare_delegated_tools(tools: list[BaseTool], context: DelegationContext) -> list[BaseTool]:
    """Apply the context at the tool invocation boundary.

    Filtering controls what the model can select.  ``ScopedTool`` also checks
    path-bearing arguments immediately before delegating, so a file tool that
    is selected cannot escape this child context's path capability.
    """
    if not context.enforce_scope:
        return list(tools)
    result: list[BaseTool] = []
    for tool in tools:
        if tool.name not in context.allowed_tools:
            continue
        result.append(ScopedTool.wrap(tool, context))
    return result


def bind_model_budget(context: DelegationContext):
    """Bind the inherited model to the child output-token cap when supported."""
    model = context.model
    if model is None or context.max_tokens <= 0:
        return model
    try:
        return model.bind(max_tokens=context.max_tokens)
    except Exception:
        # Providers without LangChain's bind contract still receive the shared
        # deadline and recursion limit; do not replace their model implicitly.
        return model


class ScopedTool(ToolBase):
    """A non-mutating runtime guard around a child-visible tool."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    inner: BaseTool
    context: DelegationContext
    name: str
    description: str
    args_schema: type | None = None

    @classmethod
    def wrap(cls, tool: BaseTool, context: DelegationContext) -> "ScopedTool":
        return cls(
            inner=tool,
            context=context,
            name=tool.name,
            description=tool.description or "",
            args_schema=getattr(tool, "args_schema", None),
        )

    def _run(self, **kwargs) -> Any:
        error = self._validate_paths(kwargs)
        if error:
            return format_error(error)
        return self.inner.invoke(kwargs)

    async def _arun(self, **kwargs) -> Any:
        error = self._validate_paths(kwargs)
        if error:
            return format_error(error)
        return await self.inner.ainvoke(kwargs)

    def _validate_paths(self, arguments: dict[str, Any]) -> str | None:
        for name, value in arguments.items():
            if name not in _PATH_ARGUMENT_NAMES or not isinstance(value, str) or not value.strip():
                continue
            if not _is_path_allowed(value, self.context.allowed_paths):
                return f"子 Agent 无权访问路径: {value}"
        return None


def _is_path_allowed(candidate: str, allowed_paths: frozenset[str]) -> bool:
    if not allowed_paths:
        return False
    try:
        target = Path(candidate).expanduser().resolve(strict=False)
        for allowed in allowed_paths:
            root = Path(allowed).expanduser().resolve(strict=False)
            if os.path.commonpath((str(target), str(root))) == str(root):
                return True
    except (OSError, ValueError):
        return False
    return False


def _whitelisted_paths() -> list[str]:
    try:
        from tools.path_security import get_whitelisted_paths
        return list(get_whitelisted_paths())
    except Exception:
        return []


def _scope_enforced() -> bool:
    try:
        from config.settings import get_settings
        return bool(get_settings().delegation_scope_enforced)
    except Exception:
        return False


def _model_name(model: Any) -> str:
    for attribute in ("model_name", "model"):
        value = getattr(model, attribute, None)
        if isinstance(value, str) and value:
            return value
    return ""


def _provider_id(manager: Any, model_name: str) -> str:
    if manager is None:
        return ""
    try:
        for provider in manager.iter_enabled():
            if not model_name or getattr(provider, "default_model", "") == model_name:
                return str(getattr(getattr(provider, "config", None), "id", ""))
    except Exception:
        pass
    return ""
