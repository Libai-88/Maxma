"""Provider 管理端点 — CRUD + 连接测试 + 模型发现。

存储：`app_paths.PROVIDERS_YAML_PATH` 指向的 YAML 文件（`providers: [...]`）。
首次运行（文件不存在或为空）时 `GET /providers` 返回硬编码默认列表，保持向后兼容。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

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
