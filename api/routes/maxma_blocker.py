"""REST API — MaxmaBlocker（拒止锚）管理。

在目标目录中创建/删除 MaxmaBlocker 标记文件，
并持久化跟踪列表到 maxma_blocker.yaml。"""

import logging
import os
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import MAXMA_BLOCKER_YAML_PATH

logger = logging.getLogger(__name__)

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


def _find_blocker_path(path: str) -> str | None:
    """查找路径或其父目录中的 .maxma_blocker 标记，返回拒止锚所在目录。

    路径解析失败时返回 path 本身（fail-closed：视为存在 blocker），
    与安全适配器保持一致的失败闭合语义，避免解析异常导致安全绕过。

    Returns:
        拒止锚所在目录的字符串路径，或 None（未发现 blocker）。
    """
    # NUL 字节是路径注入向量，显式拒绝（不依赖 resolve 的平台相关行为）
    if "\x00" in path:
        logger.warning("[security] 路径包含 NUL 字节（fail-closed）: %r", path)
        return str(path)
    try:
        p = Path(path).resolve(strict=False)
    except (OSError, ValueError) as exc:
        logger.warning("[security] 路径解析失败（fail-closed）%s: %s", path, exc)
        return str(path)
    for parent in [p, *p.parents]:
        if (parent / BLOCKER_FILENAME).exists():
            logger.warning("[security] MaxmaBlocker found at %s", parent)
            return str(parent)
    return None


@router.get("/check-path-blocked")
async def check_path_blocked(path: str = Query(..., description="要检查的路径")):
    """检查路径是否被 MaxmaBlocker 拒止锚阻挡（供前端附件气泡标红）。

    向上遍历目标路径及其所有父目录查找 .maxma_blocker 标记文件。

    Returns:
        - ``blocked``: 是否被阻挡
        - ``reason``: 阻挡原因（仅 blocked=True 时有值）
        - ``blocker_path``: 拒止锚所在目录（仅 blocked=True 时有值）
    """
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
