"""Tool: manage_macros — 通过自然语言管理宏（Macros）。"""

import re
import shutil

from pydantic import BaseModel, Field

from app_paths import MACROS_DIR, MACROS_DATA_DIR
from tools.base import ToolBase, format_error, format_success

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-][a-zA-Z0-9_\- .]{0,63}$")


def _valid_id(value: str) -> str | None:
    """校验 ID，返回清洗后的值或 None（无效时）。"""
    v = value.strip()
    if not v or not _SAFE_ID.match(v) or ".." in v or "/" in v or "\\" in v:
        return None
    return v


class ManageMacrosInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有宏）、get（查看详情）、create（创建）、update（更新）、delete（删除）",
    )
    macro_id: str = Field(default="", description="宏 ID（get/update/delete 时必填）")
    name: str = Field(default="", description="宏名称（create 时必填，小写字母+连字符）")
    description: str = Field(default="", description="宏描述")
    content: str = Field(default="", description="MACRO.md 完整内容（create/update 时使用）")


def _parse_frontmatter(text: str) -> dict[str, str]:
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict[str, str] = {}
    lines = m.group(1).splitlines()
    for line in lines:
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in ("name", "description"):
                meta[key] = val
    return meta


def _scan_macros_dir(base_dir, source_label: str) -> list[dict]:
    if not base_dir.is_dir():
        return []
    macros_list = []
    for mp_path in sorted(base_dir.rglob("MACRO.md")):
        rel = mp_path.relative_to(base_dir).parent
        meta = _parse_frontmatter(mp_path.read_text(encoding="utf-8"))
        macros_list.append({
            "id": str(rel),
            "name": meta.get("name", str(rel)),
            "description": meta.get("description", ""),
            "source": source_label,
        })
    return macros_list


def _find_macro(macro_id: str):
    """查找 macro，返回 (MACRO.md path, source_label) 或 None。"""
    for base, label in [(MACROS_DATA_DIR, "user"), (MACROS_DIR, "builtin")]:
        p = base / macro_id / "MACRO.md"
        if p.exists():
            return p, label
    return None


def _invalidate_prompt_cache():
    try:
        from agent.prompts import invalidate_prompt_cache
        invalidate_prompt_cache()
    except Exception:
        pass


class ManageMacrosTool(ToolBase):
    name: str = "manage_macros"
    description: str = (
        "管理宏（Macros）：列出、查看、创建、更新、删除宏。"
        "宏是可复用的指令片段，可嵌入到对话或 Skill 中。"
        "[调用积极性: 当用户要求创建/管理可复用指令片段或宏时主动调用]"
    )
    args_schema: type[BaseModel] = ManageMacrosInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        macro_id: str = "",
        name: str = "",
        description: str = "",
        content: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        action = action.strip().lower()

        if action == "list":
            macros_list = _scan_macros_dir(MACROS_DIR, "builtin")
            macros_list += _scan_macros_dir(MACROS_DATA_DIR, "user")
            if not macros_list:
                return format_success({"message": "当前没有任何宏", "macros": []})
            summary = []
            for m in macros_list:
                tag = "内置" if m["source"] == "builtin" else "自定义"
                summary.append(f"- [{tag}] {m['id']}: {m['description'] or '(无描述)'}")
            return format_success({
                "message": f"共 {len(macros_list)} 个宏",
                "macros": macros_list,
                "summary": "\n".join(summary),
            })

        if action == "get":
            if not macro_id:
                return format_error("macro_id 不能为空")
            macro_id = _valid_id(macro_id)
            if macro_id is None:
                return format_error("macro_id 格式不合法，仅允许字母、数字、连字符、下划线")
            result = _find_macro(macro_id)
            if result is None:
                return format_error(f"宏 '{macro_id}' 不存在")
            mp_path, source = result
            full_content = mp_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(full_content)
            return format_success({
                "id": macro_id,
                "name": meta.get("name", macro_id),
                "description": meta.get("description", ""),
                "source": source,
                "content": full_content,
            })

        if action == "create":
            target_name = name or macro_id
            if not target_name:
                return format_error("name 不能为空，请指定宏名称")
            target_name = _valid_id(target_name)
            if target_name is None:
                return format_error("名称格式不合法，仅允许字母、数字、连字符、下划线（1-64 字符）")
            macro_dir = MACROS_DATA_DIR / target_name
            if macro_dir.exists():
                return format_error(f"宏 '{target_name}' 已存在")
            macro_dir.mkdir(parents=True, exist_ok=True)

            if content:
                final_content = content
            else:
                final_content = f"""---
name: {target_name}
description: {description}
---

# {target_name}

{description}

## 指令
...
"""
            mp_path = macro_dir / "MACRO.md"
            mp_path.write_text(final_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已创建宏 '{target_name}'",
                "id": target_name,
            })

        if action == "update":
            if not macro_id:
                return format_error("macro_id 不能为空")
            macro_id = _valid_id(macro_id)
            if macro_id is None:
                return format_error("macro_id 格式不合法")
            result = _find_macro(macro_id)
            if result is None:
                return format_error(f"宏 '{macro_id}' 不存在")
            mp_path, source = result
            if source == "builtin":
                return format_error("内置宏不可编辑")
            if content:
                mp_path.write_text(content, encoding="utf-8")
            elif description:
                old_content = mp_path.read_text(encoding="utf-8")
                meta = _parse_frontmatter(old_content)
                meta["description"] = description
                fm_lines = [f"{k}: {v}" for k, v in meta.items()]
                new_content = re.sub(
                    r"^---\s*\n.*?\n---",
                    "---\n" + "\n".join(fm_lines) + "\n---",
                    old_content,
                    count=1,
                    flags=re.DOTALL,
                )
                mp_path.write_text(new_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已更新宏 '{macro_id}'",
                "id": macro_id,
            })

        if action == "delete":
            if not macro_id:
                return format_error("macro_id 不能为空")
            macro_id = _valid_id(macro_id)
            if macro_id is None:
                return format_error("macro_id 格式不合法")
            result = _find_macro(macro_id)
            if result is None:
                return format_error(f"宏 '{macro_id}' 不存在")
            mp_path, source = result
            if source == "builtin":
                return format_error("内置宏不可删除")
            macro_dir = mp_path.parent
            try:
                shutil.rmtree(macro_dir)
            except OSError as exc:
                return format_error(f"删除失败: {exc}")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已删除宏 '{macro_id}'",
                "id": macro_id,
            })

        return format_error(f"未知操作: {action}，支持 list/get/create/update/delete")
