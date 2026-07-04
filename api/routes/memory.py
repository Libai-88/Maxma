"""REST API — 长期记忆叙事。"""

import random
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from memory.memory_manager import MAX_DESC_LENGTH, MemoryManager

router = APIRouter()


@router.get("/narrative")
async def get_narrative(request: Request):
    ltm = request.app.state.ltm
    return {"narrative": ltm.get_narrative()}


@router.get("/memories")
async def get_memories(request: Request, include_expired: bool = False):
    """返回分组记忆。include_expired=true 时包含已过期但未清理的条目。"""
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))
    return mm.get_memories_grouped(include_expired=include_expired)


@router.get("/memories/expired")
async def list_expired_memories(request: Request):
    """列出已过期但尚未清理的记忆条目。"""
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))
    return {"items": mm.list_expired()}


class UpdateMemoryBody(BaseModel):
    content: str
    section: str
    ttl: Optional[int] = None  # None=保留原过期时间；0=改为永久；>0=重置


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
        mm.update(
            memory_id,
            reason="用户通过前端编辑",
            new_description=content,
            new_theme=body.section.strip(),
            new_ttl=body.ttl,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail=f"未找到 ID 为 {memory_id} 的记忆条目")

    from memory.narrative import invalidate_narrative_cache
    invalidate_narrative_cache()

    return {"status": "updated"}


@router.post("/memories/purge")
async def purge_expired_memories(request: Request):
    """手动触发清理已过期记忆条目。"""
    ltm = request.app.state.ltm
    mm = MemoryManager(yaml_file=str(ltm._memory_path))
    purged = mm.purge_expired()
    if purged > 0:
        from memory.narrative import invalidate_narrative_cache
        invalidate_narrative_cache()
    return {"purged": purged}


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


# ── 4 层记忆：情景 / 语义 / 跨层检索 ──


@router.get("/memories/episodic")
async def list_episodic_memories(request: Request, include_expired: bool = False):
    """列出情景记忆（对话快照）。"""
    episodic_mm = getattr(request.app.state, "episodic_mm", None)
    if episodic_mm is None:
        return {"items": []}
    return {"items": episodic_mm.list_episodes(include_expired=include_expired)}


class AddEpisodeBody(BaseModel):
    summary: str
    session_id: str = ""
    turn_id: str = ""
    message_count: int = 0
    ttl: Optional[int] = None


@router.post("/memories/episodic")
async def add_episodic_memory(body: AddEpisodeBody, request: Request):
    """手动添加情景记忆条目。"""
    episodic_mm = getattr(request.app.state, "episodic_mm", None)
    if episodic_mm is None:
        raise HTTPException(status_code=503, detail="情景记忆未初始化")
    new_id = episodic_mm.add_episode(
        summary=body.summary,
        session_id=body.session_id,
        turn_id=body.turn_id,
        message_count=body.message_count,
        ttl=body.ttl,
    )
    return {"id": new_id}


@router.delete("/memories/episodic/{episode_id}")
async def delete_episodic_memory(episode_id: str, request: Request):
    """删除指定情景记忆条目。"""
    episodic_mm = getattr(request.app.state, "episodic_mm", None)
    if episodic_mm is None:
        raise HTTPException(status_code=503, detail="情景记忆未初始化")
    try:
        removed = episodic_mm.delete_episode(episode_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"未找到 ID 为 {episode_id} 的情景记忆")
    return {"removed": removed}


@router.get("/memories/semantic")
async def list_semantic_memories(request: Request, include_expired: bool = False):
    """列出语义记忆（事实三元组）。"""
    semantic_mm = getattr(request.app.state, "semantic_mm", None)
    if semantic_mm is None:
        return {"items": []}
    return {"items": semantic_mm.list_facts(include_expired=include_expired)}


class AddFactBody(BaseModel):
    subject: str
    predicate: str
    object: str
    source: str = "manual"
    ttl: Optional[int] = None


@router.post("/memories/semantic")
async def add_semantic_memory(body: AddFactBody, request: Request):
    """手动添加语义记忆条目。"""
    semantic_mm = getattr(request.app.state, "semantic_mm", None)
    if semantic_mm is None:
        raise HTTPException(status_code=503, detail="语义记忆未初始化")
    new_id = semantic_mm.add_fact(
        subject=body.subject,
        predicate=body.predicate,
        obj=body.object,
        source=body.source,
        ttl=body.ttl,
    )
    # 4 层架构：语义记忆变更后失效系统提示词缓存（含语义记忆段）
    from agent.prompts import invalidate_prompt_cache
    invalidate_prompt_cache()
    return {"id": new_id}


@router.delete("/memories/semantic/{fact_id}")
async def delete_semantic_memory(fact_id: str, request: Request):
    """删除指定语义记忆条目。"""
    semantic_mm = getattr(request.app.state, "semantic_mm", None)
    if semantic_mm is None:
        raise HTTPException(status_code=503, detail="语义记忆未初始化")
    try:
        removed = semantic_mm.delete_fact(fact_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"未找到 ID 为 {fact_id} 的语义记忆")
    # 4 层架构：语义记忆变更后失效系统提示词缓存
    from agent.prompts import invalidate_prompt_cache
    invalidate_prompt_cache()
    return {"removed": removed}


class SearchBody(BaseModel):
    query: str
    layers: Optional[list[str]] = None  # 默认 ["long", "episodic", "semantic"]
    top_k: int = 5
    threshold: float = 0.6


@router.post("/memories/search")
async def search_memories_across_layers(body: SearchBody, request: Request):
    """跨层向量检索记忆（长期/情景/语义）。"""
    coordinator = getattr(request.app.state, "memory_coordinator", None)
    if coordinator is None:
        raise HTTPException(status_code=503, detail="记忆协调器未初始化")
    results = coordinator.retrieve(
        query=body.query,
        layers=body.layers,
        top_k=body.top_k,
        threshold=body.threshold,
    )
    return {"results": results}
