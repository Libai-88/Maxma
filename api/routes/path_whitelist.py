"""REST API — 路径白名单 (path_whitelist.yaml) CRUD。"""

import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import PATH_WHITELIST_YAML_PATH
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock

router = APIRouter()

WHITELIST_PATH = PATH_WHITELIST_YAML_PATH


class WhitelistEntry(BaseModel):
    path: str
    description: str = ""
    recursive: bool = True


class WhitelistResponse(BaseModel):
    entries: list[WhitelistEntry]


def _load() -> list[dict]:
    if not WHITELIST_PATH.exists():
        return []
    raw = load_yaml(WHITELIST_PATH, default={}) or {}
    entries = raw.get("whitelist", []) or []
    for e in entries:
        if isinstance(e, dict) and "recursive" not in e:
            e["recursive"] = True
    return entries


def _save(entries: list[dict]) -> None:
    dump_yaml_atomic(WHITELIST_PATH, {"whitelist": entries})


@router.get("/path-whitelist", response_model=WhitelistResponse)
async def list_whitelist():
    with yaml_file_lock(WHITELIST_PATH):
        entries = _load()
    return WhitelistResponse(entries=[WhitelistEntry(**e) for e in entries])


@router.post("/path-whitelist", response_model=WhitelistEntry)
async def add_whitelist(entry: WhitelistEntry):
    with yaml_file_lock(WHITELIST_PATH):
        entries = _load()
        data = entry.model_dump()
        data["path"] = os.path.normpath(data["path"])
        entries.append(data)
        _save(entries)
    return WhitelistEntry(**data)


@router.put("/path-whitelist/{index}", response_model=WhitelistEntry)
async def update_whitelist(index: int, entry: WhitelistEntry):
    with yaml_file_lock(WHITELIST_PATH):
        entries = _load()
        if index < 0 or index >= len(entries):
            raise HTTPException(status_code=404, detail=f"索引 {index} 超出范围")
        data = entry.model_dump()
        data["path"] = os.path.normpath(data["path"])
        entries[index] = data
        _save(entries)
    return WhitelistEntry(**data)


@router.delete("/path-whitelist/{index}")
async def delete_whitelist(index: int):
    with yaml_file_lock(WHITELIST_PATH):
        entries = _load()
        if index < 0 or index >= len(entries):
            raise HTTPException(status_code=404, detail=f"索引 {index} 超出范围")
        removed = entries.pop(index)
        _save(entries)
    return {"status": "ok", "removed": removed}


# ── 路径安全检查（供前端气泡标红使用） ──


@router.get("/check-path-blocked")
async def check_path_blocked(path: str = Query(..., description="要检查的路径")):
    """检查路径是否被拒止锚或白名单阻挡。

    返回:
        - ``blocked``: 是否被阻挡
        - ``reason``: 阻挡原因（仅 blocked=True 时有值）
        - ``blocker_path``: 拒止锚所在目录（仅拒止锚阻挡时有值）
    """
    from api.pi_bridge.security_adapter import _find_blocker_path, check_path_access

    # 先检查白名单
    blocked_reason = check_path_access(path)
    if blocked_reason:
        return {
            "blocked": True,
            "reason": blocked_reason,
            "blocker_path": None,
        }

    # 再检查 MaxmaBlocker
    blocker_path = _find_blocker_path(path)
    if blocker_path is not None:
        return {
            "blocked": True,
            "reason": f"路径包含 MaxmaBlocker 拒止锚: {blocker_path}",
            "blocker_path": blocker_path,
        }

    return {
        "blocked": False,
        "reason": None,
        "blocker_path": None,
    }
