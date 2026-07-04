"""Tool: manage_env_vars — 通过自然语言管理环境变量。"""

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_error, format_success, register_tool


class ManageEnvVarsInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有变量）、set（设置/更新）、get（查看单个变量值）",
    )
    name: str = Field(default="", description="环境变量名称（如 ZHIPUAI_API_KEY、TAVILY_API_KEY）")
    value: str = Field(default="", description="环境变量的值（set 时必填）")


# 已知环境变量及其用途
_KNOWN_VARS = {
    "ZHIPUAI_API_KEY": "智谱 AI API 密钥（图片理解等功能）",
    "TODOIST_API_TOKEN": "Todoist API 令牌（待办事项集成）",
    "UAPIS_API_KEY": "UAPIS API 密钥",
    "AMAP_API_KEY": "高德地图 API 密钥（地图/导航功能）",
    "TAVILY_API_KEY": "Tavily API 密钥（网络搜索功能）",
}


def _mask_value(val: str) -> str:
    if not val:
        return "(未设置)"
    if len(val) <= 8:
        return "****"
    return val[:4] + "****" + val[-4:]


@register_tool
class ManageEnvVarsTool(ToolBase):
    name: str = "manage_env_vars"
    description: str = (
        "通过自然语言管理环境变量。支持查看、设置 API 密钥等操作。"
        "用户说'把 Tavily API key 设成 xxx'或'查看环境变量'时调用。"
        "[调用积极性: 用户提到配置 API key/环境变量时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ManageEnvVarsInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        name: str = "",
        value: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        if action == "list":
            import os
            from dotenv import dotenv_values
            env_vals = dotenv_values()
            items = []
            for var_name, description in _KNOWN_VARS.items():
                val = env_vals.get(var_name, os.environ.get(var_name, ""))
                items.append({
                    "name": var_name,
                    "description": description,
                    "value_masked": _mask_value(val),
                    "is_set": bool(val),
                })
            return format_success({"count": len(items), "variables": items})

        if action == "set":
            if not name:
                return format_error("name 不能为空")
            if not value:
                return format_error("value 不能为空")

            from app_paths import ENV_FILE_PATH
            from dotenv import set_key

            try:
                set_key(str(ENV_FILE_PATH), name, value)
            except Exception as e:
                return format_error(f"写入 .env 失败: {e}")

            # 重新加载 settings
            try:
                import importlib
                import config.settings
                importlib.reload(config.settings)
            except Exception:
                pass

            return format_success({
                "action": "set",
                "name": name,
                "value_masked": _mask_value(value),
                "message": f"已设置 {name}（值已脱敏显示）",
            })

        if action == "get":
            if not name:
                return format_error("name 不能为空")
            import os
            from dotenv import dotenv_values
            env_vals = dotenv_values()
            val = env_vals.get(name, os.environ.get(name, ""))
            if not val:
                return format_success({"name": name, "value": "(未设置)", "is_set": False})
            return format_success({
                "name": name,
                "value_masked": _mask_value(val),
                "is_set": True,
            })

        return format_error(f"未知操作: {action}，支持: list/set/get")
