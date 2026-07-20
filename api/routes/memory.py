"""Memory API — proxies OMP recall/reflect data.

B-006: previously this module returned three hardcoded demo entries and the
DELETE endpoint silently returned ``{"status": "deleted"}`` without any
persistence. The frontend (web/src/stores/memory.ts) gracefully handles
non-OK responses (clears facts, swallows delete errors), so returning 501
Not Implemented here is safer than continuing to surface fabricated data.
Real OMP recall/reflect integration is tracked separately; until that lands
the UI will show an empty memory list.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_NOT_IMPLEMENTED_DETAIL = "OMP memory integration not implemented — endpoint is a stub."


@router.get("/memory")
async def list_memories():
    """返回 OMP 记忆中存储的事实列表。

    B-006: returns 501 Not Implemented rather than fabricated demo data so the
    frontend surfaces an honest "no memories" state instead of misleading
    hardcoded entries.
    """
    return JSONResponse(
        status_code=501,
        content={"detail": _NOT_IMPLEMENTED_DETAIL},
    )


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: str):
    """删除指定记忆。

    B-006: returns 501 Not Implemented. The previous implementation silently
    returned ``{"status": "deleted", "id": memory_id}`` without performing any
    persistence — leaving the user believing their delete took effect.
    """
    return JSONResponse(
        status_code=501,
        content={"detail": _NOT_IMPLEMENTED_DETAIL, "id": memory_id},
    )
