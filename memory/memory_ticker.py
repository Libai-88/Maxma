"""Default-off, resumable daily memory ticker foundation.

The ticker deliberately owns only scheduling state.  A compiler receives a
stable idempotency key and owns its projection transaction (for example,
``FactStore.add(..., idempotency_key=key)``).  This makes a crash between a
projection commit and ticker checkpoint safe: replay is at-least-once, while
the projection remains idempotent.
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import os
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

TICKER_STATE_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class MemoryTickerItem:
    """One immutable projection input; payload is never persisted by ticker."""

    day: str
    session_id: str
    persona_id: str
    source_id: str
    source_version: str
    payload: Any = None

    @property
    def idempotency_key(self) -> str:
        raw = "\x1f".join((
            self.day, self.session_id, self.persona_id,
            self.source_id, self.source_version,
        ))
        return "memory-ticker:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @property
    def fingerprint(self) -> str:
        """Fingerprint of stable identity only; raw turn content remains private."""
        return hashlib.sha256(self.idempotency_key.encode("ascii")).hexdigest()


@dataclass
class MemoryTickerCheckpoint:
    schema_version: int = TICKER_STATE_SCHEMA_VERSION
    completed: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class MemoryTickerReport:
    enabled: bool
    shadow: bool
    processed: int
    skipped: int
    failed: int


Compiler = Callable[[MemoryTickerItem, str], Any | Awaitable[Any]]


class MemoryTicker:
    """Run incrementally ordered daily compilation with crash-safe checkpoints."""

    def __init__(self, *, state_file: str | Path, enabled: bool | None = None) -> None:
        self._state_file = Path(state_file)
        if enabled is None:
            try:
                from config.settings import get_settings

                enabled = get_settings().memory_ticker_enabled
            except Exception:
                enabled = False
        self._enabled = bool(enabled)
        self._state = self._load()

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _load(self) -> MemoryTickerCheckpoint:
        if not self._state_file.exists():
            return MemoryTickerCheckpoint()
        try:
            raw = json.loads(self._state_file.read_text(encoding="utf-8"))
            if raw.get("schema_version") != TICKER_STATE_SCHEMA_VERSION:
                logger.warning("memory ticker state schema mismatch; preserving file and starting empty")
                return MemoryTickerCheckpoint()
            completed = raw.get("completed", {})
            return MemoryTickerCheckpoint(completed=completed if isinstance(completed, dict) else {})
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("memory ticker state unreadable; preserving file and starting empty: %s", exc)
            return MemoryTickerCheckpoint()

    def _save(self) -> None:
        """Atomically persist only checkpoint metadata, never conversation payloads."""
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(asdict(self._state), ensure_ascii=False, sort_keys=True, indent=2)
        fd, temp_name = tempfile.mkstemp(prefix=self._state_file.name + ".", suffix=".tmp", dir=self._state_file.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_name, self._state_file)
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass

    def is_completed(self, item: MemoryTickerItem) -> bool:
        entry = self._state.completed.get(item.idempotency_key)
        return bool(entry and entry.get("fingerprint") == item.fingerprint)

    async def run(
        self,
        items: list[MemoryTickerItem],
        compiler: Compiler,
        *,
        shadow: bool = False,
    ) -> MemoryTickerReport:
        """Compile new inputs in deterministic order.

        Disabled mode is a no-op.  Shadow mode calls the compiler but does not
        write a checkpoint, allowing callers to compare projections before
        enabling the ticker.  ``compiler`` must accept the idempotency key.
        """
        if not self._enabled:
            return MemoryTickerReport(False, shadow, 0, len(items), 0)

        processed = skipped = failed = 0
        ordered = sorted(items, key=lambda item: (
            item.day, item.persona_id, item.session_id,
            item.source_id, item.source_version,
        ))
        for item in ordered:
            if self.is_completed(item):
                skipped += 1
                continue
            try:
                outcome = compiler(item, item.idempotency_key)
                if inspect.isawaitable(outcome):
                    await outcome
            except asyncio.CancelledError:
                raise
            except Exception:
                failed += 1
                logger.exception("memory ticker compilation failed for %s", item.idempotency_key)
                continue

            processed += 1
            if not shadow:
                self._state.completed[item.idempotency_key] = {
                    "fingerprint": item.fingerprint,
                    "completed_at": time.time(),
                }
                # Checkpoint after every successful projection so the next
                # process restart only replays at most the current item.
                self._save()

        return MemoryTickerReport(True, shadow, processed, skipped, failed)
