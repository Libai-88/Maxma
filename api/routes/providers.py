"""REST API — 提供商 CRUD 与连接测试。"""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.providers import ProviderConfig

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


class ProviderUpdateBody(BaseModel):
    label: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    enabled: bool | None = None
    context_window: int | None = None


class TestConnectionBody(BaseModel):
    api_key: str
    base_url: str
    provider_type: str = "openai"


# ── HELPERS ─────────────────────────────────────────────


def _get_manager(request: Request):
    return request.app.state.provider_manager


async def _maybe_initialize_llm(request: Request) -> None:
    """如果 LLM 尚未初始化，尝试从 ProviderManager 初始化。

    同时启动长期记忆监听器（start_listening 是幂等的，重复调用安全）。
    """
    app = request.app

    # LLM 已就绪，无需操作
    if app.state.llm is not None:
        return

    from api.dependencies import get_llm

    try:
        app.state.llm = get_llm(app.state.provider_manager)
        logger.info("[providers] LLM 已自动初始化")
    except RuntimeError:
        # 仍然没有可用的 provider
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
    """返回所有已配置的提供商（含未启用的）。"""
    configs = _get_manager(request).list_configs()
    return {"providers": [c.to_safe_dict() for c in configs]}


@router.get("/providers/{provider_id}")
def get_provider(provider_id: str, request: Request):
    """获取单个提供商配置。"""
    config = _get_manager(request).get_config(provider_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Provider not found")
    return config.to_safe_dict()


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
    )
    mgr.save_config(config)

    # 自动初始化 LLM 和 Memory（如果之前因缺少 provider 而未启动）
    await _maybe_initialize_llm(request)

    return config.to_safe_dict()


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
    await _maybe_initialize_llm(request)

    return config.to_safe_dict()


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: str, request: Request):
    """删除提供商配置。"""
    if not _get_manager(request).delete_config(provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
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
    return {
        "status": result.status,
        "latency_ms": result.latency_ms,
        "detail": result.detail,
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
    return {
        "status": result.status,
        "latency_ms": result.latency_ms,
        "detail": result.detail,
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
        raise HTTPException(status_code=400, detail=str(exc))


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

        config.models = model_names
        mgr.save_config(config)

        return {"models": model_names}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
