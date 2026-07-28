"""Automation API — 定时任务/自动化管理。

暴露 OMP 后端的 cron/timer/automation 能力。
当前为 stub 实现（内存存储），待 sidecar 支持后替换为真实调度。
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateAutomationRequest(BaseModel):
    name: str
    schedule: str  # cron expression or interval
    action: str  # what to do
    enabled: bool = True


class UpdateAutomationRequest(BaseModel):
    name: str | None = None
    schedule: str | None = None
    action: str | None = None
    enabled: bool | None = None


# 内存存储
_automations: dict[str, dict[str, Any]] = {}


@router.get("/automations")
async def list_automations(request: Request):
    """列出所有自动化任务。"""
    return {"automations": list(_automations.values()), "total": len(_automations)}


@router.post("/automations")
async def create_automation(body: CreateAutomationRequest, request: Request):
    """创建自动化任务。"""
    automation_id = secrets.token_urlsafe(12)
    now = datetime.now(timezone.utc)
    automation = {
        "id": automation_id,
        "name": body.name,
        "schedule": body.schedule,
        "action": body.action,
        "enabled": body.enabled,
        "created_at": now.isoformat(),
        "last_run": None,
        "next_run": None,
        "run_count": 0,
    }
    _automations[automation_id] = automation
    return automation


@router.put("/automations/{automation_id}")
async def update_automation(automation_id: str, body: UpdateAutomationRequest, request: Request):
    """更新自动化任务。"""
    if automation_id not in _automations:
        raise HTTPException(status_code=404, detail="Automation not found")
    automation = _automations[automation_id]
    if body.name is not None:
        automation["name"] = body.name
    if body.schedule is not None:
        automation["schedule"] = body.schedule
    if body.action is not None:
        automation["action"] = body.action
    if body.enabled is not None:
        automation["enabled"] = body.enabled
    return automation


@router.delete("/automations/{automation_id}")
async def delete_automation(automation_id: str, request: Request):
    """删除自动化任务。"""
    if automation_id not in _automations:
        raise HTTPException(status_code=404, detail="Automation not found")
    del _automations[automation_id]
    return {"ok": True}
