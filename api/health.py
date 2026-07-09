"""后端四部件健康自检 — LLM / 记忆 / 原生工具集 / MCP 工具集。

默认返回本地就绪状态，不主动探测远端 provider。
需要深度探测时，由调用方显式传入 ``probe_remote=True``。
"""

import asyncio
import time
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app_paths import ANTHROPIC_SKILLS_DIR
from memory.memory_manager import MemoryManager
from memory.narrative import MEMORY_PATH


class ComponentHealth(BaseModel):
    status: Literal["ok", "degraded", "error"]
    latency_ms: float | None = None
    detail: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    llm: ComponentHealth
    memory: ComponentHealth
    native_tools: ComponentHealth
    mcp_tools: ComponentHealth
    anthropic_skills_count: int = 0
    providers: dict[str, ComponentHealth] = {}
    timestamp: float


# ── LLM 健康检查（通过 ProviderManager）──────────────


async def check_llm(app: FastAPI, probe_remote: bool = False) -> ComponentHealth:
    """检查 LLM 运行时状态。

    默认仅判断本地是否存在可用 provider 与已初始化的 llm runtime，
    不在健康检查里阻塞等待远端模型连通性。
    """
    mgr = getattr(app.state, "provider_manager", None)
    if mgr is None or mgr.count == 0:
        return ComponentHealth(
            status="error",
            detail="No LLM providers configured. Add one via the providers panel.",
        )

    providers = list(mgr.iter_enabled())
    if not providers:
        return ComponentHealth(
            status="error",
            detail="No enabled provider available",
        )

    start = time.monotonic()
    if not probe_remote:
        elapsed = (time.monotonic() - start) * 1000
        runtime_ready = getattr(app.state, "llm", None) is not None
        primary = providers[0].provider_name
        detail = f"{len(providers)} 个 provider 已启用，当前默认 {primary}，未执行远端探测"
        if not runtime_ready:
            detail = f"{detail}；本地 runtime 尚未初始化"
        return ComponentHealth(
            status="ok" if runtime_ready else "error",
            latency_ms=round(elapsed, 1),
            detail=detail,
        )

    for provider in providers:
        result = await provider.check_health()
        if result.status == "ok":
            elapsed = (time.monotonic() - start) * 1000
            return ComponentHealth(
                status="ok",
                latency_ms=round(elapsed, 1),
                detail=f"Provider: {provider.provider_name}",
            )

    elapsed = (time.monotonic() - start) * 1000
    return ComponentHealth(
        status="error",
        latency_ms=round(elapsed, 1),
        detail="All providers unreachable",
    )


async def check_memory(app: FastAPI) -> ComponentHealth:
    start = time.monotonic()
    try:
        memory_path = MEMORY_PATH
        if not memory_path.exists():
            elapsed = (time.monotonic() - start) * 1000
            return ComponentHealth(
                status="error", latency_ms=round(elapsed, 1), detail="记忆文件不存在"
            )

        mm = MemoryManager(yaml_file=str(memory_path))
        items = mm.show()

        ltm = app.state.ltm
        consumer_running = ltm.is_listening if hasattr(ltm, "is_listening") else False

        parts = [f"{len(items)} 条记忆"]
        if not consumer_running:
            parts.append("后台消费者异常")
        status: Literal["ok", "error"] = "ok" if consumer_running else "error"

        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status=status, latency_ms=round(elapsed, 1), detail="，".join(parts)
        )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status="error", latency_ms=round(elapsed, 1), detail=str(e)
        )


async def check_native_tools(app: FastAPI) -> ComponentHealth:
    start = time.monotonic()
    try:
        tools = app.state.native_tools
        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status="ok",
            latency_ms=round(elapsed, 1),
            detail=f"{len(tools)} 个工具",
        )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status="error", latency_ms=round(elapsed, 1), detail=str(e)
        )


async def check_mcp_tools(app: FastAPI) -> ComponentHealth:
    start = time.monotonic()
    try:
        tools = app.state.mcp_tools
        if not tools:
            elapsed = (time.monotonic() - start) * 1000
            return ComponentHealth(
                status="ok",
                latency_ms=round(elapsed, 1),
                detail="0 个工具（未配置 MCP 服务器）",
            )
        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status="ok",
            latency_ms=round(elapsed, 1),
            detail=f"{len(tools)} 个工具",
        )
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return ComponentHealth(
            status="error", latency_ms=round(elapsed, 1), detail=str(e)
        )


async def check_health_providers(
    app: FastAPI, probe_remote: bool = False
) -> dict[str, ComponentHealth]:
    """遍历所有 enabled provider。

    默认只返回本地配置状态；深度模式下才并行执行远端健康检查。
    """
    mgr = getattr(app.state, "provider_manager", None)
    if mgr is None or mgr.count == 0:
        return {}

    providers = list(mgr.iter_enabled())
    if not probe_remote:
        return {
            provider.provider_name: ComponentHealth(
                status="ok",
                latency_ms=0.0,
                detail="已配置，未执行远端探测",
            )
            for provider in providers
        }

    async def _check_one(provider) -> tuple[str, ComponentHealth]:
        result = await provider.check_health()
        return (
            provider.provider_name,
            ComponentHealth(
                status=result.status,
                latency_ms=result.latency_ms,
                detail=result.detail,
            ),
        )

    tasks = [_check_one(p) for p in providers]
    results = await asyncio.gather(*tasks)
    return dict(results)


async def get_health_report(app: FastAPI, probe_remote: bool = False) -> HealthResponse:
    from version import __version__

    llm = await check_llm(app, probe_remote=probe_remote)
    memory = await check_memory(app)
    native_tools = await check_native_tools(app)
    mcp_tools = await check_mcp_tools(app)
    providers = await check_health_providers(app, probe_remote=probe_remote)

    # 统计 anthropic_skills 下的 skill 数量
    skills_count = 0
    if ANTHROPIC_SKILLS_DIR.is_dir():
        skills_count = len([p for p in ANTHROPIC_SKILLS_DIR.iterdir() if p.is_dir()])

    all_checks = [llm, memory, native_tools, mcp_tools] + list(providers.values())
    overall: Literal["ok", "degraded"] = (
        "ok" if all(c.status == "ok" for c in all_checks) else "degraded"
    )

    return HealthResponse(
        status=overall,
        version=__version__,
        llm=llm,
        memory=memory,
        native_tools=native_tools,
        mcp_tools=mcp_tools,
        anthropic_skills_count=skills_count,
        providers=providers,
        timestamp=time.time(),
    )


def check_health_sync(app) -> dict:
    """同步获取健康检查数据（供自治调度器调用）。

    不调用远程 provider 探测，仅查本地 app.state。
    返回 dict 格式，组件 status 使用 "ok"/"degraded"（与 collect_health_summary 兼容）。

    Args:
        app: FastAPI 应用实例

    Returns:
        健康状态 dict
    """
    try:
        import logging
        _logger = logging.getLogger(__name__)

        # LLM 状态
        llm_status = "ok"
        pm = getattr(app.state, "provider_manager", None)
        if pm is None or pm.count == 0:
            llm_status = "degraded"
        else:
            llm = getattr(app.state, "llm", None)
            if llm is None:
                llm_status = "degraded"

        # 记忆状态
        memory_status = "ok"
        ltm = getattr(app.state, "ltm", None)
        if ltm is not None:
            consumer_running = getattr(ltm, "is_listening", False)
            if not consumer_running:
                memory_status = "degraded"

        # 原生工具
        native_tools = getattr(app.state, "native_tools", [])
        native_status = "ok" if len(native_tools) > 0 else "degraded"

        # MCP 工具（可以为空，空不算降级）
        mcp_tools = getattr(app.state, "mcp_tools", [])
        mcp_status = "ok"

        # 总体状态
        all_statuses = [llm_status, memory_status, native_status, mcp_status]
        overall = "ok" if all(s == "ok" for s in all_statuses) else "degraded"

        return {
            "status": overall,
            "llm": {"status": llm_status},
            "memory": {"status": memory_status},
            "native_tools": {"status": native_status, "count": len(native_tools)},
            "mcp_tools": {"status": mcp_status, "count": len(mcp_tools)},
        }
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[health:sync] 健康检查失败: %s", e)
        return {
            "status": "unknown",
            "llm": {"status": "unknown"},
            "memory": {"status": "unknown"},
            "native_tools": {"status": "unknown"},
            "mcp_tools": {"status": "unknown"},
        }
