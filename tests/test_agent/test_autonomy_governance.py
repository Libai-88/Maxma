"""Tests for the user-governed autonomy schedule state machine."""
from __future__ import annotations

import json

import pytest

from agent.autonomy.governance import (
    AutonomyScheduleStore,
    GovernanceError,
    SCOUT_ALLOWED_TOOLS,
)


def test_scout_scope_is_frozen_read_only_and_whitelisted():
    store = AutonomyScheduleStore(clock=lambda: 100.0)

    schedule = store.create_scout(
        goal="Check the project health",
        interval_seconds=60,
        requested_mode="auto",
        requested_tools={"kb_search", "file_write", "unknown_tool"},
        max_runs=2,
    )

    assert schedule.scope.permission_mode == "read_only"
    assert schedule.scope.allowed_tools == ("kb_search",)
    assert set(schedule.scope.allowed_tools) <= SCOUT_ALLOWED_TOOLS
    assert schedule.scope.max_runs == 2


def test_schedule_claim_pause_resume_delete_and_budget_stop():
    now = [10.0]
    store = AutonomyScheduleStore(clock=lambda: now[0])
    schedule = store.create_scout(goal="Inspect", interval_seconds=60, max_runs=1)

    store.pause(schedule.schedule_id)
    assert store.claim_due() == []
    store.resume(schedule.schedule_id)

    [lease] = store.claim_due()
    assert lease.scope.permission_mode == "read_only"
    assert store.get(schedule.schedule_id).runs_started == 1
    completed = store.finish(lease, status="succeeded", tokens_used=1)
    assert completed.status == "budget_exhausted"
    assert store.claim_due(now=1000.0) == []

    store.delete(schedule.schedule_id)
    assert store.get(schedule.schedule_id).status == "deleted"
    with pytest.raises(GovernanceError, match="cannot be resumed"):
        store.resume(schedule.schedule_id)


def test_duplicate_or_stale_lease_cannot_finish_twice():
    store = AutonomyScheduleStore(clock=lambda: 10.0)
    schedule = store.create_scout(goal="Inspect", interval_seconds=60, max_runs=2)
    [lease] = store.claim_due()
    store.finish(lease, status="cancelled")

    with pytest.raises(GovernanceError, match="stale"):
        store.finish(lease, status="succeeded")

    assert store.get(schedule.schedule_id).runs_started == 1


def test_file_store_restores_budget_and_never_persists_lease(tmp_path):
    path = tmp_path / "autonomy-schedules.json"
    store = AutonomyScheduleStore(path, clock=lambda: 10.0)
    schedule = store.create_scout(goal="Inspect", interval_seconds=60, max_runs=2)
    [lease] = store.claim_due()

    # A process restart preserves the reserved run (safe missed work) but does
    # not resume an uncertain active lease.
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["schedules"][0]["active_lease_id"] == lease.lease_id
    restored = AutonomyScheduleStore(path, clock=lambda: 20.0)
    assert restored.claim_due() == []
    assert restored.get(schedule.schedule_id).runs_started == 1
    assert restored.get(schedule.schedule_id).status == "paused"


def test_bad_schedule_and_invalid_mode_fail_before_write(tmp_path):
    path = tmp_path / "autonomy-schedules.json"
    store = AutonomyScheduleStore(path)
    with pytest.raises(GovernanceError, match="goal"):
        store.create_scout(goal="", interval_seconds=60)
    with pytest.raises(GovernanceError, match="at least 60"):
        store.create_scout(goal="x", interval_seconds=5)
    with pytest.raises(ValueError, match="Unsupported"):
        store.create_scout(goal="x", interval_seconds=60, requested_mode="unsafe")
    assert not path.exists()


def test_audit_failure_pauses_and_returns_no_lease():
    def broken_audit(*_args, **_kwargs):
        raise OSError("audit device full")

    store = AutonomyScheduleStore(audit=broken_audit, clock=lambda: 10.0)
    with pytest.raises(GovernanceError, match="cannot be audited"):
        store.create_scout(goal="Inspect", interval_seconds=60)
    assert store.list() == []
