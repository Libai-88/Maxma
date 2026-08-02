"""Workflow API — 工作流定义与运行管理。

基于 YAML 定义 + 后台执行引擎，通过 WebSocket 推送实时进度。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app_paths import PROJECT_ROOT
from api.ws_protocol import WsEventType

logger = logging.getLogger(__name__)

router = APIRouter()

# ── 工作流定义 ──

WORKFLOWS_DIR = os.path.join(PROJECT_ROOT, "workflows")


def _ensure_workflows_dir() -> str:
    os.makedirs(WORKFLOWS_DIR, exist_ok=True)
    return WORKFLOWS_DIR


def _load_workflow_definitions() -> dict[str, dict]:
    """加载 workflows/ 目录下所有 YAML 定义文件。"""
    definitions: dict[str, dict] = {}
    wf_dir = _ensure_workflows_dir()
    if not os.path.isdir(wf_dir):
        return definitions
    for fname in os.listdir(wf_dir):
        if fname.endswith((".yaml", ".yml")):
            fpath = os.path.join(wf_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if isinstance(data, dict) and data.get("name"):
                    wf_id = os.path.splitext(fname)[0]
                    definitions[wf_id] = data
            except Exception as e:
                logger.warning("[workflow] Failed to load %s: %s", fname, e)
    return definitions


# ── 工作流运行时 ──

class WorkflowRunState:
    """单个工作流运行的状态。"""

    def __init__(
        self,
        run_id: str,
        workflow_id: str,
        workflow_def: dict,
        parent_turn_id: str | None = None,
    ):
        self.run_id = run_id
        self.workflow_id = workflow_id
        self.workflow_version = workflow_def.get("version", 1)
        self.status: str = "queued"
        self.parent_turn_id = parent_turn_id
        self.current_step_id: str | None = None
        self.failure_code: str | None = None
        self.cancel_reason: str | None = None
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.steps = [
            {
                "step_id": s.get("step_id", f"step_{i}"),
                "position": i,
                "status": "queued",
                "attempts": 0,
                "checkpoint": None,
            }
            for i, s in enumerate(workflow_def.get("steps", []))
        ]
        self._workflow_def = workflow_def
        self._cancel_event = asyncio.Event()

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "parent_turn_id": self.parent_turn_id,
            "workflow_id": self.workflow_id,
            "workflow_version": self.workflow_version,
            "status": self.status,
            "current_step_id": self.current_step_id,
            "failure_code": self.failure_code,
            "cancel_reason": self.cancel_reason,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "steps": self.steps,
        }

    def mark_step_running(self, step_index: int) -> None:
        if 0 <= step_index < len(self.steps):
            self.steps[step_index]["status"] = "running"
            self.steps[step_index]["attempts"] += 1
            self.current_step_id = self.steps[step_index]["step_id"]
            self.updated_at = time.time()

    def mark_step_done(self, step_index: int) -> None:
        if 0 <= step_index < len(self.steps):
            self.steps[step_index]["status"] = "succeeded"
            self.updated_at = time.time()

    def mark_step_failed(self, step_index: int, error: str) -> None:
        if 0 <= step_index < len(self.steps):
            self.steps[step_index]["status"] = "failed"
            self.failure_code = error
            self.updated_at = time.time()


# 模块级运行存储（线程安全）
_runs_lock = threading.RLock()
_runs: dict[str, WorkflowRunState] = {}


# ── API 端点 ──

class StartWorkflowRequest(BaseModel):
    workflow_id: str
    parent_turn_id: str | None = None


@router.get("/workflows/definitions")
async def list_workflow_definitions(request: Request):
    """列出所有可用的工作流定义。"""
    definitions = _load_workflow_definitions()
    return {
        "workflow_ids": list(definitions.keys()),
        "definitions": {
            wf_id: {
                "name": wf.get("name", wf_id),
                "description": wf.get("description", ""),
                "step_count": len(wf.get("steps", [])),
            }
            for wf_id, wf in definitions.items()
        },
    }


@router.get("/sessions/{session_id}/workflows")
async def list_workflow_runs(session_id: str, request: Request):
    """列出会话的所有工作流运行。"""
    with _runs_lock:
        session_runs = [
            run.to_dict()
            for run in _runs.values()
            if run.parent_turn_id and run.parent_turn_id.startswith(session_id[:8])
        ]
    return {"runs": session_runs}


@router.post("/sessions/{session_id}/workflows")
async def start_workflow(session_id: str, body: StartWorkflowRequest, request: Request):
    """启动一个工作流运行。"""
    definitions = _load_workflow_definitions()
    wf_def = definitions.get(body.workflow_id)
    if not wf_def:
        raise HTTPException(status_code=404, detail=f"Workflow definition '{body.workflow_id}' not found")

    steps = wf_def.get("steps", [])
    if not steps:
        raise HTTPException(status_code=400, detail="Workflow has no steps")

    run_id = uuid.uuid4().hex
    run = WorkflowRunState(
        run_id=run_id,
        workflow_id=body.workflow_id,
        workflow_def=wf_def,
        parent_turn_id=body.parent_turn_id,
    )
    run.status = "running"

    with _runs_lock:
        _runs[run_id] = run

    # 后台执行
    asyncio.create_task(_execute_workflow(
        run_id=run_id,
        session_id=session_id,
        request=request,
    ))

    logger.info("[workflow] Started run %s for workflow '%s' (session=%s)", run_id[:8], body.workflow_id, session_id[:8])
    return {"run_id": run_id, "status": run.status}


@router.get("/sessions/{session_id}/workflows/{run_id}")
async def get_workflow_run(session_id: str, run_id: str, request: Request):
    """获取工作流运行详情。"""
    with _runs_lock:
        run = _runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    return run.to_dict()


@router.post("/sessions/{session_id}/workflows/{run_id}/cancel")
async def cancel_workflow_run(session_id: str, run_id: str, request: Request):
    """取消工作流运行。"""
    with _runs_lock:
        run = _runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status in ("succeeded", "failed", "cancelled"):
        raise HTTPException(status_code=400, detail=f"Workflow already {run.status}")

    run.status = "cancelled"
    run.cancel_reason = "cancelled_by_user"
    run.updated_at = time.time()
    run._cancel_event.set()

    logger.info("[workflow] Cancelled run %s", run_id[:8])
    return {"run_id": run_id, "status": run.status}


@router.post("/sessions/{session_id}/workflows/{run_id}/resume")
async def resume_workflow_run(session_id: str, run_id: str, request: Request):
    """恢复工作流运行（仅支持 failed 状态）。"""
    with _runs_lock:
        run = _runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")
    if run.status != "failed":
        raise HTTPException(status_code=400, detail=f"Cannot resume workflow in '{run.status}' state")

    run.status = "running"
    run.failure_code = None
    run.updated_at = time.time()

    asyncio.create_task(_execute_workflow(
        run_id=run_id,
        session_id=session_id,
        request=request,
    ))

    logger.info("[workflow] Resumed run %s", run_id[:8])
    return {"run_id": run_id, "status": run.status}


# ── 执行引擎 ──

async def _send_ws_event(request: Request, session_id: str, event_type: str, payload: dict) -> None:
    """通过 WebSocket 注册表向会话推送事件。"""
    ws_registry = getattr(request.app.state, "ws_registry", None)
    if not ws_registry:
        return
    ws = ws_registry.get(session_id)
    if not ws:
        return
    try:
        await ws.send_json({"type": event_type, "payload": payload})
    except Exception as e:
        logger.warning("[workflow] Failed to send WS event %s: %s", event_type, e)


async def _execute_workflow(
    run_id: str,
    session_id: str,
    request: Request,
) -> None:
    """后台执行工作流步骤。"""
    with _runs_lock:
        run = _runs.get(run_id)
    if not run:
        return

    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    steps = run._workflow_def.get("steps", [])

    for i, step_def in enumerate(steps):
        # 检查取消
        if run._cancel_event.is_set():
            run.status = "cancelled"
            run.updated_at = time.time()
            await _send_ws_event(request, session_id, WsEventType.WORKFLOW_COMPLETED, {
                "run_id": run_id,
                "status": "cancelled",
                "current_step": i,
                "total_steps": len(steps),
            })
            return

        # 标记运行中
        run.mark_step_running(i)
        step_id = run.current_step_id or f"step_{i}"

        await _send_ws_event(request, session_id, WsEventType.WORKFLOW_STEP_START, {
            "run_id": run_id,
            "step_id": step_id,
            "position": i,
            "tool": step_def.get("tool", ""),
            "args": step_def.get("args", {}),
            "total_steps": len(steps),
        })

        try:
            # 通过 sidecar 执行步骤
            if sidecar_mgr and run._workflow_def.get("mode") == "sidecar":
                result = await _execute_via_sidecar(sidecar_mgr, step_def)
                output = result.get("output", "")
            else:
                # 简单模式：直接执行
                output = await _execute_simple_step(step_def, run._workflow_def.get("vars", {}))

            run.mark_step_done(i)
            await _send_ws_event(request, session_id, WsEventType.WORKFLOW_STEP_END, {
                "run_id": run_id,
                "step_id": step_id,
                "position": i,
                "status": "succeeded",
                "output": output[:2000] if output else "",
            })
        except Exception as e:
            error_msg = str(e)
            run.mark_step_failed(i, error_msg)
            run.status = "failed"
            run.updated_at = time.time()
            await _send_ws_event(request, session_id, WsEventType.WORKFLOW_STEP_ERROR, {
                "run_id": run_id,
                "step_id": step_id,
                "position": i,
                "error": error_msg,
            })
            await _send_ws_event(request, session_id, WsEventType.WORKFLOW_COMPLETED, {
                "run_id": run_id,
                "status": "failed",
                "error": error_msg,
                "current_step": i,
                "total_steps": len(steps),
            })
            return

    # 全部完成
    run.status = "succeeded"
    run.updated_at = time.time()
    await _send_ws_event(request, session_id, WsEventType.WORKFLOW_COMPLETED, {
        "run_id": run_id,
        "status": "succeeded",
        "current_step": len(steps),
        "total_steps": len(steps),
    })
    logger.info("[workflow] Run %s completed successfully", run_id[:8])


async def _execute_via_sidecar(sidecar_mgr, step_def: dict) -> dict:
    """通过 sidecar RPC 执行工作流步骤。"""
    await sidecar_mgr.start()
    from api.routes.chat import _get_sidecar_client  # 延迟导入避免循环

    client = await _get_sidecar_client(sidecar_mgr)
    result = await client.call("execute_workflow_step", {
        "session_id": "workflow",  # 工作流执行使用独立会话
        "step_definition": step_def,
    })
    return result


async def _execute_simple_step(step_def: dict, variables: dict) -> str:
    """简单模式：直接执行步骤（不依赖 sidecar）。

    支持的动作类型：sleep、log、set_var。
    """
    tool = step_def.get("tool", "")
    args = step_def.get("args", {})

    if tool == "sleep":
        duration = int(args.get("duration", 1))
        await asyncio.sleep(duration)
        return f"Slept for {duration}s"
    elif tool == "log":
        message = str(args.get("message", ""))
        logger.info("[workflow] %s", message)
        return message
    elif tool == "set_var":
        key = args.get("key", "")
        value = args.get("value", "")
        variables[key] = value
        return f"Set variable {key} = {value}"
    else:
        raise ValueError(f"Unsupported workflow tool: {tool}")