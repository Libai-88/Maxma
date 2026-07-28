"""Capabilities dashboard API — 聚合 OMP 能力发现、配置和运行时状态。

提供 GET /api/capabilities 端点，返回聚合后的能力全景，
供前端 CapabilitiesView 仪表盘展示。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from api.routes.settings import CORE_SETTING_PATHS

logger = logging.getLogger(__name__)

router = APIRouter()


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


@router.get("/capabilities")
async def get_capabilities(request: Request):
    """聚合 OMP 能力全景。

    返回所有已发现和已配置的能力模块及其状态，
    包括 Settings、工具、MCP、Provider、记忆等。
    """
    from api.routes.mcp import list_mcp_servers
    from api.routes.tools import list_tools

    result: dict[str, Any] = {
        "settings": {},
        "tools": [],
        "mcp_servers": [],
        "providers": [],
        "env": {},
        "system": {},
    }

    # 1. OMP Settings
    try:
        settings_result = await _rpc_call(request, "get_settings", {"paths": CORE_SETTING_PATHS})
        result["settings"] = settings_result.get("settings", {})
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch settings: %s", e)
        result["settings_error"] = str(e)

    # 2. 工具列表
    try:
        tools = await list_tools()
        result["tools"] = tools if isinstance(tools, list) else []
        result["tool_categories"] = _categorize_tools(result["tools"])
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch tools: %s", e)

    # 3. MCP 服务器（已配置 + 自动发现）
    try:
        mcp_result = await list_mcp_servers(request)
        servers = mcp_result
        if isinstance(mcp_result, dict):
            servers = mcp_result.get("servers", mcp_result.get("data", []))
        result["mcp_servers"] = servers if isinstance(servers, list) else []
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch MCP servers: %s", e)

    # 4. MCP 自动发现
    try:
        from api.routes.mcp import get_discovered_mcp_servers
        result["discovered_mcp"] = await get_discovered_mcp_servers(request)
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch discovered MCP: %s", e)

    # 5. Provider 列表
    try:
        from api.routes.providers import _load_providers
        providers = _load_providers()
        result["providers"] = [
            {"id": p.get("id"), "name": p.get("name"), "provider": p.get("provider"),
             "model": p.get("model"), "enabled": p.get("enabled", True)}
            for p in (providers if isinstance(providers, list) else [])
        ]
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch providers: %s", e)

    # 5. 系统环境
    try:
        import os
        result["env"] = {
            "cwd": os.getcwd(),
            "platform": os.name,
            "project_root": os.environ.get("MAXMA_PROJECT_ROOT", ""),
        }
        result["system"] = {
            "sidecar_available": getattr(request.app.state, "sidecar_manager", None) is not None,
            "session_count": _count_sessions(request),
        }
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch system info: %s", e)

    # 6. 记忆统计
    try:
        from api.routes.memory import _memory_stats_sync as _get_mem_stats
        from api.routes.memory import _memory_path
        mem_path = _memory_path(request)
        result["memory"] = await asyncio.to_thread(_get_mem_stats, mem_path)
    except Exception as e:
        logger.warning("[capabilities] Failed to fetch memory stats: %s", e)

    # 7. 配置来源分析
    try:
        result["config_sources"] = _analyze_config_sources()
    except Exception as e:
        logger.warning("[capabilities] Failed to analyze config sources: %s", e)

    # 8. 能力发现清单（Phase 4）—— 动态计算的特性总览，
    #    供前端 useCapabilities / capabilities store 驱动导航与路由守卫。
    try:
        result.update(_build_manifest(request, result))
    except Exception as e:
        logger.warning("[capabilities] Failed to build capability manifest: %s", e)

    return result


def _build_manifest(request: Request, gathered: dict[str, Any]) -> dict[str, Any]:
    """动态计算能力发现清单。

    从真实系统状态推导各特性开关：读取面板配置（tts/browser_tools/sub_agents/
    hindsight）、统计工具与模型、探测 sidecar 运行状态、枚举已注册路由。
    任何子步骤失败都回退到安全默认值，绝不抛出异常打断主响应。
    """
    from version import __version__

    features: dict[str, Any] = {}

    # 面板配置（持久化于 panel_configs.json）
    panels = _safe_panel_configs()
    tts_cfg = panels.get("tts", {})
    browser_cfg = panels.get("browser_tools", {})
    subagent_cfg = panels.get("sub_agents", {})
    hindsight_cfg = panels.get("hindsight", {})

    # MCP —— 路由始终注册；OAuth 与 Registry 端点可用
    features["mcp"] = {
        "enabled": True,
        "oauth": True,
        "registry": True,
        "servers": len(gathered.get("mcp_servers", []) or []),
    }

    # 记忆 —— 核心能力常驻；hindsight 取决于面板配置
    features["memory"] = {
        "enabled": True,
        "hindsight": bool(hindsight_cfg.get("enabled", False)),
        "episodic": True,
    }

    # TTS / 语音
    tts_enabled = bool(tts_cfg.get("enabled", False))
    features["tts"] = {
        "enabled": tts_enabled,
        "providers": [tts_cfg.get("provider", "edge-tts")] if tts_enabled else [],
    }

    # 浏览器工具
    features["browser_tools"] = {"enabled": bool(browser_cfg.get("enabled", False))}

    # 子代理
    features["sub_agents"] = {
        "enabled": bool(subagent_cfg.get("enabled", False)),
        "max_concurrent": int(subagent_cfg.get("max_concurrent", 3) or 3),
    }

    # 自动化 —— 调度器在 lifespan 中启动
    scheduler = getattr(request.app.state, "automation_scheduler", None)
    scheduler_running = scheduler is not None and not getattr(scheduler, "done", lambda: True)()
    features["automation"] = {"enabled": True, "scheduler": scheduler_running}

    # 协作 —— SQLite 持久化（api.db.core）
    features["collab"] = {"enabled": True, "persistence": "sqlite"}

    # 插件 —— 已启用，暂无公开市场
    features["plugins"] = {"enabled": True, "marketplace": False}

    # 质量规则 —— 内置 + 自定义
    features["rules"] = {"enabled": True, "custom_rules": True}

    # 工具统计
    tools = gathered.get("tools", []) or []
    builtin_count = sum(1 for t in tools if t.get("builtin", True))
    custom_count = len(tools) - builtin_count
    categories = sorted({t.get("category", "other") for t in tools})
    features["tools"] = {
        "builtin_count": builtin_count,
        "custom_count": custom_count,
        "categories": categories,
    }

    # 模型 / Provider 统计
    providers = gathered.get("providers", []) or []
    provider_names = sorted({p.get("provider") for p in providers if p.get("provider")})
    features["models"] = {
        "providers": provider_names,
        "total_models": len(providers),
    }

    return {
        "version": __version__,
        "features": features,
        "sidecar": _sidecar_status(request),
        "endpoints": _list_api_endpoints(request),
    }


def _safe_panel_configs() -> dict[str, dict[str, Any]]:
    """读取四个面板配置，失败时返回空 dict（不抛异常）。"""
    try:
        from api.routes.settings_panels import _get_panel

        return {
                name: _get_panel(name)
                for name in ("tts", "browser_tools", "sub_agents", "hindsight")
            }
    except Exception as e:
        logger.warning("[capabilities] Failed to read panel configs: %s", e)
        return {}


def _sidecar_status(request: Request) -> dict[str, Any]:
    """探测 sidecar 运行状态与版本。"""
    mgr = getattr(request.app.state, "sidecar_manager", None)
    running = bool(mgr is not None and getattr(mgr, "is_running", False))
    return {"status": "running" if running else "stopped", "version": _sidecar_version()}


def _sidecar_version() -> str | None:
    """从 bun-sidecar/package.json 读取版本号，缺失时返回 None。"""
    try:
        import json

        from api.pi_bridge.sidecar_manager import SIDECAR_DIR

        pkg = SIDECAR_DIR / "package.json"
        if pkg.exists():
            with open(pkg, encoding="utf-8") as f:
                return json.load(f).get("version")
    except Exception:
        pass
    return None


def _list_api_endpoints(request: Request) -> list[str]:
    """枚举已注册的 /api 路由路径（去重 + 排序）。"""
    paths: set[str] = set()
    try:
        for route in getattr(request.app, "routes", []):
            path = getattr(route, "path", None)
            if isinstance(path, str) and path.startswith("/api"):
                paths.add(path)
    except Exception:
        pass
    return sorted(paths)


def _categorize_tools(tools: list[dict]) -> dict[str, list[dict]]:
    """按类别分组工具列表。"""
    categories: dict[str, list[dict]] = {}
    for t in tools:
        cat = t.get("category", "other")
        categories.setdefault(cat, []).append(t)
    return categories


def _analyze_config_sources() -> dict[str, Any]:
    """分析 OMP 配置来源。

    返回按优先级排序的配置源列表，标记哪些实际存在、是否有冲突。
    """
    import os
    home = os.path.expanduser("~")
    cwd = os.getcwd()
    maxma_root = os.environ.get("MAXMA_PROJECT_ROOT", cwd)

    sources = [
        {"name": "环境变量", "path": "OMP_* / MAXMA_* env", "priority": 1, "exists": True,
         "scope": "global", "description": "运行时环境变量覆盖"},
        {"name": "CLI 参数", "path": "启动命令行", "priority": 2, "exists": True,
         "scope": "session", "description": "启动时传入的命令行参数"},
        {"name": "项目 .omprc", "path": os.path.join(cwd, ".omprc"), "priority": 3,
         "exists": os.path.exists(os.path.join(cwd, ".omprc")), "scope": "project",
         "description": "项目级 OMP 配置文件"},
        {"name": "项目 .omprc.json", "path": os.path.join(cwd, ".omprc.json"), "priority": 4,
         "exists": os.path.exists(os.path.join(cwd, ".omprc.json")), "scope": "project",
         "description": "项目级 OMP JSON 配置"},
        {"name": "项目 .claude", "path": os.path.join(cwd, ".claude"), "priority": 5,
         "exists": os.path.isdir(os.path.join(cwd, ".claude")), "scope": "project",
         "description": "Claude Code 项目配置（skills/MCP 等）"},
        {"name": "项目 .cursor", "path": os.path.join(cwd, ".cursor"), "priority": 6,
         "exists": os.path.isdir(os.path.join(cwd, ".cursor")), "scope": "project",
         "description": "Cursor 编辑器项目配置"},
        {"name": "项目 .github", "path": os.path.join(cwd, ".github"), "priority": 7,
         "exists": os.path.isdir(os.path.join(cwd, ".github")), "scope": "project",
         "description": "GitHub 项目配置"},
        {"name": "项目 .mcp.json", "path": os.path.join(cwd, ".mcp.json"), "priority": 8,
         "exists": os.path.exists(os.path.join(cwd, ".mcp.json")), "scope": "project",
         "description": "MCP 服务器配置文件"},
        {"name": "项目 agents.md", "path": os.path.join(cwd, "AGENTS.md"), "priority": 9,
         "exists": os.path.exists(os.path.join(cwd, "AGENTS.md")), "scope": "project",
         "description": "项目上下文说明"},
        {"name": "用户 ~/.omp", "path": os.path.join(home, ".omp"), "priority": 10,
         "exists": os.path.isdir(os.path.join(home, ".omp")), "scope": "user",
         "description": "OMP 全局用户配置"},
        {"name": "用户 ~/.claude", "path": os.path.join(home, ".claude"), "priority": 11,
         "exists": os.path.isdir(os.path.join(home, ".claude")), "scope": "user",
         "description": "Claude Code 全局配置"},
        {"name": "用户 ~/.cursor", "path": os.path.join(home, ".cursor"), "priority": 12,
         "exists": os.path.isdir(os.path.join(home, ".cursor")), "scope": "user",
         "description": "Cursor 编辑器全局配置"},
        {"name": "Maxma 数据目录", "path": os.path.join(maxma_root, "api/data"), "priority": 13,
         "exists": os.path.isdir(os.path.join(maxma_root, "api/data")), "scope": "app",
         "description": "Maxma 应用数据目录"},
    ]

    # 检测冲突：在多处存在且可能定义相同配置项的情况
    conflicts = []
    active_sources = [s for s in sources if s["exists"]]
    if len(active_sources) > 1:
        # 检查同 scope 内是否有多个源
        scope_groups: dict[str, list[str]] = {}
        for s in active_sources:
            scope_groups.setdefault(s["scope"], []).append(s["name"])
        for scope, names in scope_groups.items():
            if len(names) > 1:
                conflicts.append({
                    "scope": scope,
                    "sources": names,
                    "severity": "info",
                    "note": f"同一作用域({scope})存在多个配置源，高优先级覆盖低优先级",
                })

    return {
        "sources": sources,
        "active_count": len(active_sources),
        "total_count": len(sources),
        "conflicts": conflicts,
        "resolution_order": [s["name"] for s in sources],  # 高优先级在前
    }


def _count_sessions(request: Request) -> int:
    """统计当前活跃会话数。"""
    sm = getattr(request.app.state, "session_manager", None)
    if sm is None:
        return 0
    try:
        sessions = getattr(sm, "get_all_sessions", None)
        if sessions:
            return len(sessions())
        return 0
    except Exception:
        return 0
