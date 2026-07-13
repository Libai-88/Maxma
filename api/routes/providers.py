"""REST API — 提供商 CRUD 与连接测试。"""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.providers import ProviderConfig
from api.security.credential_mask import mask_sensitive_fields
from api.runtime_status import RuntimeStatus

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic 请求/响应模型 ──────────────────────────────


class ProviderCreateBody(BaseModel):
    id: str
    provider_type: str = "openai"
    label: str
    api_key: str
    base_url: str
    models: list[str] = []
    enabled: bool = True
    context_window: int = 256_000
    # 阶段 3.3：优先级（数字越小优先级越高，0 = 最高），用于 fallback 排序
    priority: int = 0


class ProviderUpdateBody(BaseModel):
    label: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    enabled: bool | None = None
    context_window: int | None = None
    # 阶段 3.3：优先级（数字越小优先级越高，0 = 最高），用于 fallback 排序
    priority: int | None = None


class TestConnectionBody(BaseModel):
    api_key: str
    base_url: str
    provider_type: str = "openai"


# ── HELPERS ─────────────────────────────────────────────


def _get_manager(request: Request):
    return request.app.state.provider_manager


def _config_with_health(request: Request, config) -> dict:
    """合并 provider 配置与运行时健康状态（阶段 3.3）。

    健康状态由 ProviderManager 的后台 health_monitor 维护，未持久化，
    重启后重置为 unknown（前端应优雅处理 unknown 状态）。
    """
    data = config.to_safe_dict()
    mgr = _get_manager(request)
    try:
        hs = mgr.get_health_status(config.id)
    except Exception:
        hs = None
    if hs is None:
        data["health_status"] = "unknown"
        data["health_detail"] = None
        data["health_latency_ms"] = None
        data["last_check_time"] = 0.0
        data["consecutive_failures"] = 0
    else:
        try:
            provider = mgr.get(config.id)
            last_check_time = provider.last_check_time
            consecutive_failures = provider.consecutive_failures
        except KeyError:
            # A reload can remove the enabled runtime provider between the two
            # reads; keep the configuration response safe and internally consistent.
            last_check_time = 0.0
            consecutive_failures = 0
        runtime = RuntimeStatus.health(
            hs.status,
            hs.detail,
            updated_at=last_check_time or None,
        )
        data["health_status"] = hs.status
        data["health_detail"] = runtime.public_detail()
        data["health_latency_ms"] = hs.latency_ms
        data["health_reason_code"] = runtime.reason_code
        data["health_retry_at"] = runtime.retry_at
        data["health_updated_at"] = runtime.updated_at
        data["health_summary"] = runtime.summary
        data["last_check_time"] = last_check_time
        data["consecutive_failures"] = consecutive_failures
    # 统一掩码层兜底（防止 to_safe_dict 遗漏的敏感字段）
    return mask_sensitive_fields(data)


async def _maybe_initialize_llm(request: Request, force: bool = False) -> None:
    """如果 LLM 尚未初始化（或 force=True），尝试从 ProviderManager 初始化。

    同时启动长期记忆监听器（start_listening 是幂等的，重复调用安全）。
    """
    app = request.app

    # LLM 已就绪且非强制刷新，无需操作
    if app.state.llm is not None and not force:
        return

    from api.dependencies import get_llm

    try:
        app.state.llm = get_llm(app.state.provider_manager)
        logger.info("[providers] LLM 已自动初始化")
    except RuntimeError:
        # 仍然没有可用的 provider：必须清空旧 runtime，避免 chat 继续使用已删除/禁用的 provider。
        app.state.llm = None
        logger.info("[providers] 无可用 LLM provider，已清空旧 runtime")
        return

    # LLM 刚初始化成功，启动长期记忆监听（幂等，可重复调用）
    if hasattr(app.state, "ltm") and app.state.ltm is not None:
        app.state.ltm.start_listening(
            app.state.llm,
            ws_registry=app.state.ws_registry,
        )
        logger.info("[providers] 长期记忆监听器已自动启动")


# ── CRUD ────────────────────────────────────────────────


@router.get("/providers")
def list_providers(request: Request):
    """返回所有已配置的提供商（含未启用的，附带运行时健康状态）。"""
    configs = _get_manager(request).list_configs()
    return {"providers": [_config_with_health(request, c) for c in configs]}


@router.get("/providers/{provider_id}")
def get_provider(provider_id: str, request: Request):
    """获取单个提供商配置（附带运行时健康状态）。"""
    config = _get_manager(request).get_config(provider_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return _config_with_health(request, config)


@router.post("/providers")
async def create_provider(body: ProviderCreateBody, request: Request):
    """新增提供商。"""
    mgr = _get_manager(request)
    if mgr.get_config(body.id) is not None:
        raise HTTPException(
            status_code=409, detail=f"Provider '{body.id}' already exists"
        )

    config = ProviderConfig(
        id=body.id,
        provider_type=body.provider_type,
        label=body.label,
        api_key=body.api_key,
        base_url=body.base_url,
        models=body.models,
        enabled=body.enabled,
        context_window=body.context_window,
        priority=body.priority,
    )
    mgr.save_config(config)

    # 自动初始化 LLM 和 Memory（如果之前因缺少 provider 而未启动）
    await _maybe_initialize_llm(request, force=True)

    return _config_with_health(request, config)


@router.put("/providers/{provider_id}")
async def update_provider(provider_id: str, body: ProviderUpdateBody, request: Request):
    """更新提供商配置（部分字段）。"""
    mgr = _get_manager(request)
    config = mgr.get_config(provider_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    mgr.save_config(config)

    # 自动初始化 LLM 和 Memory（如果之前因缺少 provider 而未启动）
    await _maybe_initialize_llm(request, force=True)

    return _config_with_health(request, config)


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str, request: Request):
    """删除提供商配置。"""
    if not _get_manager(request).delete_config(provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
    # 删除后强制重新初始化 LLM（可能删的是当前正在使用的 provider）
    await _maybe_initialize_llm(request, force=True)
    return {"status": "deleted"}


# ── 连接测试与模型发现 ─────────────────────────────────


def _build_temp_provider(body: TestConnectionBody):
    """根据请求体凭据临时创建 provider 用于测试。"""
    from api.providers.openai_provider import OpenAIProvider

    return OpenAIProvider(
        ProviderConfig(
            id="_test_",
            provider_type=body.provider_type,
            label="",
            api_key=body.api_key,
            base_url=body.base_url,
        )
    )


@router.post("/providers/test")
async def test_connection(body: TestConnectionBody):
    """测试任意凭据的连接（前端向导填写凭据后调用）。"""
    provider = _build_temp_provider(body)
    result = await provider.check_health()
    runtime = RuntimeStatus.health(result.status, result.detail)
    return {
        "status": result.status,
        "latency_ms": result.latency_ms,
        "detail": runtime.public_detail(),
        "reason_code": runtime.reason_code,
        "retry_at": runtime.retry_at,
        "updated_at": runtime.updated_at,
        "summary": runtime.summary,
    }


@router.post("/providers/{provider_id}/test")
async def test_existing_provider(provider_id: str, request: Request):
    """测试已保存提供商的连接。"""
    mgr = _get_manager(request)
    try:
        provider = mgr.get(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Provider not found or not enabled")
    result = await provider.check_health()
    runtime = RuntimeStatus.health(result.status, result.detail)
    return {
        "status": result.status,
        "latency_ms": result.latency_ms,
        "detail": runtime.public_detail(),
        "reason_code": runtime.reason_code,
        "retry_at": runtime.retry_at,
        "updated_at": runtime.updated_at,
        "summary": runtime.summary,
    }


@router.post("/providers/{provider_id}/health")
async def check_provider_health(provider_id: str, request: Request):
    """阶段 3.3：触发按需健康检查并更新 provider 的运行时健康状态。

    与后台 health_monitor 互补：管理员可在 UI 上手动触发即时检查，
    结果会同步写入 ProviderManager 的健康状态（影响 fallback 链路决策）。

    返回最新的健康状态摘要（status/latency_ms/detail/last_check_time/
    consecutive_failures），便于前端立即刷新 UI。
    """
    mgr = _get_manager(request)
    try:
        provider = mgr.get(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Provider not found or not enabled")

    result = await provider.check_health()

    # 同步健康状态到 ProviderManager（影响 get_healthy / get_fallback 决策）
    if result.status == "ok":
        mgr.mark_healthy(provider_id, latency_ms=result.latency_ms)
    elif result.status == "degraded":
        mgr.mark_degraded(provider_id, detail=result.detail or "degraded")
    else:
        mgr.mark_unhealthy(provider_id, detail=result.detail or "error")

    # 重新查询以拿到更新后的 last_check_time / consecutive_failures
    try:
        provider = mgr.get(provider_id)
        last_check_time = provider.last_check_time
        consecutive_failures = provider.consecutive_failures
    except KeyError:
        last_check_time = 0.0
        consecutive_failures = 0

    runtime = RuntimeStatus.health(
        result.status,
        result.detail,
        updated_at=last_check_time or None,
    )
    return {
        "status": result.status,
        "latency_ms": result.latency_ms,
        "detail": runtime.public_detail(),
        "reason_code": runtime.reason_code,
        "retry_at": runtime.retry_at,
        "updated_at": runtime.updated_at,
        "summary": runtime.summary,
        "last_check_time": last_check_time,
        "consecutive_failures": consecutive_failures,
    }


@router.post("/providers/discover-models")
async def discover_models(body: TestConnectionBody):
    """根据凭据拉取模型列表（前端向导步骤 3）。"""
    from openai import AsyncOpenAI

    try:
        client = AsyncOpenAI(api_key=body.api_key, base_url=body.base_url)
        models = await client.models.list()
        model_names = sorted(m.id for m in models.data)
        return {"models": model_names}
    except Exception as exc:
        logger.error("Model discovery failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=400, detail="模型发现失败，请检查 API Key 和 Base URL")


@router.post("/providers/{provider_id}/discover-models")
async def discover_models_for_existing(provider_id: str, request: Request):
    """拉取已保存提供商的模型列表并更新缓存。"""
    from openai import AsyncOpenAI

    mgr = _get_manager(request)
    config = mgr.get_config(provider_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Provider not found")

    try:
        client = AsyncOpenAI(api_key=config.api_key, base_url=config.base_url)
        models = await client.models.list()
        model_names = sorted(m.id for m in models.data)

        return {"models": model_names}
    except Exception as exc:
        logger.error("Model discovery failed for provider %s: %s", provider_id, exc, exc_info=True)
        raise HTTPException(status_code=400, detail="模型发现失败，请检查 API Key 和 Base URL")
