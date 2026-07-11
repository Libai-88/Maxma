"""The closed registry for deterministic workflow definitions.

Workflow requests select a definition by ID; they never carry executable
steps, code, URLs, tool arguments, or a user-controlled recovery policy.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any


WorkflowHandler = Callable[["WorkflowExecutionContext"], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class WorkflowExecutionContext:
    run_id: str
    parent_session_id: str
    parent_turn_id: str | None
    workflow_id: str
    step_id: str


@dataclass(frozen=True)
class RegisteredWorkflowStep:
    """A statically registered, side-effect-free step.

    ``safe_to_resume`` is explicit instead of inferred from a handler.  A
    future write-capable step must set it false until it has a durable,
    idempotent side-effect boundary of its own.
    """

    id: str
    handler: WorkflowHandler
    safe_to_resume: bool = True


@dataclass(frozen=True)
class RegisteredWorkflow:
    id: str
    version: int
    steps: tuple[RegisteredWorkflowStep, ...]

    def __post_init__(self) -> None:
        if not self.id or not self.steps:
            raise ValueError("a registered workflow needs an ID and at least one step")
        step_ids = [step.id for step in self.steps]
        if any(not step_id for step_id in step_ids) or len(step_ids) != len(set(step_ids)):
            raise ValueError("workflow step IDs must be non-empty and unique")


class WorkflowRegistry:
    """Closed lookup table for workflow definitions."""

    def __init__(self, definitions: Iterable[RegisteredWorkflow] = ()) -> None:
        definitions = tuple(definitions)
        self._definitions = {definition.id: definition for definition in definitions}
        if len(self._definitions) != len(definitions):
            raise ValueError("workflow IDs must be unique")

    def get(self, workflow_id: str) -> RegisteredWorkflow | None:
        return self._definitions.get(workflow_id)

    def require(self, workflow_id: str) -> RegisteredWorkflow:
        definition = self.get(workflow_id)
        if definition is None:
            raise KeyError(workflow_id)
        return definition

    def list_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._definitions))


async def _capture_session_checkpoint(context: WorkflowExecutionContext) -> dict[str, Any]:
    """A read-only registered agent placeholder with no external effects."""
    return {"checkpoint": "session_context_captured", "workflow": context.workflow_id}


async def _prepare_review(context: WorkflowExecutionContext) -> dict[str, Any]:
    """Prepare a deterministic work item without exposing session content."""
    return {"checkpoint": "review_prepared", "workflow": context.workflow_id}


DEFAULT_WORKFLOW_REGISTRY = WorkflowRegistry(
    (
        RegisteredWorkflow(
            id="session-review",
            version=1,
            steps=(
                RegisteredWorkflowStep("capture-session-context", _capture_session_checkpoint),
                RegisteredWorkflowStep("prepare-review", _prepare_review),
            ),
        ),
    )
)
