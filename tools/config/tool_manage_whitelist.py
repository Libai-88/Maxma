"""Tool: manage_whitelist — 通过自然语言管理路径白名单。"""

import os

import yaml
from pydantic import BaseModel, Field

from app_paths import PATH_WHITELIST_YAML_PATH
from tools.base import ToolBase, format_error, format_success, register_tool


class ManageWhitelistInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有白名单）、add（添加路径）、remove（移除路径）",
    )
    path: str = Field(default="", description="文件系统路径（add/remove 时必填）")
    description: str = Field(default="", description="路径描述（可选，add 时使用）")
    recursive: bool = Field(default=True, description="是否递归包含子目录")


def _load_raw() -> list[dict]:
    if not PATH_WHITELIST_YAML_PATH.exists():
        return []
    with open(PATH_WHITELIST_YAML_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    entries = raw.get("whitelist", []) or []
    # 兼容旧条目（无 recursive 字段默认为 True）
    for e in entries:
        if "recursive" not in e:
            e["recursive"] = True
    return entries


def _save_raw(entries: list[dict]) -> None:
    PATH_WHITELIST_YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PATH_WHITELIST_YAML_PATH, "w", encoding="utf-8") as f:
        yaml.dump(
            {"whitelist": entries},
            f,
            allow_unicode=True,
            default_flow_style=False,
        )


@register_tool
class ManageWhitelistTool(ToolBase):
    name: str = "manage_whitelist"
    description: str = (
        "通过自然语言管理本地路径白名单。Agent 只能访问白名单中的路径。"
        "用户说'允许访问 D:/Projects 目录'或'查看路径白名单'时调用。"
        "[调用积极性: 用户提到允许/禁止访问某路径时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ManageWhitelistInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        path: str = "",
        description: str = "",
        recursive: bool = True,
    ) -> str:
        if get_doc:
            return self._load_doc()

        entries = _load_raw()

        if action == "list":
            if not entries:
                return format_success({"count": 0, "entries": [], "message": "路径白名单为空"})
            return format_success({"count": len(entries), "entries": entries})

        if action == "add":
            if not path:
                return format_error("path 不能为空")
            normalized = os.path.normpath(path)
            # 检查重复
            for e in entries:
                if os.path.normpath(e.get("path", "")) == normalized:
                    return format_error(f"路径 {normalized} 已在白名单中")
            new_entry = {
                "path": normalized,
                "description": description or normalized,
                "recursive": recursive,
            }
            entries.append(new_entry)
            _save_raw(entries)
            return format_success({
                "action": "added",
                "path": normalized,
                "message": f"已添加路径白名单: {normalized}",
            })

        if action == "remove":
            if not path:
                return format_error("path 不能为空")
            normalized = os.path.normpath(path)
            original_len = len(entries)
            entries = [e for e in entries if os.path.normpath(e.get("path", "")) != normalized]
            if len(entries) == original_len:
                return format_error(f"未找到路径 {normalized} 在白名单中")
            _save_raw(entries)
            return format_success({"action": "removed", "path": normalized})

        return format_error(f"未知操作: {action}，支持: list/add/remove")
