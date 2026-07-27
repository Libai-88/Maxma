"""Memory API compatibility routes.

The current OMP memory implementation persists durable facts in the persona
memory YAML file.  ``/memory`` is the legacy flat API used by the Web memory
view, so it projects those persisted records into the shape that view already
understands.  The newer ``/memories*`` routes below remain unchanged for API
compatibility.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import tempfile
from collections.abc import Mapping
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import portalocker
import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app_paths import PERSONAS_DATA_DIR

logger = logging.getLogger(__name__)

router = APIRouter()

_PROJECTION_OPERATIONS_KEY = "_maxma_ltm_projection_operations"


def _memory_path(request: Request) -> Path:
    """Resolve the active durable memory file.

    ``app.state.memory_path`` makes the route usable by embedded hosts and
    tests.  ``app.state.ltm`` is retained for hosts from the pre-OMP memory
    implementation.  The normal application has neither state attribute, so
    it uses the same writable persona data directory as the rest of the app.
    """
    configured = getattr(request.app.state, "memory_path", None)
    if configured is not None:
        return Path(configured)

    ltm = getattr(request.app.state, "ltm", None)
    for attribute in ("memory_path", "_memory_path"):
        candidate = getattr(ltm, attribute, None)
        if candidate is not None:
            return Path(candidate)

    return PERSONAS_DATA_DIR / "memory.yaml"


@contextmanager
def _locked_memory_file(path: Path) -> Iterator[None]:
    """Serialize reads and writes with the memory file's sidecar lock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with portalocker.Lock(str(path) + ".lock", timeout=5):
        yield


def _load_document(path: Path) -> dict[Any, Any] | None:
    """Load a memory YAML document, returning ``None`` for invalid data."""
    if not path.exists():
        return {}
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        logger.warning("[memory] failed to read %s: %s", path, exc)
        return None

    if document is None:
        return {}
    if not isinstance(document, Mapping):
        logger.warning("[memory] invalid top-level document in %s", path)
        return None
    return dict(document)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None

    normalized = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        for format_string in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(value.strip(), format_string)
            except ValueError:
                continue
    return None


def _is_expired(value: Any) -> bool:
    parsed = _parse_datetime(value)
    if parsed is None:
        return False
    if parsed.tzinfo is None:
        return datetime.now() >= parsed
    return datetime.now(timezone.utc) >= parsed.astimezone(timezone.utc)


def _display_time(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None:
        return ""
    return str(value)


def _confidence(value: Any) -> float:
    """Return persisted confidence, or the compatibility default for YAML."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 1.0
    if not math.isfinite(float(value)):
        return 1.0
    return max(0.0, min(1.0, float(value)))


def _project_facts(document: Mapping[Any, Any]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for raw_id, raw_item in document.items():
        item_id = str(raw_id)
        if item_id.startswith("_") or not isinstance(raw_item, Mapping):
            continue

        if _is_expired(raw_item.get("expires_at")):
            continue
        content = raw_item.get("description", raw_item.get("content"))
        if not isinstance(content, str) or not content.strip():
            continue

        category = raw_item.get("theme", raw_item.get("category", "other"))
        facts.append(
            {
                "id": item_id,
                "content": content,
                "category": str(category or "other"),
                "confidence": _confidence(raw_item.get("confidence")),
                "updatedAt": _display_time(
                    raw_item.get("latest_update_time", raw_item.get("updatedAt"))
                ),
            }
        )
    return facts


def _write_document(path: Path, document: Mapping[Any, Any]) -> None:
    """Atomically replace the YAML document after a successful mutation."""
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            yaml.safe_dump(
                dict(document),
                handle,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
        temporary_name = ""
    finally:
        if temporary_name:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def _list_memories_sync(path: Path, q: str | None = None, category: str | None = None, min_confidence: float | None = None) -> list[dict[str, Any]]:
    """Synchronous critical section: read + project durable facts."""
    with _locked_memory_file(path):
        document = _load_document(path)
    if document is None:
        return []
    facts = _project_facts(document)
    if q:
        ql = q.lower()
        facts = [f for f in facts if ql in f["content"].lower()]
    if category and category != "all":
        facts = [f for f in facts if f["category"] == category]
    if min_confidence is not None:
        facts = [f for f in facts if f["confidence"] >= min_confidence]
    return facts


def _memory_stats_sync(path: Path) -> dict[str, Any]:
    """Return memory statistics: total count, by category, avg confidence."""
    with _locked_memory_file(path):
        document = _load_document(path)
    if document is None:
        return {"total": 0, "categories": {}, "avg_confidence": 0}
    facts = _project_facts(document)
    total = len(facts)
    categories: dict[str, int] = {}
    conf_sum = 0.0
    for f in facts:
        cat = f["category"]
        categories[cat] = categories.get(cat, 0) + 1
        conf_sum += f["confidence"]
    return {
        "total": total,
        "categories": categories,
        "avg_confidence": round(conf_sum / total, 2) if total > 0 else 0,
    }


@router.get("/memory")
async def list_memories(
    request: Request,
    q: str | None = None,
    category: str | None = None,
    min_confidence: float | None = None,
) -> list[dict[str, Any]]:
    """List non-expired durable facts for the Web memory view.

    Supports search (q=), category filter, and confidence filter.
    File I/O (YAML read + portalock) runs in a worker thread via
    ``asyncio.to_thread`` so the event loop stays responsive under load.
    """
    path = _memory_path(request)
    return await asyncio.to_thread(_list_memories_sync, path, q, category, min_confidence)


@router.get("/memory/stats")
async def memory_stats(request: Request) -> dict[str, Any]:
    """Return memory statistics for the capabilities dashboard."""
    path = _memory_path(request)
    return await asyncio.to_thread(_memory_stats_sync, path)


def _update_memory_sync(path: Path, memory_id: str, content: str | None, category: str | None) -> dict[str, str]:
    """Synchronous critical section: read, update, atomically write."""
    with _locked_memory_file(path):
        document = _load_document(path)
        if document is None:
            raise HTTPException(status_code=503, detail="记忆存储不可读")

        matching_key = next(
            (key for key in document if str(key) == memory_id and str(key) != _PROJECTION_OPERATIONS_KEY),
            None,
        )
        if matching_key is None:
            raise HTTPException(status_code=404, detail=f"未找到 ID 为 {memory_id} 的记忆")

        entry = document[matching_key]
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="记忆条目格式异常")

        if content is not None:
            entry["description"] = content
        if category is not None:
            entry["theme"] = category
        document[matching_key] = entry

        _write_document(path, document)

    return {"status": "updated", "id": memory_id}


def _delete_memory_sync(path: Path, memory_id: str) -> dict[str, str]:
    """Synchronous critical section: read, mutate, atomically write."""
    with _locked_memory_file(path):
        document = _load_document(path)
        if document is None:
            raise HTTPException(status_code=503, detail="记忆存储不可读")

        matching_key = next(
            (key for key in document if str(key) == memory_id and str(key) != _PROJECTION_OPERATIONS_KEY),
            None,
        )
        if matching_key is None:
            raise HTTPException(status_code=404, detail=f"未找到 ID 为 {memory_id} 的记忆")

        del document[matching_key]
        _write_document(path, document)

    return {"status": "deleted", "id": memory_id}


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str, request: Request) -> dict[str, str]:
    """Delete a durable fact and make the mutation visible to later reads.

    File I/O (YAML read/write + portalock + fsync) runs in a worker thread
    via ``asyncio.to_thread`` so the event loop stays responsive under load.
    """
    path = _memory_path(request)
    return await asyncio.to_thread(_delete_memory_sync, path, memory_id)


class UpdateMemoryBody(BaseModel):
    content: str | None = None
    category: str | None = None


@router.put("/memory/{memory_id}")
async def update_memory(memory_id: str, body: UpdateMemoryBody, request: Request) -> dict[str, str]:
    """Edit a durable fact's content and/or category.

    File I/O (YAML read/write + portalock + fsync) runs in a worker thread.
    """
    path = _memory_path(request)
    return await asyncio.to_thread(_update_memory_sync, path, memory_id, body.content, body.category)
