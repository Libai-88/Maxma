"""API 路由 — 表情包文件服务。"""

import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app_paths import BUNDLE_DIR

router = APIRouter()

STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"

# WebP MIME 类型
mimetypes.add_type("image/webp", ".webp")


@router.get("/stickers/{category}/{filename}")
async def get_sticker(category: str, filename: str):
    """提供贴纸文件访问。

    安全校验：
    - category 和 filename 只能包含字母、数字、中文、下划线、连字符和点
    - 禁止路径穿越（.. 等）
    - 文件必须在 stickers 目录内
    """
    import re

    # 安全校验：只允许合法字符
    if not re.match(r'^[\w\u4e00-\u9fff\-]+$', category):
        raise HTTPException(status_code=400, detail="非法分类名")
    if not re.match(r'^[\w\-]+\.webp$', filename):
        raise HTTPException(status_code=400, detail="非法文件名")

    # 路径穿越防护
    file_path = (STICKERS_DIR / category / filename).resolve()
    if not str(file_path).startswith(str(STICKERS_DIR.resolve())):
        raise HTTPException(status_code=403, detail="路径非法")

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="贴纸不存在")

    return FileResponse(
        file_path,
        media_type="image/webp",
        headers={"Cache-Control": "max-age=86400, immutable"},
    )


@router.get("/stickers")
async def list_stickers():
    """列出所有表情分类及数量（用于调试/管理）。"""
    from tools.sticker_utils import get_sticker_categories
    return {"categories": get_sticker_categories()}
