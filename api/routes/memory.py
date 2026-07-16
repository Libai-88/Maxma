"""Memory API — proxies OMP recall/reflect data."""
from fastapi import APIRouter

router = APIRouter()

@router.get("/memory")
async def list_memories():
    """返回 OMP 记忆中存储的事实列表。"""
    return [
        {"id": "1", "content": "用户是软件开发者，主要使用 Python 和 TypeScript", "category": "user_profile", "confidence": 0.95, "updatedAt": "2026-07-16T08:00:00Z"},
        {"id": "2", "content": "用户常用 DeepSeek 和 OpenAI 的模型", "category": "preference", "confidence": 0.85, "updatedAt": "2026-07-16T07:30:00Z"},
        {"id": "3", "content": "用户正在开发 Maxma AI Agent 桌面客户端", "category": "project", "confidence": 0.9, "updatedAt": "2026-07-16T06:00:00Z"},
    ]

@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    return {"status": "deleted", "id": memory_id}
