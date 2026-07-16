"""后端四部件健康自检 — LLM / 记忆 / 原生工具集 / MCP 工具集。

默认返回本地就绪状态，不主动探测远端 provider。
需要深度探测时，由调用方显式传入 ``probe_remote=True``。
"""

import asyncio
import logging
import time
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, field_validator, model_validator

from app_paths import ANTHROPIC_SKILLS_DIR
from api.runtime_status import RuntimeStatus, sanitize_user_detail

logger = logging.getLogger(__name__)


class ComponentHealth(BaseModel):
    status: Literal["ok", "degraded", "error"]
    latency_ms: float | None = None
    detail: str | None = None
    reason_code: str | None = None
    retry_at: float | None = None
    updated_at: float | None = None
    summary: str | None = None

    @field_validator("detail")
    @classmethod
    def _sanitize_detail(cls, value: str | None) -> str | None:
        return sanitize_user_detail(value)

    @model_validator(mode="after")
    def _fill_runtime_fields(self) -> "ComponentHealth":
        runtime = RuntimeStatus.health(
            self.status,
            self.detail,
            retry_at=self.retry_at,
            updated_at=self.updated_at,
        )
        if self.reason_code is None:
            self.reason_code = runtime.reason_code
        if self.updated_at is None:
            self.updated_at = runtime.updated_at
        if self.summary is None:
            self.summary = runtime.summary
        return self

    @classmethod
    def from_runtime(
        cls,
        status: Literal["ok", "degraded", "error"],
        *,
        latency_ms: float | None = None,
        technical_detail: str | None = None,
        retry_at: float | None = None,
    ) -> "ComponentHealth":
        runtime = RuntimeStatus.health(status, technical_detail, retry_at=retry_at)
        return cls(
            status=status,
            latency_ms=latency_ms,
            detail=runtime.public_detail(),
            reason_code=runtime.reason_code,
            retry_at=runtime.retry_at,
            updated_at=runtime.updated_at,
            summary=runtime.summary,
        )


class LtmDiagnostic(ComponentHealth):
    """Safe LTM status, optionally associated with a known configured provider."""

    provider_id: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    llm: ComponentHealth
    memory: ComponentHealth
    native_tools: ComponentHealth
    mcp_tools: ComponentHealth
    anthropic_skills_count: int = 0
    ltm: LtmDiagnostic | None = None
    provider_diagnostics_enabled: bool = False
    think_path_enabled: bool = False
    timestamp: float


# ── LLM 健康检查 ─────────────────────────────


async def check_llm(app: FastAPI, probe_remote: bool = False) -> ComponentHealth:
    """检查 LLM 运行时状态。

    OMP ModelRegistry 管理所有 provider，Python 端不再管理 LLM provider。
    默认返回未知状态，远端探测由 oh-my-pi sidecar 处理。
    """
    if not probe_remote:
        return ComponentHealth(
            status="ok",
            latency_ms=0.0,
            detail="LLM 由 OMP ModelRegistry 管理，未执行远端探测",
        )

    # 远端探测：尝试通过 sidecar 验证连接
    sidecar_mgr = getattr(app.state, "sidecar_manager", None)
    if sidecar_mgr is None:
        return ComponentHealth(
            status="error",
            detail="Sidecar 管理器未初始化",
        )

    try:
        await sidecar_mgr.start()
        client = sidecar_mgr.client
        if client is None:
            return ComponentHealth(
                status="error",
                detail="Sidecar 客户端不可用",
            )
        start = time.monotonic()
        result = await asyncio.wait_for(
            client.call("get_health", {"probe": True}),
            timeout=10.0,
        )
        elapsed = (time.monotonic() - start) * 1000
        if result.get("status") == "ok":
            return ComponentHealth(
                status="ok",
                latency_ms=round(elapsed, 1),
                detail="OMP sidecar 健康",
            )
        return ComponentHealth(
            status="error",
            latency_ms=round(elapsed, 1),
            detail=result.get("message", "Sidecar 报告异常"),
        )
    except asyncio.TimeoutError:
        return ComponentHealth(
            status="error",
            detail="Sidecar 健康检查超时",
        )
    except Exception as e:
        return ComponentHealth(
            status="error",
            detail=f"Sidecar 健康检查失败: {e}",
        )


def get_ltm_diagnostic(app: FastAPI) -> LtmDiagnostic | None:
    """LTM 已移除，返回 None。"""
    return None


def associate_ltm_provider(app: FastAPI, diagnostic: LtmDiagnostic | None) -> LtmDiagnostic | None:
    """LTM 已移除，返回 None。"""
    return None


async def check_memory(
    app: FastAPI, diagnostic: LtmDiagnostic | None = None
) -> ComponentHealth:
    """检查记忆系统状态（memory/ 包已移除，始终返回 ok）。"""
    return ComponentHealth(status="ok", latency_ms=0.0, detail="memory/ 包已移除，由 OMP recall/reflect/retain 替代")


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


async def get_health_report(app: FastAPI, probe_remote: bool = False) -> HealthResponse:
    from version import __version__
    from config.settings import get_settings

    settings = get_settings()
    llm = await check_llm(app, probe_remote=probe_remote)
    ltm = associate_ltm_provider(app, get_ltm_diagnostic(app))
    memory = await check_memory(
        app,
        diagnostic=ltm if settings.provider_diagnostics_enabled else None,
    )
    native_tools = await check_native_tools(app)
    mcp_tools = await check_mcp_tools(app)

    # 统计 anthropic_skills 下的 skill 数量
    skills_count = 0
    if ANTHROPIC_SKILLS_DIR.is_dir():
        skills_count = len([p for p in ANTHROPIC_SKILLS_DIR.iterdir() if p.is_dir()])

    all_checks = [llm, memory, native_tools, mcp_tools]
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
        ltm=ltm,
        provider_diagnostics_enabled=settings.provider_diagnostics_enabled,
        think_path_enabled=settings.think_path_enabled,
        timestamp=time.time(),
    )


def check_health_sync(app) -> dict:
    """同步获取健康检查数据（供自治调度器调用）。

    不调用远程探测，仅查本地 app.state。
    返回 dict 格式，组件 status 使用 "ok"/"degraded"（与 collect_health_summary 兼容）。

    Args:
        app: FastAPI 应用实例

    Returns:
        健康状态 dict
    """
    try:
        import logging
        _logger = logging.getLogger(__name__)

        # LLM 状态 — OMP ModelRegistry 管理
        llm_status = "ok"

        # 记忆状态（memory/ 包已移除，始终 ok）
        memory_status = "ok"

        # 原生工具
        native_tools = getattr(app.state, "native_tools", [])
        native_status = "ok" if len(native_tools) > 0 else "degraded"

        # MCP 工具（可以为空，空不算降级）
        mcp_status = "ok"

        # 总体状态
        all_statuses = [llm_status, memory_status, native_status, mcp_status]
        overall = "ok" if all(s == "ok" for s in all_statuses) else "degraded"

        return {
            "status": overall,
            "llm": {"status": llm_status},
            "memory": {"status": memory_status},
            "native_tools": {"status": native_status, "count": len(native_tools)},
            "mcp_tools": {"status": mcp_status, "count": 0},
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
