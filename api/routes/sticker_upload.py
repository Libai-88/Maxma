"""API 路由 — 自定义表情上传。"""

import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from app_paths import BUNDLE_DIR, DATA_DIR

router = APIRouter()

# 内置表情库（只读）
BUILTIN_STICKERS_DIR = BUNDLE_DIR / "config" / "stickers"
# 自定义表情库（可写）
CUSTOM_STICKERS_DIR = DATA_DIR / "config" / "stickers" / "custom"

ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


class UploadResponse(BaseModel):
    success: bool
    path: str
    filename: str
    message: str = ""


def _convert_to_webp(src: Path, dst: Path) -> bool:
    """将图片转换为 WebP 格式。支持静态图和动图。"""
    try:
        from PIL import Image, ImageOps, ImageSequence

        if src.suffix.lower() == '.gif':
            # 动图：提取所有帧，转换为动画 WebP
            frames = []
            durations = []
            img = Image.open(src)
            for frame in ImageSequence.Iterator(img):
                frame = frame.convert('RGBA')
                frame.thumbnail((256, 256), Image.LANCZOS)
                frames.append(frame)
                dur = frame.info.get('duration', 100)
                durations.append(max(dur, 50))

            if frames:
                frames[0].save(
                    str(dst), 'WEBP',
                    save_all=True, append_images=frames[1:],
                    duration=durations, loop=0, quality=80,
                )
                return True
        else:
            # 静态图
            img = Image.open(src)
            img = ImageOps.exif_transpose(img)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGBA')
            else:
                img = img.convert('RGB')
            img.thumbnail((256, 256), Image.LANCZOS)
            img.save(str(dst), 'WEBP', quality=80)
            return True
    except Exception as e:
        print(f"[sticker_upload] 转换失败: {e}")
        return False


@router.post("/stickers/upload", response_model=UploadResponse)
async def upload_sticker(file: UploadFile = File(...)):
    """上传自定义表情。

    接受 PNG/JPG/GIF/WebP，自动转换为 WebP 并保存到自定义表情目录。
    """
    # 验证文件类型
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少文件名")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}，仅支持 {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # 读取文件内容
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"文件过大，最大 {MAX_FILE_SIZE // 1024 // 1024}MB")

    # 生成唯一文件名（基于内容哈希）
    file_hash = hashlib.md5(content).hexdigest()[:16]
    webp_filename = f"custom_{file_hash}.webp"

    # 确保目录存在
    CUSTOM_STICKERS_DIR.mkdir(parents=True, exist_ok=True)
    dst_path = CUSTOM_STICKERS_DIR / webp_filename

    # 如果已存在相同哈希的文件，直接返回
    if dst_path.exists():
        return UploadResponse(
            success=True,
            path=f"custom/{webp_filename}",
            filename=webp_filename,
            message="文件已存在（重复上传）"
        )

    # 写入临时文件并转换
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        if not _convert_to_webp(tmp_path, dst_path):
            dst_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="图片转换失败")
    finally:
        tmp_path.unlink(missing_ok=True)

    return UploadResponse(
        success=True,
        path=f"custom/{webp_filename}",
        filename=webp_filename,
        message="上传成功"
    )


@router.get("/stickers/custom")
async def list_custom_stickers():
    """获取自定义表情列表。"""
    stickers = []
    if CUSTOM_STICKERS_DIR.exists():
        for f in sorted(CUSTOM_STICKERS_DIR.glob("*.webp")):
            stickers.append({
                'category': 'custom',
                'filename': f.name,
                'path': f"custom/{f.name}",
            })
    return {"stickers": stickers}


@router.delete("/stickers/custom/{filename}")
async def delete_custom_sticker(filename: str):
    """删除自定义表情。"""
    if not re.match(r'^custom_[\w]+\.webp$', filename):
        raise HTTPException(status_code=400, detail="非法文件名")

    file_path = CUSTOM_STICKERS_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="表情不存在")

    file_path.unlink()
    return {"success": True, "message": "已删除"}
