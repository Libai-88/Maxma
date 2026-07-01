"""Tool: manage_skills — 通过自然语言管理 Skills（技能）。"""

import re
import shutil

from pydantic import BaseModel, Field

from app_paths import ANTHROPIC_SKILLS_DIR, SKILLS_DATA_DIR
from tools.base import ToolBase, format_error, format_success

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-][a-zA-Z0-9_\- .]{0,63}$")


def _valid_id(value: str) -> str | None:
    """校验 ID，返回清洗后的值或 None（无效时）。"""
    v = value.strip()
    if not v or not _SAFE_ID.match(v) or ".." in v or "/" in v or "\\" in v:
        return None
    return v


class ManageSkillsInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出所有 Skills）、get（查看详情）、create（创建）、update（更新）、delete（删除）",
    )
    skill_id: str = Field(default="", description="Skill ID（get/update/delete 时必填）")
    name: str = Field(default="", description="Skill 名称（create 时必填，小写字母+连字符）")
    description: str = Field(default="", description="Skill 描述")
    content: str = Field(default="", description="SKILL.md 完整内容（create/update 时使用）")


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


def _scan_skills_dir(base_dir, source_label: str) -> list[dict]:
    if not base_dir.is_dir():
        return []
    skills = []
    for sk_path in sorted(base_dir.rglob("SKILL.md")):
        rel = sk_path.relative_to(base_dir).parent
        meta = _parse_frontmatter(sk_path.read_text(encoding="utf-8"))
        skills.append({
            "id": str(rel),
            "name": meta.get("name", str(rel)),
            "description": meta.get("description", ""),
            "source": source_label,
        })
    return skills


def _find_skill(skill_id: str):
    """查找 skill，返回 (SKILL.md path, source_label) 或 None。"""
    for base, label in [(SKILLS_DATA_DIR, "user"), (ANTHROPIC_SKILLS_DIR, "builtin")]:
        p = base / skill_id / "SKILL.md"
        if p.exists():
            return p, label
    return None


def _invalidate_prompt_cache():
    """失效 system prompt 缓存，使新 Skill 出现在提示词中。"""
    try:
        from agent.prompts import invalidate_prompt_cache
        invalidate_prompt_cache()
    except Exception:
        pass


class ManageSkillsTool(ToolBase):
    name: str = "manage_skills"
    description: str = (
        "管理 Skills（技能）：列出、查看、创建、更新、删除 Skill。"
        "Skill 是可复用的任务指令模板，Maxma 在需要时自动读取并遵循。"
        "[调用积极性: 当用户要求创建/管理技能、任务模板、或标准化流程时主动调用]"
    )
    args_schema: type[BaseModel] = ManageSkillsInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        skill_id: str = "",
        name: str = "",
        description: str = "",
        content: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        action = action.strip().lower()

        if action == "list":
            skills = _scan_skills_dir(ANTHROPIC_SKILLS_DIR, "builtin")
            skills += _scan_skills_dir(SKILLS_DATA_DIR, "user")
            if not skills:
                return format_success({"message": "当前没有任何 Skill", "skills": []})
            summary = []
            for s in skills:
                tag = "内置" if s["source"] == "builtin" else "自定义"
                summary.append(f"- [{tag}] {s['id']}: {s['description'] or '(无描述)'}")
            return format_success({
                "message": f"共 {len(skills)} 个 Skill",
                "skills": skills,
                "summary": "\n".join(summary),
            })

        if action == "get":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法，仅允许字母、数字、连字符、下划线")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            full_content = sk_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(full_content)
            return format_success({
                "id": skill_id,
                "name": meta.get("name", skill_id),
                "description": meta.get("description", ""),
                "source": source,
                "content": full_content,
            })

        if action == "create":
            target_name = name or skill_id
            if not target_name:
                return format_error("name 不能为空，请指定 Skill 名称")
            target_name = _valid_id(target_name)
            if target_name is None:
                return format_error("名称格式不合法，仅允许字母、数字、连字符、下划线（1-64 字符）")
            skill_dir = SKILLS_DATA_DIR / target_name
            if skill_dir.exists():
                return format_error(f"Skill '{target_name}' 已存在")
            skill_dir.mkdir(parents=True, exist_ok=True)

            if content:
                final_content = content
            else:
                final_content = f"""---
name: {target_name}
description: {description}
---

# {target_name}

{description}

## 使用场景
- 当用户需要...

## 步骤
1. ...
2. ...

## 注意事项
- ...
"""
            sk_path = skill_dir / "SKILL.md"
            sk_path.write_text(final_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已创建 Skill '{target_name}'",
                "id": target_name,
            })

        if action == "update":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            if source == "builtin":
                return format_error("内置 Skill 不可编辑，请创建一个新的自定义 Skill")
            if content:
                sk_path.write_text(content, encoding="utf-8")
            elif description:
                old_content = sk_path.read_text(encoding="utf-8")
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
                sk_path.write_text(new_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已更新 Skill '{skill_id}'",
                "id": skill_id,
            })

        if action == "delete":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            if source == "builtin":
                return format_error("内置 Skill 不可删除")
            skill_dir = sk_path.parent
            try:
                shutil.rmtree(skill_dir)
            except OSError as exc:
                return format_error(f"删除失败: {exc}")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已删除 Skill '{skill_id}'",
                "id": skill_id,
            })

        return format_error(f"未知操作: {action}，支持 list/get/create/update/delete")
