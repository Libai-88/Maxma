"""Memory API compatibility routes.

The current OMP memory implementation persists durable facts in the persona
memory YAML file.  ``/memory`` is the legacy flat API used by the Web memory
view, so it projects those persisted records into the shape that view already
understands.  The newer ``/memories*`` routes below remain unchanged for API
compatibility.
"""

from __future__ import annotations

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


@router.get("/memory")
async def list_memories(request: Request) -> list[dict[str, Any]]:
    """List non-expired durable facts for the legacy Web memory view."""
    path = _memory_path(request)
    with _locked_memory_file(path):
        document = _load_document(path)
    if document is None:
        return []
    return _project_facts(document)


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str, request: Request) -> dict[str, str]:
    """Delete a durable fact and make the mutation visible to later reads."""
    path = _memory_path(request)
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


# The /memories* endpoints are retained as compatibility stubs.  The active
# OMP recall/reflect/retain implementation owns those operations.
@router.get("/narrative")
async def get_narrative(request: Request):
    """获取叙事记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.get("/memories")
async def get_memories(request: Request, include_expired: bool = False):
    """返回分组记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.get("/memories/expired")
async def list_expired_memories(request: Request):
    """列出已过期条目（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, request: Request):
    """更新指定记忆条目（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.post("/memories/purge")
async def purge_expired_memories(request: Request):
    """手动触发清理已过期条目（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.get("/moment")
async def get_moment(request: Request):
    """随机回忆一条记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")


@router.get("/memories/episodic")
async def list_episodic_memories(request: Request, include_expired: bool = False):
    """列出情景记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="情景记忆功能不可用（memory/ 包已移除）")


@router.post("/memories/episodic")
async def add_episodic_memory(request: Request):
    """手动添加情景记忆条目（不可用）。"""
    raise HTTPException(status_code=503, detail="情景记忆功能不可用（memory/ 包已移除）")


@router.delete("/memories/episodic/{episode_id}")
async def delete_episodic_memory(episode_id: str, request: Request):
    """删除指定情景记忆条目（不可用）。"""
    raise HTTPException(status_code=503, detail="情景记忆功能不可用（memory/ 包已移除）")


@router.get("/memories/semantic")
async def list_semantic_memories(request: Request, include_expired: bool = False):
    """列出语义记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="语义记忆功能不可用（memory/ 包已移除）")


@router.post("/memories/semantic")
async def add_semantic_memory(request: Request):
    """手动添加语义记忆条目（不可用）。"""
    raise HTTPException(status_code=503, detail="语义记忆功能不可用（memory/ 包已移除）")


@router.delete("/memories/semantic/{fact_id}")
async def delete_semantic_memory(fact_id: str, request: Request):
    """删除指定语义记忆条目（不可用）。"""
    raise HTTPException(status_code=503, detail="语义记忆功能不可用（memory/ 包已移除）")


@router.post("/memories/search")
async def search_memories_across_layers(request: Request):
    """跨层向量检索记忆（不可用）。"""
    raise HTTPException(status_code=503, detail="记忆功能不可用（memory/ 包已移除）")
