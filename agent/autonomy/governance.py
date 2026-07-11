"""Durable, fail-closed governance for scheduled autonomous work.

This module deliberately contains no agent execution.  It owns the small,
auditable state machine that an execution adapter must satisfy before a
background run can start:

* a user-created goal and an immutable permission/provider/budget snapshot;
* explicit pause, resume, and delete operations;
* one lease per due occurrence, so a restart or a second worker cannot run a
  schedule twice; and
* a conservative stop when either a budget is exhausted or an audit write
  cannot be made.

The initial role is read-only ``scout``.  Delivery remains a separate,
interactive action: this store never grants it a background capability.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Literal

from agent.permission_policy import PermissionMode, narrow_permission_mode, parse_permission_mode

ScheduleStatus = Literal["active", "paused", "deleted", "budget_exhausted"]

# A role is a capability ceiling, not a request for permission.  Execution
# adapters must still apply the normal permission policy, path checks, MCP
# restrictions, and sandbox.
SCOUT_ALLOWED_TOOLS = frozenset({
    "file_read", "file_list", "list_files", "project_info", "git_status",
    "git_diff", "kb_search", "list_memories", "system_diagnose",
    "rag_diagnose", "web_fetch",
})


class GovernanceError(ValueError):
    """A caller attempted to create or change an unsafe schedule."""


@dataclass(frozen=True)
class AutonomyScope:
    """Immutable execution snapshot captured when the user creates a goal."""

    permission_mode: str
    allowed_tools: tuple[str, ...]
    provider_id: str | None = None
    model_name: str | None = None
    max_runs: int = 1
    max_tokens: int = 0
    max_seconds: int = 300

    def __post_init__(self) -> None:
        if self.max_runs < 1:
            raise GovernanceError("max_runs must be at least one")
        if self.max_tokens < 0:
            raise GovernanceError("max_tokens cannot be negative")
        if self.max_seconds < 1:
            raise GovernanceError("max_seconds must be positive")


@dataclass
class AutonomySchedule:
    """Persisted schedule state.  Goal text is never copied into audit events."""

    schedule_id: str
    goal: str
    role: str
    interval_seconds: int
    scope: AutonomyScope
    status: ScheduleStatus = "active"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    next_run_at: float = field(default_factory=time.time)
    runs_started: int = 0
    tokens_used: int = 0
    seconds_used: float = 0.0
    active_lease_id: str | None = None

    def is_due(self, now: float) -> bool:
        return (
            self.status == "active"
            and self.active_lease_id is None
            and self.next_run_at <= now
        )

    def budget_remaining(self) -> bool:
        if self.runs_started >= self.scope.max_runs:
            return False
        if self.scope.max_tokens and self.tokens_used >= self.scope.max_tokens:
            return False
        return self.seconds_used < self.scope.max_seconds


@dataclass(frozen=True)
class AutonomyLease:
    """A single-use lease supplied to the background executor."""

    lease_id: str
    schedule_id: str
    goal: str
    role: str
    scope: AutonomyScope


def _as_schedule(payload: dict) -> AutonomySchedule:
    payload = dict(payload)
    scope = dict(payload["scope"])
    scope["allowed_tools"] = tuple(scope.get("allowed_tools", ()))
    payload["scope"] = AutonomyScope(**scope)
    return AutonomySchedule(**payload)


class AutonomyScheduleStore:
    """Thread-safe JSON store for user-created autonomous schedules.

    The file is optional so unit tests and embedded callers can use memory
    only.  When configured, writes use ``os.replace`` so an interrupted write
    retains a complete prior document.  A malformed file fails closed: no
    schedules are loaded and callers must explicitly create a new one.
    """

    def __init__(
        self,
        path: Path | str | None = None,
        *,
        audit: Callable[..., None] | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._path = Path(path) if path is not None else None
        self._audit = audit
        self._clock = clock
        self._lock = threading.RLock()
        self._schedules: dict[str, AutonomySchedule] = {}
        if self._path is not None:
            self._load()

    def _load(self) -> None:
        if self._path is None or not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            schedules = raw.get("schedules", [])
            self._schedules = {item["schedule_id"]: _as_schedule(item) for item in schedules}
            # A persisted lease means the prior process died after reserving a
            # run.  Never replay it automatically: pause for an explicit user
            # decision and preserve the consumed run budget.
            for schedule in self._schedules.values():
                if schedule.active_lease_id is not None:
                    schedule.active_lease_id = None
                    schedule.status = "paused"
        except (OSError, ValueError, TypeError, KeyError) as exc:
            # Do not guess at corrupted state or resume a possibly unbounded
            # background job.  The caller can surface this as a repair action.
            self._schedules = {}
            raise GovernanceError("unable to load autonomy schedule store") from exc

    def _save(self) -> None:
        if self._path is None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_suffix(self._path.suffix + ".tmp")
        data = {"version": 1, "schedules": [asdict(x) for x in self._schedules.values()]}
        try:
            temporary.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            os.replace(temporary, self._path)
        finally:
            if temporary.exists():
                temporary.unlink(missing_ok=True)

    def _audit_event(self, lifecycle: str, schedule: AutonomySchedule, *, status: str = "ok") -> None:
        """Write a content-free audit event or fail closed before execution."""
        if self._audit is None:
            return
        self._audit(
            "autonomy_schedule",
            target=f"autonomy/{schedule.schedule_id}",
            detail=lifecycle,
            status=status,
            extra={
                "schedule_id": schedule.schedule_id,
                "role": schedule.role,
                "permission_mode": schedule.scope.permission_mode,
            },
        )

    @staticmethod
    def _scout_scope(
        requested_mode: PermissionMode | str | None,
        requested_tools: set[str] | frozenset[str] | None,
        *,
        provider_id: str | None,
        model_name: str | None,
        max_runs: int,
        max_tokens: int,
        max_seconds: int,
    ) -> AutonomyScope:
        # Scout is never more permissive than read-only, even if a stale UI
        # asks for auto.  Unknown tools are removed rather than classified at
        # runtime by an autonomous process.
        mode = narrow_permission_mode(PermissionMode.READ_ONLY, requested_mode)
        tools = SCOUT_ALLOWED_TOOLS.intersection(requested_tools or SCOUT_ALLOWED_TOOLS)
        return AutonomyScope(
            permission_mode=mode.value,
            allowed_tools=tuple(sorted(tools)),
            provider_id=provider_id,
            model_name=model_name,
            max_runs=max_runs,
            max_tokens=max_tokens,
            max_seconds=max_seconds,
        )

    def create_scout(
        self,
        *,
        goal: str,
        interval_seconds: int,
        requested_mode: PermissionMode | str | None = PermissionMode.READ_ONLY,
        requested_tools: set[str] | frozenset[str] | None = None,
        provider_id: str | None = None,
        model_name: str | None = None,
        max_runs: int = 1,
        max_tokens: int = 0,
        max_seconds: int = 300,
    ) -> AutonomySchedule:
        """Create an opt-in read-only Scout schedule with a frozen scope."""
        if not goal or not goal.strip():
            raise GovernanceError("goal is required")
        if interval_seconds < 60:
            raise GovernanceError("interval_seconds must be at least 60")
        # Ensure invalid parent values fail before an unsafe record exists.
        parse_permission_mode(requested_mode)
        scope = self._scout_scope(
            requested_mode,
            requested_tools,
            provider_id=provider_id,
            model_name=model_name,
            max_runs=max_runs,
            max_tokens=max_tokens,
            max_seconds=max_seconds,
        )
        now = self._clock()
        schedule = AutonomySchedule(
            schedule_id=f"auto-{uuid.uuid4().hex}",
            goal=goal.strip(),
            role="scout",
            interval_seconds=interval_seconds,
            scope=scope,
            created_at=now,
            updated_at=now,
            next_run_at=now,
        )
        with self._lock:
            self._schedules[schedule.schedule_id] = schedule
            self._save()
            try:
                self._audit_event("created", schedule)
            except Exception as exc:
                self._schedules.pop(schedule.schedule_id, None)
                self._save()
                raise GovernanceError("autonomy schedule cannot be audited") from exc
        return schedule

    def get(self, schedule_id: str) -> AutonomySchedule | None:
        with self._lock:
            return self._schedules.get(schedule_id)

    def list(self, *, include_deleted: bool = False) -> list[AutonomySchedule]:
        with self._lock:
            rows = list(self._schedules.values())
            if not include_deleted:
                rows = [row for row in rows if row.status != "deleted"]
            return sorted(rows, key=lambda row: row.created_at)

    def pause(self, schedule_id: str) -> AutonomySchedule:
        return self._set_status(schedule_id, "paused", "paused")

    def resume(self, schedule_id: str) -> AutonomySchedule:
        with self._lock:
            schedule = self._require(schedule_id)
            if schedule.status == "deleted":
                raise GovernanceError("deleted schedules cannot be resumed")
            if not schedule.budget_remaining():
                schedule.status = "budget_exhausted"
                self._save()
                raise GovernanceError("schedule budget is exhausted")
            schedule.status = "active"
            schedule.active_lease_id = None
            schedule.next_run_at = self._clock()
            schedule.updated_at = self._clock()
            self._save()
            self._audit_event("resumed", schedule)
            return schedule

    def delete(self, schedule_id: str) -> AutonomySchedule:
        return self._set_status(schedule_id, "deleted", "deleted")

    def pause_active_leases(self) -> int:
        """Fail closed during process shutdown without replaying in-flight work.

        A task which was reserved but not conclusively completed may have made
        an external read request already.  Pausing it is safer than trying to
        infer whether it can be replayed after a restart.
        """
        changed = 0
        with self._lock:
            for schedule in self._schedules.values():
                if schedule.active_lease_id is None:
                    continue
                schedule.active_lease_id = None
                schedule.status = "paused"
                schedule.updated_at = self._clock()
                self._audit_event("paused_for_restart", schedule, status="blocked")
                changed += 1
            if changed:
                self._save()
        return changed

    def _set_status(self, schedule_id: str, status: ScheduleStatus, lifecycle: str) -> AutonomySchedule:
        with self._lock:
            schedule = self._require(schedule_id)
            schedule.status = status
            schedule.active_lease_id = None
            schedule.updated_at = self._clock()
            self._save()
            self._audit_event(lifecycle, schedule)
            return schedule

    def _require(self, schedule_id: str) -> AutonomySchedule:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise GovernanceError("unknown autonomy schedule")
        return schedule

    def claim_due(self, *, now: float | None = None) -> list[AutonomyLease]:
        """Reserve due jobs, consuming one run budget before execution.

        Reserving before execution intentionally favours a safe missed run over
        duplicate delivery after a crash.  The next occurrence is calculated
        from ``now``; missed intervals never produce a catch-up burst.
        """
        now = self._clock() if now is None else now
        leases: list[AutonomyLease] = []
        with self._lock:
            for schedule in self._schedules.values():
                if not schedule.is_due(now):
                    continue
                if not schedule.budget_remaining():
                    schedule.status = "budget_exhausted"
                    schedule.updated_at = now
                    self._audit_event("budget_exhausted", schedule, status="blocked")
                    continue
                lease_id = f"lease-{uuid.uuid4().hex}"
                schedule.active_lease_id = lease_id
                schedule.runs_started += 1
                schedule.updated_at = now
                schedule.next_run_at = now + schedule.interval_seconds
                try:
                    self._audit_event("run_claimed", schedule)
                except Exception:
                    schedule.active_lease_id = None
                    schedule.status = "paused"
                    continue
                leases.append(AutonomyLease(
                    lease_id=lease_id,
                    schedule_id=schedule.schedule_id,
                    goal=schedule.goal,
                    role=schedule.role,
                    scope=schedule.scope,
                ))
            self._save()
        return leases

    def finish(
        self,
        lease: AutonomyLease,
        *,
        status: Literal["succeeded", "failed", "cancelled", "blocked"],
        tokens_used: int = 0,
        seconds_used: float = 0.0,
    ) -> AutonomySchedule:
        """Close a lease once.  A stale or cancelled lease cannot mutate state."""
        if tokens_used < 0 or seconds_used < 0:
            raise GovernanceError("usage must be non-negative")
        with self._lock:
            schedule = self._require(lease.schedule_id)
            if schedule.active_lease_id != lease.lease_id:
                raise GovernanceError("stale or unknown autonomy lease")
            schedule.active_lease_id = None
            schedule.tokens_used += tokens_used
            schedule.seconds_used += seconds_used
            schedule.updated_at = self._clock()
            if not schedule.budget_remaining():
                schedule.status = "budget_exhausted"
            self._save()
            self._audit_event(f"run_{status}", schedule, status=status)
            return schedule
