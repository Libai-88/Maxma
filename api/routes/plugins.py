"""Plugin management API — 桥接前端到 sidecar RPC 插件管理。

提供浏览器/安装/卸载/启用的 REST 端点，用于前端 PluginView 管理面板。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class InstallPluginRequest(BaseModel):
    spec: str
    features: list[str] | None = None


class TogglePluginRequest(BaseModel):
    enabled: bool


class UpdatePluginConfigRequest(BaseModel):
    config: dict[str, Any]


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


@router.get("/plugins")
async def list_plugins(request: Request):
    """列出所有已安装的 OMP 插件。"""
    try:
        result = await _rpc_call(request, "list_plugins")
        return result if isinstance(result, list) else []
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to list plugins: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/plugins/install")
async def install_plugin(body: InstallPluginRequest, request: Request):
    """安装 OMP 插件（支持 npm/GitHub/git URL）。"""
    try:
        result = await _rpc_call(request, "install_plugin", {"spec": body.spec})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to install plugin %s: %s", body.spec, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/plugins/{name}")
async def uninstall_plugin(name: str, request: Request):
    """卸载 OMP 插件。"""
    try:
        result = await _rpc_call(request, "uninstall_plugin", {"name": name})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to uninstall plugin %s: %s", name, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/plugins/{name}/toggle")
async def toggle_plugin(name: str, body: TogglePluginRequest, request: Request):
    """启用或禁用已安装的插件。"""
    try:
        result = await _rpc_call(request, "set_plugin_enabled", {
            "name": name,
            "enabled": body.enabled,
        })
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to toggle plugin %s: %s", name, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/plugins/{name}")
async def get_plugin_detail(name: str, request: Request):
    """获取插件详情（包含 README、依赖、配置 schema 等）。"""
    try:
        result = await _rpc_call(request, "get_plugin_detail", {"name": name})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get plugin detail %s: %s", name, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/plugins/{name}/config")
async def get_plugin_config(name: str, request: Request):
    """获取插件当前配置。"""
    try:
        result = await _rpc_call(request, "get_plugin_config", {"name": name})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get plugin config %s: %s", name, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/plugins/{name}/config")
async def update_plugin_config(name: str, body: UpdatePluginConfigRequest, request: Request):
    """更新插件配置。"""
    try:
        result = await _rpc_call(request, "update_plugin_config", {
            "name": name,
            "config": body.config,
        })
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update plugin config %s: %s", name, e)
        raise HTTPException(status_code=500, detail=str(e))
