"""Provider 管理端点 — CRUD + 连接测试 + 模型发现。

存储：`app_paths.PROVIDERS_YAML_PATH` 指向的 YAML 文件（`providers: [...]`）。
首次运行（文件不存在或为空）时 `GET /providers` 返回硬编码默认列表，保持向后兼容。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app_paths import PROVIDERS_YAML_PATH
from api.yaml_store import dump_yaml_atomic, load_yaml, yaml_file_lock

router = APIRouter()

# 模块级常量：便于测试通过 monkeypatch 替换。
PROVIDERS_YAML_PATH = PROVIDERS_YAML_PATH


# ═══════════════════════════════════════════════════════════════════════
# 硬编码默认 provider 列表（yaml 不存在或为空时 fallback）
# ═══════════════════════════════════════════════════════════════════════

_DEFAULT_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "openai",
        "provider_type": "openai",
        "label": "OpenAI",
        "api_key": "",
        "base_url": "https://api.openai.com/v1",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
        "enabled": True,
        "context_window": 128000,
    },
    {
        "id": "anthropic",
        "provider_type": "anthropic",
        "label": "Anthropic",
        "api_key": "",
        "base_url": "https://api.anthropic.com/v1",
        "models": ["claude-sonnet-4-20250514", "claude-haiku-3-5-20250204"],
        "enabled": True,
        "context_window": 200000,
    },
    {
        "id": "deepseek",
        "provider_type": "openai",
        "label": "DeepSeek",
        "api_key": "",
        "base_url": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "enabled": True,
        "context_window": 64000,
    },
    {
        "id": "google",
        "provider_type": "google",
        "label": "Google",
        "api_key": "",
        "base_url": "https://generativelanguage.googleapis.com/v1",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "enabled": True,
        "context_window": 1000000,
    },
    {
        "id": "openrouter",
        "provider_type": "openai",
        "label": "OpenRouter",
        "api_key": "",
        "base_url": "https://openrouter.ai/api/v1",
        "models": ["openrouter/auto"],
        "enabled": True,
        "context_window": 128000,
    },
    {
        "id": "ollama",
        "provider_type": "ollama",
        "label": "Ollama (本地)",
        "api_key": "",
        "base_url": "http://localhost:11434/v1",
        "models": ["ollama/llama3"],
        "enabled": True,
        "context_window": 128000,
    },
]


# ═══════════════════════════════════════════════════════════════════════
# YAML 读写辅助
# ═══════════════════════════════════════════════════════════════════════


def _load_providers() -> list[dict[str, Any]]:
    """读取 yaml 中的 providers 列表。

    文件不存在/为空/解析失败 → 返回空列表（由调用方决定是否 fallback）。
    """
    raw = load_yaml(PROVIDERS_YAML_PATH, default=None)
    if not isinstance(raw, dict):
        return []
    items = raw.get("providers", [])
    return items if isinstance(items, list) else []


def _save_providers(items: list[dict[str, Any]]) -> None:
    """原子写入 providers 列表到 yaml。"""
    dump_yaml_atomic(PROVIDERS_YAML_PATH, {"providers": items})


def _find_provider(items: list[dict[str, Any]], provider_id: str) -> dict[str, Any] | None:
    """在已加载的列表中按 id 查找 provider。"""
    for entry in items:
        if entry.get("id") == provider_id:
            return entry
    return None


# ═══════════════════════════════════════════════════════════════════════
# Pydantic 请求体模型
# ═══════════════════════════════════════════════════════════════════════


class ProviderCreateBody(BaseModel):
    """创建 provider 的请求体（id 必填，其余可选，由后端补默认值）。"""

    id: str = Field(..., description="provider 唯一标识，不可重复")
    provider_type: str = Field("openai", description="provider 类型，默认 openai 兼容")
    label: str = Field("", description="显示名称")
    api_key: str = Field("", description="API 密钥")
    base_url: str = Field("", description="API 基础 URL")
    models: list[str] = Field(default_factory=list, description="支持的模型 id 列表")
    enabled: bool = Field(True, description="是否启用")
    context_window: int | None = Field(None, description="上下文窗口大小")


class ProviderUpdateBody(BaseModel):
    """更新 provider 的请求体（所有字段可选，仅更新提供字段）。"""

    provider_type: str | None = None
    label: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    enabled: bool | None = None
    context_window: int | None = None


# ═══════════════════════════════════════════════════════════════════════
# 端点 1: GET /providers
# ═══════════════════════════════════════════════════════════════════════


@router.get("/providers")
async def list_providers() -> dict[str, Any]:
    """返回所有已配置的 provider。

    yaml 文件不存在或 providers 为空时，返回硬编码默认列表（保持向后兼容，
    保证首次运行时前端 ChatInput 能看到可用 provider）。
    """
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        items = _load_providers()
    if not items:
        return {"providers": _DEFAULT_PROVIDERS}
    return {"providers": items}


# ═══════════════════════════════════════════════════════════════════════
# 端点 2: POST /providers (create)
# ═══════════════════════════════════════════════════════════════════════


@router.post("/providers")
async def create_provider(body: ProviderCreateBody) -> dict[str, Any]:
    """创建新的 provider 配置。

    - 校验 id 不重复（409）
    - 补全默认值（enabled=True, provider_type='openai', models=[]）
    - 原子写入 yaml
    - 返回完整 provider 对象
    """
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        items = _load_providers()
        if _find_provider(items, body.id) is not None:
            raise HTTPException(
                status_code=409,
                detail=f"provider id '{body.id}' 已存在",
            )
        provider: dict[str, Any] = {
            "id": body.id,
            "provider_type": body.provider_type,
            "label": body.label,
            "api_key": body.api_key,
            "base_url": body.base_url,
            "models": list(body.models),
            "enabled": body.enabled,
        }
        if body.context_window is not None:
            provider["context_window"] = body.context_window
        items.append(provider)
        _save_providers(items)
    return provider


# ═══════════════════════════════════════════════════════════════════════
# 端点 3: GET /providers/{id}
# ═══════════════════════════════════════════════════════════════════════


@router.get("/providers/{provider_id}")
async def get_provider(provider_id: str) -> dict[str, Any]:
    """获取指定 id 的 provider 详情。不存在返回 404。"""
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        items = _load_providers()
        target = _find_provider(items, provider_id)
    if target is None:
        raise HTTPException(
            status_code=404,
            detail=f"provider '{provider_id}' 不存在",
        )
    return target


# ═══════════════════════════════════════════════════════════════════════
# 端点 4: PUT /providers/{id}
# ═══════════════════════════════════════════════════════════════════════


@router.put("/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    body: ProviderUpdateBody,
) -> dict[str, Any]:
    """部分更新 provider 配置（仅更新提供的字段，id 不可改）。

    - 读取现有 provider（不存在 404）
    - 合并更新（exclude_unset 保证不覆盖未提供字段）
    - 原子写入 yaml
    - 返回更新后的 provider
    """
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        items = _load_providers()
        target = _find_provider(items, provider_id)
        if target is None:
            raise HTTPException(
                status_code=404,
                detail=f"provider '{provider_id}' 不存在",
            )
        update_fields = body.model_dump(exclude_unset=True)
        for key, value in update_fields.items():
            target[key] = value
        _save_providers(items)
    return target


# ═══════════════════════════════════════════════════════════════════════
# 端点 5: DELETE /providers/{id}
# ═══════════════════════════════════════════════════════════════════════


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str) -> dict[str, str]:
    """删除 provider 配置。不存在返回 404。"""
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        items = _load_providers()
        target = _find_provider(items, provider_id)
        if target is None:
            raise HTTPException(
                status_code=404,
                detail=f"provider '{provider_id}' 不存在",
            )
        new_items = [e for e in items if e.get("id") != provider_id]
        _save_providers(new_items)
    return {"status": "ok"}
