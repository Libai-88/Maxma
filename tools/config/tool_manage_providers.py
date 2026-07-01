"""Tool: manage_providers — 通过自然语言管理 LLM 提供商配置。"""

import yaml
from pydantic import BaseModel, Field

from app_paths import PROVIDERS_YAML_PATH
from tools.base import ToolBase, format_error, format_success


class ManageProvidersInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有提供商）、add（添加）、remove（删除）、enable（启用）、disable（停用）、test（测试连接）",
    )
    provider_id: str = Field(default="", description="提供商 ID（add/remove/enable/disable/test 时必填）")
    label: str = Field(default="", description="显示名称（如 'DeepSeek'、'OpenAI'）")
    base_url: str = Field(default="", description="API 基础 URL")
    api_key: str = Field(default="", description="API 密钥")
    model: str = Field(default="", description="默认模型名称")
    context_window: int = Field(default=128000, description="上下文窗口大小（token 数）")


def _load_raw() -> list[dict]:
    if not PROVIDERS_YAML_PATH.exists():
        return []
    with open(PROVIDERS_YAML_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return raw.get("providers", []) or []


def _save_raw(providers: list[dict]) -> None:
    PROVIDERS_YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PROVIDERS_YAML_PATH, "w", encoding="utf-8") as f:
        yaml.dump(
            {"providers": providers},
            f,
            allow_unicode=True,
            default_flow_style=False,
        )


def _mask_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return key[:4] + "****" + key[-4:]


class ManageProvidersTool(ToolBase):
    name: str = "manage_providers"
    description: str = (
        "通过自然语言管理 LLM 提供商配置。支持添加、删除、启用/停用、测试连接等操作。"
        "用户说'帮我加一个 DeepSeek 的 API'或'切换到 OpenAI'时调用。"
        "[调用积极性: 用户提到配置模型/提供商/API 时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ManageProvidersInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        provider_id: str = "",
        label: str = "",
        base_url: str = "",
        api_key: str = "",
        model: str = "",
        context_window: int = 128000,
    ) -> str:
        if get_doc:
            return self._load_doc()

        providers = _load_raw()

        if action == "list":
            if not providers:
                return format_success({"count": 0, "providers": [], "message": "尚未配置任何 LLM 提供商"})
            items = []
            for p in providers:
                items.append({
                    "id": p.get("id", ""),
                    "label": p.get("label", ""),
                    "base_url": p.get("base_url", ""),
                    "api_key_masked": _mask_key(p.get("api_key", "")),
                    "model": p.get("default_model", ""),
                    "enabled": p.get("enabled", True),
                    "context_window": p.get("context_window", 128000),
                })
            return format_success({"count": len(items), "providers": items})

        if action == "add":
            if not provider_id:
                return format_error("provider_id 不能为空")
            if not api_key:
                return format_error("api_key 不能为空")
            # 检查重复
            if any(p.get("id") == provider_id for p in providers):
                return format_error(f"提供商 {provider_id} 已存在，请使用其他 ID 或先删除旧的")
            new_entry = {
                "id": provider_id,
                "label": label or provider_id,
                "base_url": base_url,
                "api_key": api_key,
                "default_model": model or "",
                "context_window": context_window,
                "enabled": True,
            }
            providers.append(new_entry)
            _save_raw(providers)
            return format_success({
                "action": "added",
                "provider_id": provider_id,
                "message": f"已添加提供商 {label or provider_id}",
            })

        if action == "remove":
            if not provider_id:
                return format_error("provider_id 不能为空")
            original_len = len(providers)
            providers = [p for p in providers if p.get("id") != provider_id]
            if len(providers) == original_len:
                return format_error(f"未找到提供商 {provider_id}")
            _save_raw(providers)
            return format_success({"action": "removed", "provider_id": provider_id})

        if action in ("enable", "disable"):
            if not provider_id:
                return format_error("provider_id 不能为空")
            target = None
            for p in providers:
                if p.get("id") == provider_id:
                    target = p
                    break
            if not target:
                return format_error(f"未找到提供商 {provider_id}")
            target["enabled"] = (action == "enable")
            _save_raw(providers)
            return format_success({"action": action, "provider_id": provider_id})

        if action == "test":
            if not provider_id:
                return format_error("provider_id 不能为空")
            target = None
            for p in providers:
                if p.get("id") == provider_id:
                    target = p
                    break
            if not target:
                return format_error(f"未找到提供商 {provider_id}")
            # 简单测试：检查 API key 和 URL 是否非空
            if not target.get("api_key"):
                return format_error("API key 未配置")
            if not target.get("base_url"):
                return format_error("base_url 未配置")
            return format_success({
                "action": "test",
                "provider_id": provider_id,
                "message": "配置检查通过（完整连接测试需重启服务）",
            })

        return format_error(f"未知操作: {action}，支持: list/add/remove/enable/disable/test")
