"""Workflow API — 工作流定义与运行管理。

当前为 stub 实现：返回空列表，消除前端 404。
待工作流引擎就绪后替换为真实逻辑。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class StartWorkflowRequest(BaseModel):
    workflow_id: str
    parent_turn_id: str | None = None


@router.get("/workflows/definitions")
async def list_workflow_definitions(request: Request):
    """列出所有可用的工作流定义 ID。"""
    return {"workflow_ids": []}


@router.get("/sessions/{session_id}/workflows")
async def list_workflow_runs(session_id: str, request: Request):
    """列出会话的所有工作流运行。"""
    return {"runs": []}


@router.post("/sessions/{session_id}/workflows")
async def start_workflow(session_id: str, body: StartWorkflowRequest, request: Request):
    """启动一个工作流运行。"""
    raise HTTPException(status_code=501, detail="Workflow engine not yet available")


@router.get("/sessions/{session_id}/workflows/{run_id}")
async def get_workflow_run(session_id: str, run_id: str, request: Request):
    """获取工作流运行详情。"""
    raise HTTPException(status_code=404, detail="Workflow run not found")


@router.post("/sessions/{session_id}/workflows/{run_id}/cancel")
async def cancel_workflow_run(session_id: str, run_id: str, request: Request):
    """取消工作流运行。"""
    raise HTTPException(status_code=404, detail="Workflow run not found")


@router.post("/sessions/{session_id}/workflows/{run_id}/resume")
async def resume_workflow_run(session_id: str, run_id: str, request: Request):
    """恢复工作流运行。"""
    raise HTTPException(status_code=404, detail="Workflow run not found")
