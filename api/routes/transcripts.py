"""Transcript 读取 REST 端点 — 后台运行抄本的查看入口。"""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from api.transcript.jsonl_writer import TranscriptWriter
from app_paths import DATA_DIR

logger = logging.getLogger(__name__)

router = APIRouter()

# 允许的 transcript 类别（路径穿越防护）
_ALLOWED_CATEGORIES = frozenset({"autonomy", "hooks", "manual"})


@router.get("/transcripts")
async def list_transcripts(request: Request):
    """列出所有 transcript 文件，按类别分组。"""
    transcripts_root = DATA_DIR / "transcripts"
    result: dict[str, list] = {}
    if not transcripts_root.exists():
        return {"categories": result}

    for category_dir in transcripts_root.iterdir():
        if not category_dir.is_dir():
            continue
        if category_dir.name not in _ALLOWED_CATEGORIES:
            continue
        files = []
        for f in sorted(category_dir.glob("*.jsonl"), reverse=True):
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size": stat.st_size,
                "modified_at": stat.st_mtime,
            })
        result[category_dir.name] = files

    return {"categories": result}


@router.get("/transcripts/{category}/{filename}")
async def read_transcript(category: str, filename: str, request: Request):
    """读取单个 transcript 文件内容。"""
    if category not in _ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")

    # 路径穿越防护
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    transcript_path = DATA_DIR / "transcripts" / category / filename
    if not transcript_path.exists():
        raise HTTPException(status_code=404, detail="Transcript not found")

    messages = TranscriptWriter.read_messages(transcript_path)
    return {"messages": messages, "filename": filename, "category": category}
