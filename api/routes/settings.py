"""OMP Settings REST API — 桥接前端到 sidecar RPC。

提供 GET/PUT /api/settings 端点，用于读写 OMP 的 Settings 配置。
Settings 是进程级单例，sidecar 内的 set() 立即写内存 + 100ms debounce 写磁盘。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

# 核心配置项列表 — 主流 agent 都具备的基础配置
CORE_SETTING_PATHS = [
    # Compaction — 上下文压缩
    "compaction.enabled",
    "compaction.strategy",
    "compaction.thresholdPercent",
    "compaction.midTurnEnabled",
    "compaction.idleEnabled",
    "compaction.idleThresholdTokens",
    "compaction.idleTimeoutSeconds",
    # Retry — 自动重试
    "retry.enabled",
    "retry.maxRetries",
    "retry.baseDelayMs",
    "retry.maxDelayMs",
    "retry.modelFallback",
    # Tools — 工具行为
    "tools.approvalMode",
    "tools.discoveryMode",
    # Advisor — 顾问代理
    "advisor.enabled",
    "advisor.subagents",
    # Interaction — 交互模式
    "steeringMode",
    "followUpMode",
    "interruptMode",
    # Thinking — 推理预算
    "thinkingBudgets.minimal",
    "thinkingBudgets.low",
    "thinkingBudgets.medium",
    "thinkingBudgets.high",
    "thinkingBudgets.xhigh",
    "thinkingBudgets.max",
    # Skills
    "skills.enabled",
]


class SetSettingsRequest(BaseModel):
    path: str
    value: Any


async def _rpc_call(request: Request, method: str, params: dict[str, Any] | None = None) -> Any:
    """Call sidecar RPC method via the sidecar manager from app state."""
    sidecar_mgr = getattr(request.app.state, "sidecar_manager", None)
    if sidecar_mgr is None:
        raise HTTPException(status_code=503, detail="Sidecar not available")
    await sidecar_mgr.start()
    client = sidecar_mgr.client
    if client is None:
        raise HTTPException(status_code=503, detail="Sidecar client not available")
    return await client.call(method, params or {})


@router.get("/settings")
async def get_settings(request: Request, paths: str | None = None):
    """读取 OMP Settings 配置项。

    Args:
        paths: 逗号分隔的配置路径列表。为空则返回所有核心配置项。
    """
    if paths:
        path_list = [p.strip() for p in paths.split(",") if p.strip()]
    else:
        path_list = CORE_SETTING_PATHS

    try:
        result = await _rpc_call(request, "get_settings", {"paths": path_list})
        return result.get("settings", {})
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get settings: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/settings")
async def set_settings(request: Request, body: SetSettingsRequest):
    """写入 OMP Settings 配置项。"""
    try:
        await _rpc_call(request, "set_settings", {
            "path": body.path,
            "value": body.value,
        })
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to set setting %s: %s", body.path, e)
        raise HTTPException(status_code=500, detail=str(e))
