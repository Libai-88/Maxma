"""Skills API — manage anthropic_skills/ directory.

Skill 是可复用的任务指令模板，存储为 {skill_dir}/SKILL.md。
- builtin skills 位于 ANTHROPIC_SKILLS_DIR（只读，打包内置）
- user skills 位于 SKILLS_DATA_DIR（可写，用户自定义）

合并扫描时 user 优先于 builtin（同名覆盖）。PUT 内置 skill 会将其提升到 user 目录。
支持启用/禁用（SKILL.md ↔ SKILL.md.disabled）。
"""
import re
import shutil

from fastapi import APIRouter, HTTPException

from app_paths import ANTHROPIC_SKILLS_DIR, SKILLS_DATA_DIR

router = APIRouter()

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)

# Skill ID/名称安全校验：仅允许字母、数字、下划线、连字符，
# 防止路径穿越（..、/、\、.）导致越权创建/删除/覆盖任意目录的文件。
_SKILL_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')


def _validate_skill_id(skill_id: str) -> None:
    """校验 Skill ID/名称，拒绝路径穿越和特殊字符。"""
    if not skill_id or not _SKILL_ID_RE.match(skill_id):
        raise HTTPException(
            status_code=400,
            detail="Skill 名称只能包含字母、数字、下划线和连字符",
        )


def _parse_frontmatter_fields(fm_text: str) -> dict[str, str]:
    """解析 frontmatter 键值对（name: "x" / description: "y"）。"""
    fields: dict[str, str] = {}
    for line in fm_text.split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            fields[key.strip()] = val.strip().strip("\"'")
    return fields


def _parse_skill_file(path) -> tuple[str, str]:
    """解析 SKILL.md，返回 (description, content)。

    兼容两种格式：
    1. frontmatter：---\\nname: "x"\\ndescription: "y"\\n---\\n\\ncontent
    2. 首行标题/纯文本：# description\\ncontent
    """
    text = path.read_text("utf-8")
    if text.startswith("---"):
        match = _FRONTMATTER_RE.match(text)
        if match:
            fm_text, content = match.group(1), match.group(2)
            desc = _parse_frontmatter_fields(fm_text).get("description", "")
            return desc, content.lstrip("\n")
    lines = text.split("\n", 1)
    desc = lines[0].lstrip("# ").strip() if lines else ""
    content = lines[1] if len(lines) > 1 else ""
    return desc, content


def _scan_skills(d, source: str) -> list[dict]:
    """扫描目录下所有 {name}/SKILL.md（或 .disabled），返回 SkillInfo 列表。"""
    if not d.exists() or not d.is_dir():
        return []
    result: list[dict] = []
    for entry in sorted(d.iterdir()):
        if not entry.is_dir():
            continue
        skill_file = entry / "SKILL.md"
        disabled_file = entry / "SKILL.md.disabled"
        if skill_file.exists():
            desc, _ = _parse_skill_file(skill_file)
            result.append({
                "id": entry.name,
                "name": entry.name,
                "description": desc,
                "path": str(skill_file),
                "source": source,
                "enabled": True,
            })
        elif disabled_file.exists():
            desc, _ = _parse_skill_file(disabled_file)
            result.append({
                "id": entry.name,
                "name": entry.name,
                "description": desc,
                "path": str(disabled_file),
                "source": source,
                "enabled": False,
            })
    return result


def _find_skill(skill_id: str) -> tuple[object, str, bool] | None:
    """查找 skill 文件，user 优先。返回 (path, source, enabled) 或 None。"""
    for d, source in [(SKILLS_DATA_DIR, "user"), (ANTHROPIC_SKILLS_DIR, "builtin")]:
        skill_file = d / skill_id / "SKILL.md"
        disabled_file = d / skill_id / "SKILL.md.disabled"
        if skill_file.exists():
            return skill_file, source, True
        if disabled_file.exists():
            return disabled_file, source, False
    return None


@router.get("/skills")
async def list_skills():
    """列出所有 skills，合并 builtin + user，按 id 去重（user 优先）。"""
    skills = _scan_skills(SKILLS_DATA_DIR, "user") + _scan_skills(
        ANTHROPIC_SKILLS_DIR, "builtin"
    )
    seen: set[str] = set()
    result: list[dict] = []
    for s in skills:
        if s["id"] not in seen:
            seen.add(s["id"])
            result.append(s)
    return {"skills": result}


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str):
    """获取单个 skill 详情（含 content），user 优先于 builtin。"""
    _validate_skill_id(skill_id)
    found = _find_skill(skill_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    skill_file, source, _enabled = found
    desc, content = _parse_skill_file(skill_file)
    return {
        "id": skill_id,
        "name": skill_id,
        "description": desc,
        "content": content,
        "source": source,
    }


@router.post("/skills")
async def create_skill(body: dict):
    """创建新 skill 到 user 目录。user 已存在则 409；允许覆盖 builtin 同名 skill。"""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    _validate_skill_id(name)
    skill_dir = SKILLS_DATA_DIR / name
    skill_file = skill_dir / "SKILL.md"
    if skill_file.exists():
        raise HTTPException(status_code=409, detail=f"Skill '{name}' 已存在")
    skill_dir.mkdir(parents=True, exist_ok=True)
    desc = body.get("description") or name
    content = body.get("content") or ""
    skill_file.write_text(f"# {desc}\n{content}", "utf-8")
    return {
        "id": name,
        "name": name,
        "description": desc,
        "content": content,
        "source": "user",
    }


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, body: dict):
    """更新 skill。部分字段更新，未提供则保留原值。builtin skill 提升到 user 目录。"""
    _validate_skill_id(skill_id)
    found = _find_skill(skill_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    found_path, found_source, _enabled = found

    old_desc, old_content = _parse_skill_file(found_path)
    new_desc = body.get("description", old_desc)
    new_content = body.get("content", old_content)

    # builtin skill 提升到 user 目录（不修改只读的 builtin）
    write_path = found_path
    if found_source == "builtin":
        write_dir = SKILLS_DATA_DIR / skill_id
        write_dir.mkdir(parents=True, exist_ok=True)
        write_path = write_dir / "SKILL.md"

    write_path.write_text(f"# {new_desc}\n{new_content}", "utf-8")
    return {"id": skill_id, "status": "ok"}


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str):
    """删除 user skill。builtin skill 不可删除（403）。"""
    _validate_skill_id(skill_id)
    skill_dir = SKILLS_DATA_DIR / skill_id
    skill_file = skill_dir / "SKILL.md"
    disabled_file = skill_dir / "SKILL.md.disabled"
    if skill_file.exists() or disabled_file.exists():
        shutil.rmtree(skill_dir, ignore_errors=True)
        return {"id": skill_id, "status": "ok"}
    # 检查 builtin
    for ext in ["SKILL.md", "SKILL.md.disabled"]:
        if (ANTHROPIC_SKILLS_DIR / skill_id / ext).exists():
            raise HTTPException(status_code=403, detail=f"内置 Skill '{skill_id}' 不可删除")
    raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")


@router.post("/skills/{name}/toggle")
async def toggle_skill(name: str):
    """切换 skill 的启用/禁用状态（SKILL.md ↔ SKILL.md.disabled）。

    builtin skill 位于只读目录，不能直接 rename：将其内容拷贝到
    user 目录的目标文件（toggle 后的状态），builtin 文件保持不动。
    后续 _find_skill 因 user 目录命中而不再回落到 builtin。
    """
    _validate_skill_id(name)
    found = _find_skill(name)
    if not found:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    found_path, found_source, enabled = found

    if found_source == "builtin":
        content = found_path.read_text("utf-8")
        user_dir = SKILLS_DATA_DIR / name
        user_dir.mkdir(parents=True, exist_ok=True)
        target_path = user_dir / ("SKILL.md.disabled" if enabled else "SKILL.md")
        target_path.write_text(content, "utf-8")
        return {"name": name, "enabled": not enabled}

    skill_dir = found_path.parent
    skill_path = skill_dir / "SKILL.md"
    disabled_path = skill_dir / "SKILL.md.disabled"
    if enabled:
        skill_path.rename(disabled_path)
        return {"name": name, "enabled": False}
    else:
        disabled_path.rename(skill_path)
        return {"name": name, "enabled": True}
