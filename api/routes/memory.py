"""REST API — 长期记忆叙事。"""

import random

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from memory.memory_manager import MAX_DESC_LENGTH, MemoryManager

router = APIRouter()


@router.get("/narrative")
async def get_narrative(request: Request):
    ltm = request.app.state.ltm
    return {"narrative": ltm.get_narrative()}


@router.get("/memories")
async def get_memories(request: Request):
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))
    return mm.get_memories_grouped()


class UpdateMemoryBody(BaseModel):
    content: str
    section: str


@router.put("/memories/{memory_id}")
async def update_memory(memory_id: str, body: UpdateMemoryBody, request: Request):
    """更新指定记忆条目。"""
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))

    content = body.content.replace("\n", " ").replace("\r", " ").strip()
    if not content:
        raise HTTPException(status_code=400, detail="内容不能为空")
    if len(content) > MAX_DESC_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字）",
        )
    if not body.section.strip():
        raise HTTPException(status_code=400, detail="分区不能为空")

    try:
        mm.update(memory_id, reason="用户通过前端编辑", new_description=content, new_theme=body.section.strip())
    except ValueError:
        raise HTTPException(status_code=404, detail=f"未找到 ID 为 {memory_id} 的记忆条目")

    from memory.narrative import invalidate_narrative_cache
    invalidate_narrative_cache()

    return {"status": "updated"}


@router.get("/moment")
async def get_moment(request: Request):
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))
    items = mm.show()
    if not items:
        return {"moment": None}
    chosen = random.choice(items)
    history = mm.show_description_history(chosen["id"])
    return {
        "moment": {
            "id": chosen["id"],
            "description": chosen["description"],
            "theme": chosen["theme"],
            "history": history,
        }
    }
