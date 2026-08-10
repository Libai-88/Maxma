"""chat_model.py — 浏览器模型/提供商选择 → sidecar 配置解析。

从 chat.py 拆分（S2-4）：保持 provider 解析逻辑独立可测，
chat.py 通过 `from api.routes.chat_model import _resolve_chat_model` 使用。
"""

from api.routes.providers import _decrypt_api_key, _find_provider, _load_providers
from api.yaml_store import yaml_file_lock
from app_paths import PROVIDERS_YAML_PATH
import logging

logger = logging.getLogger(__name__)


def _resolve_chat_model(provider_id: str, model_name: str) -> dict[str, str | int]:
    """Resolve the browser's provider/model selection for the sidecar."""
    requested_model = model_name.strip() or "gpt-4o"
    requested_provider = provider_id.strip()
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        provider = _find_provider(_load_providers(), requested_provider)

    if provider is None:
        logger.warning(
            "[model] Provider %r not found; falling back to openai/gpt-4o (empty credentials)",
            requested_provider,
        )
        return {
            "provider": requested_provider or "openai",
            "model": requested_model,
            "base_url": "",
            "api_key": "",
            "provider_type": "openai",
            "context_window": 128000,
        }

    models = provider.get("models")
    selected_model = requested_model
    if isinstance(models, list) and models and selected_model not in models:
        # 修复 MODEL-SILENT-SWAP-001：静默替换为列表首个模型时记录日志，
        # 避免"实际调用模型与 UI 显示不一致"无任何告警
        logger.warning(
            "[model] Requested model %r not in provider %r models; using %r",
            selected_model, requested_provider, models[0],
        )
        selected_model = str(models[0])
    # PROVIDER-FORM-001：provider 级默认输出上限（表单字段真实持久化后生效）
    provider_max_tokens = provider.get("max_tokens")
    return {
        "provider": str(provider.get("id") or requested_provider or "openai"),
        "model": selected_model,
        "base_url": str(provider.get("base_url") or ""),
        "api_key": _decrypt_api_key(provider.get("api_key")),
        "provider_type": str(provider.get("provider_type") or "openai"),
        "context_window": int(provider.get("context_window") or 128000),
        "max_tokens": int(provider_max_tokens) if isinstance(provider_max_tokens, (int, float)) and provider_max_tokens > 0 else None,
    }
