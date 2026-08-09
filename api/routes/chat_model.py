"""chat_model.py — 浏览器模型/提供商选择 → sidecar 配置解析。

从 chat.py 拆分（S2-4）：保持 provider 解析逻辑独立可测，
chat.py 通过 `from api.routes.chat_model import _resolve_chat_model` 使用。
"""

from api.routes.providers import _decrypt_api_key, _find_provider, _load_providers
from api.yaml_store import yaml_file_lock
from app_paths import PROVIDERS_YAML_PATH


def _resolve_chat_model(provider_id: str, model_name: str) -> dict[str, str | int]:
    """Resolve the browser's provider/model selection for the sidecar."""
    requested_model = model_name.strip() or "gpt-4o"
    requested_provider = provider_id.strip()
    with yaml_file_lock(PROVIDERS_YAML_PATH):
        provider = _find_provider(_load_providers(), requested_provider)

    if provider is None:
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
        selected_model = str(models[0])
    return {
        "provider": str(provider.get("id") or requested_provider or "openai"),
        "model": selected_model,
        "base_url": str(provider.get("base_url") or ""),
        "api_key": _decrypt_api_key(provider.get("api_key")),
        "provider_type": str(provider.get("provider_type") or "openai"),
        "context_window": int(provider.get("context_window") or 128000),
    }
