"""REST API — 长期记忆叙事（memory/ 包已移除，此功能不可用）。"""

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


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
