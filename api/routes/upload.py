"""文件上传 API — 用户上传文件供 Agent 读取和分析。"""

import os
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from app_paths import UPLOADS_DIR as UPLOAD_DIR

router = APIRouter()

# 确保上传目录存在
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# 单文件最大 20MB
MAX_FILE_SIZE = 20 * 1024 * 1024

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {
    # 文本
    ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".log",
    # 代码
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".java",
    ".c", ".cpp", ".go", ".rs", ".rb", ".sh", ".bat", ".ps1",
    ".sql", ".r", ".swift", ".kt",
    # 文档
    ".pdf", ".docx", ".xlsx", ".pptx",
    # 图片
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传文件供 Agent 读取和分析。

    返回文件 ID 和路径，Agent 可通过 file_read 工具读取。
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")

    # 检查扩展名
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {ext}。支持的类型: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # 读取文件内容
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大（{len(content)} 字节），最大允许 {MAX_FILE_SIZE // 1024 // 1024}MB",
        )

    # 生成唯一文件名
    file_id = uuid.uuid4().hex[:8]
    safe_name = f"{file_id}_{file.filename}"
    file_path = UPLOAD_DIR / safe_name

    # 写入文件
    file_path.write_bytes(content)

    # 记录上传元数据（用于自动清理）
    meta_path = UPLOAD_DIR / f"{file_id}.meta"
    meta_path.write_text(
        f"original_name={file.filename}\n"
        f"size={len(content)}\n"
        f"uploaded_at={time.time()}\n",
        encoding="utf-8",
    )

    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(content),
        "path": f"local:{file_path}",
        "message": f"文件已上传，Agent 可通过路径 local:{file_path} 读取",
    }


@router.get("/uploads")
async def list_uploads():
    """列出所有已上传的文件。"""
    files = []
    for meta_file in sorted(UPLOAD_DIR.glob("*.meta")):
        file_id = meta_file.stem
        meta = {}
        for line in meta_file.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, _, val = line.partition("=")
                meta[key.strip()] = val.strip()

        # 找到对应的实际文件
        original_name = meta.get("original_name", "")
        actual_file = UPLOAD_DIR / f"{file_id}_{original_name}"
        if actual_file.exists():
            files.append({
                "file_id": file_id,
                "filename": original_name,
                "size": int(meta.get("size", 0)),
                "uploaded_at": float(meta.get("uploaded_at", 0)),
                "path": f"local:{actual_file}",
            })

    return {"files": files, "count": len(files)}


@router.delete("/uploads/{file_id}")
async def delete_upload(file_id: str):
    """删除已上传的文件。"""
    deleted = False
    # 删除元数据文件以找到原始文件名
    meta_path = UPLOAD_DIR / f"{file_id}.meta"
    if meta_path.exists():
        meta = {}
        for line in meta_path.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, _, val = line.partition("=")
                meta[key.strip()] = val.strip()
        original_name = meta.get("original_name", "")
        actual_file = UPLOAD_DIR / f"{file_id}_{original_name}"
        if actual_file.exists():
            actual_file.unlink()
            deleted = True
        meta_path.unlink()
    else:
        # 尝试直接删除
        for f in UPLOAD_DIR.glob(f"{file_id}_*"):
            f.unlink()
            deleted = True

    if not deleted:
        raise HTTPException(status_code=404, detail=f"文件 {file_id} 不存在")

    return {"deleted": True, "file_id": file_id}
