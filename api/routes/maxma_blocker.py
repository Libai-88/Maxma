"""REST API — MaxmaBlocker（拒止锚）管理。

在目标目录中创建/删除 MaxmaBlocker 标记文件，
并持久化跟踪列表到 maxma_blocker.yaml。"""

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app_paths import MAXMA_BLOCKER_YAML_PATH

router = APIRouter()

YAML_PATH = MAXMA_BLOCKER_YAML_PATH

# 拒止锚标记文件名 — 必须与 api/pi_bridge/security_adapter.py 中
# _find_blocker_path 查找的文件名保持一致，否则 API 创建的标记不会被
# 安全适配器发现，导致拒止锚失效（安全绕过）。
BLOCKER_FILENAME = ".maxma_blocker"
# 旧版（pre-fix）曾使用 "MaxmaBlocker" 作为标记文件名，导致与
# security_adapter 的 ".maxma_blocker" 约定不一致。_remove_marker 仍会
# 清理旧版文件以保持向后兼容，避免遗留孤儿标记无法删除。
_LEGACY_BLOCKER_FILENAMES = ("MaxmaBlocker",)


class BlockerEntry(BaseModel):
    path: str
    description: str = ""


class BlockerResponse(BaseModel):
    entries: list[BlockerEntry]


def _load() -> list[dict]:
    if not YAML_PATH.exists():
        return []
    with open(YAML_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return raw.get("blockers", []) or []


def _save(entries: list[dict]) -> None:
    YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(YAML_PATH, "w", encoding="utf-8") as f:
        yaml.dump(
            {"blockers": entries}, f, allow_unicode=True, default_flow_style=False
        )


def _create_marker(dir_path: str) -> None:
    """在目标目录中创建 .maxma_blocker 标记文件。"""
    marker = Path(dir_path) / BLOCKER_FILENAME
    if not marker.exists():
        marker.write_text("", encoding="utf-8")


def _remove_marker(dir_path: str) -> None:
    """移除目标目录中的 .maxma_blocker 标记文件（忽略扩展名）。

    同时清理旧版 MaxmaBlocker 标记文件以保持向后兼容。
    """
    target = Path(dir_path)
    if not target.is_dir():
        return
    valid_names = {BLOCKER_FILENAME.lower(), *(
        n.lower() for n in _LEGACY_BLOCKER_FILENAMES
    )}
    for item in target.iterdir():
        name, _ = os.path.splitext(item.name)
        if name.lower() in valid_names:
            item.unlink()
            return


@router.get("/maxma-blocker", response_model=BlockerResponse)
async def list_blockers():
    entries = _load()
    return BlockerResponse(entries=[BlockerEntry(**e) for e in entries])


@router.post("/maxma-blocker", response_model=BlockerEntry, status_code=201)
async def add_blocker(entry: BlockerEntry):
    if not entry.path or not Path(entry.path).is_dir():
        raise HTTPException(status_code=400, detail="无效目录路径")
    _create_marker(entry.path)
    entries = _load()
    entries.append(entry.model_dump())
    _save(entries)
    return entry


@router.delete("/maxma-blocker/{index}")
async def delete_blocker(index: int):
    entries = _load()
    if index < 0 or index >= len(entries):
        raise HTTPException(status_code=404, detail=f"索引 {index} 超出范围")
    removed = entries.pop(index)
    _remove_marker(removed["path"])
    _save(entries)
    return {"status": "ok", "removed": removed}
