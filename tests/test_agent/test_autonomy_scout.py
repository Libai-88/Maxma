"""Lifecycle contracts for bounded Scout schedule execution."""
from __future__ import annotations

import asyncio

import pytest

from agent.autonomy.governance import AutonomyScheduleStore
from agent.autonomy.scout import ScoutScheduleRunner


@pytest.mark.asyncio
async def test_runner_finishes_a_read_only_lease_once():
    store = AutonomyScheduleStore(clock=lambda: 10.0)
    schedule = store.create_scout(
        goal="Inspect", interval_seconds=60, provider_id="provider", max_runs=1
    )
    called: list[str] = []

    async def execute(lease):
        called.append(lease.schedule_id)

    runner = ScoutScheduleRunner(store, execute, poll_seconds=0.01)
    runner.start()
    await asyncio.sleep(0.04)
    await runner.shutdown()

    assert called == [schedule.schedule_id]
    assert store.get(schedule.schedule_id).status == "budget_exhausted"


@pytest.mark.asyncio
async def test_shutdown_pauses_an_inflight_lease_for_explicit_recovery():
    store = AutonomyScheduleStore(clock=lambda: 10.0)
    schedule = store.create_scout(
        goal="Inspect", interval_seconds=60, provider_id="provider", max_runs=2
    )
    started = asyncio.Event()

    async def blocked(_lease):
        started.set()
        await asyncio.Event().wait()

    runner = ScoutScheduleRunner(store, blocked, poll_seconds=0.01)
    runner.start()
    await asyncio.wait_for(started.wait(), timeout=1)
    await runner.shutdown()

    restored = store.get(schedule.schedule_id)
    assert restored.status == "paused"
    assert restored.active_lease_id is None
