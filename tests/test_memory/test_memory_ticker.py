"""Focused tests for the resumable, default-off memory ticker."""
import asyncio

from memory.memory_ticker import MemoryTicker, MemoryTickerItem


def _item(source_id="turn-1", source_version="v1"):
    return MemoryTickerItem(
        day="2026-07-10",
        session_id="session-a",
        persona_id="persona-a",
        source_id=source_id,
        source_version=source_version,
    )


def test_disabled_ticker_does_not_call_compiler_or_write_state(tmp_path):
    ticker = MemoryTicker(state_file=tmp_path / "ticker.json")
    called = []

    report = asyncio.run(ticker.run([_item()], lambda *_args: called.append(True)))

    assert report.enabled is False
    assert report.processed == 0
    assert called == []
    assert not (tmp_path / "ticker.json").exists()


def test_ticker_resumes_without_replaying_completed_input(tmp_path):
    state_file = tmp_path / "ticker.json"
    calls = []

    ticker = MemoryTicker(state_file=state_file, enabled=True)
    first = asyncio.run(ticker.run([_item()], lambda item, key: calls.append((item.source_id, key))))
    resumed = MemoryTicker(state_file=state_file, enabled=True)
    second = asyncio.run(resumed.run([_item()], lambda item, key: calls.append((item.source_id, key))))

    assert first.processed == 1
    assert second.skipped == 1
    assert len(calls) == 1


def test_changed_source_version_is_new_idempotent_input(tmp_path):
    ticker = MemoryTicker(state_file=tmp_path / "ticker.json", enabled=True)
    calls = []

    asyncio.run(ticker.run([_item("turn-1", "v1")], lambda item, key: calls.append(key)))
    report = asyncio.run(ticker.run([_item("turn-1", "v2")], lambda item, key: calls.append(key)))

    assert report.processed == 1
    assert len(calls) == 2
    assert calls[0] != calls[1]


def test_ticker_failure_is_resumable_and_shadow_does_not_checkpoint(tmp_path):
    state_file = tmp_path / "ticker.json"
    ticker = MemoryTicker(state_file=state_file, enabled=True)

    def failing(_item, _key):
        raise RuntimeError("compiler unavailable")

    failed = asyncio.run(ticker.run([_item()], failing))
    calls = []
    resumed = MemoryTicker(state_file=state_file, enabled=True)
    recovered = asyncio.run(resumed.run([_item()], lambda item, key: calls.append(key)))
    shadow = asyncio.run(resumed.run([_item("turn-2")], lambda item, key: calls.append(key), shadow=True))
    replay_shadow = asyncio.run(resumed.run([_item("turn-2")], lambda item, key: calls.append(key)))

    assert failed.failed == 1
    assert recovered.processed == 1
    assert shadow.processed == 1
    assert replay_shadow.processed == 1


def test_ticker_checkpoint_omits_source_payload(tmp_path):
    state_file = tmp_path / "ticker.json"
    ticker = MemoryTicker(state_file=state_file, enabled=True)
    sensitive = MemoryTickerItem(
        day="2026-07-10", session_id="session-a", persona_id="persona-a",
        source_id="turn-1", source_version="v1", payload="Authorization: not-for-state",
    )

    asyncio.run(ticker.run([sensitive], lambda *_args: None))

    assert "not-for-state" not in state_file.read_text(encoding="utf-8")
