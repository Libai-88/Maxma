"""API 路由 — 事件钩子 CRUD + webhook 触发。"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agent.hooks import get_hook_manager

router = APIRouter()


# ── 请求体模型 ────────────────────────────────────────────

class HookCreateBody(BaseModel):
    name: str = Field(..., description="钩子名称")
    hook_type: str = Field(..., description="钩子类型: file_change / schedule / webhook")
    config: dict = Field(default_factory=dict, description="类型相关配置")
    action: str = Field(..., description="Agent 动作提示词")


class HookUpdateBody(BaseModel):
    name: str | None = None
    config: dict | None = None
    action: str | None = None
    enabled: bool | None = None
    status: str | None = None


# ── 端点 ──────────────────────────────────────────────────

@router.get("/event-hooks")
def list_hooks():
    """列出所有钩子。"""
    mgr = get_hook_manager()
    return {"hooks": mgr.list_hooks()}


@router.get("/event-hooks/{hook_id}")
def get_hook(hook_id: str):
    """获取单个钩子详情。"""
    mgr = get_hook_manager()
    hook = mgr.get_hook(hook_id)
    if not hook:
        raise HTTPException(status_code=404, detail="钩子不存在")
    return hook.to_dict()


@router.post("/event-hooks")
def create_hook(body: HookCreateBody):
    """创建新钩子。"""
    mgr = get_hook_manager()

    # 校验类型
    valid_types = ("file_change", "schedule", "webhook")
    if body.hook_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"hook_type 必须是 {valid_types} 之一")

    hook = mgr.create_hook(
        name=body.name,
        hook_type=body.hook_type,
        config=body.config,
        action=body.action,
    )
    return {"status": "created", "hook": hook.to_dict()}


@router.put("/event-hooks/{hook_id}")
def update_hook(hook_id: str, body: HookUpdateBody):
    """更新钩子配置。"""
    mgr = get_hook_manager()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    hook = mgr.update_hook(hook_id, **updates)
    if not hook:
        raise HTTPException(status_code=404, detail="钩子不存在")
    return {"status": "updated", "hook": hook.to_dict()}


@router.delete("/event-hooks/{hook_id}")
def delete_hook(hook_id: str):
    """删除钩子。"""
    mgr = get_hook_manager()
    if not mgr.delete_hook(hook_id):
        raise HTTPException(status_code=404, detail="钩子不存在")
    return {"status": "deleted"}


@router.get("/event-hooks/history")
def get_history(limit: int = 50):
    """获取触发历史。"""
    mgr = get_hook_manager()
    return {"history": mgr.get_history(limit)}


@router.post("/event-hooks/{hook_id}/trigger")
def trigger_webhook(hook_id: str, payload: str = ""):
    """通过 webhook 触发钩子。"""
    mgr = get_hook_manager()
    if not mgr.trigger_webhook(hook_id, payload):
        raise HTTPException(status_code=404, detail="钩子不存在或不是 webhook 类型")
    return {"status": "triggered"}
