"""Anthropic Skills & Macros & 内置工具列表 API — 含 CRUD。"""

import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app_paths import (
    ANTHROPIC_SKILLS_DIR,
    MACROS_DIR,
    SKILLS_DATA_DIR,
    MACROS_DATA_DIR,
    PERSONAS_DIR,
)

router = APIRouter()

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-][a-zA-Z0-9_\- .]{0,63}$")


def _invalidate_prompt_cache() -> None:
    """失效 system prompt 缓存，使新增/修改/删除的 Skill/Macro 立即生效。

    与 tool_manage_skills.py 保持一致：try/except 包裹，避免 import 失败导致 500。
    即便此调用失败，agent/prompts.py 的指纹机制仍会在下次 build_system_prompt 时
    通过文件哈希变化被动检测到改动并重建缓存。
    """
    try:
        from agent.prompts import invalidate_prompt_cache
        invalidate_prompt_cache()
    except Exception:
        pass


def _validate_id(value: str, label: str = "ID") -> str:
    """校验 ID 安全：仅允许字母数字、连字符、下划线、空格、点。"""
    v = value.strip()
    if not v:
        raise HTTPException(status_code=400, detail=f"{label} 不能为空")
    if not _SAFE_ID.match(v):
        raise HTTPException(
            status_code=400,
            detail=f"{label} 仅允许字母、数字、连字符、下划线、空格、点（首字符不能为空格或点，1-64 字符）",
        )
    if ".." in v or "/" in v or "\\" in v:
        raise HTTPException(status_code=400, detail=f"{label} 包含非法字符")
    return v


def _parse_frontmatter(text: str) -> dict[str, str]:
    """简易解析 YAML frontmatter，提取 name 和 description（支持多行 | 和 >）。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict[str, str] = {}
    lines = m.group(1).splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            if key in ("name", "description"):
                if val in ("|", ">"):
                    parts: list[str] = []
                    i += 1
                    while i < len(lines) and (
                        lines[i].startswith("  ") or lines[i].startswith("\t")
                    ):
                        parts.append(lines[i].strip())
                        i += 1
                    meta[key] = " ".join(parts)
                    continue
                else:
                    meta[key] = val.strip('"').strip("'")
        i += 1
    return meta


def _parse_frontmatter_full(text: str) -> dict[str, str]:
    """解析 YAML frontmatter 的所有字段（保留 version/author 等扩展字段）。

    与 _parse_frontmatter 不同：不限制字段名，但仅支持单行值（多行 | / > 仅取首行标识符）。
    用于 update 操作时保留原 frontmatter 的所有元数据。
    """
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict[str, str] = {}
    lines = m.group(1).splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            if val in ("|", ">"):
                # 多行值：合并后续缩进行
                parts: list[str] = []
                i += 1
                while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t")):
                    parts.append(lines[i].strip())
                    i += 1
                meta[key] = " ".join(parts) if parts else ""
                continue
            else:
                meta[key] = val.strip('"').strip("'")
        i += 1
    return meta


def _scan_skills_dir(base_dir: Path, source_label: str) -> list[dict[str, str]]:
    """扫描指定目录下的所有 SKILL.md。单个文件损坏不会影响其他文件。"""
    if not base_dir.is_dir():
        return []
    skills = []
    try:
        iter_paths = sorted(base_dir.rglob("SKILL.md"))
    except (OSError, RecursionError):
        return []
    for sk_path in iter_paths:
        try:
            content = sk_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(content)
        except (OSError, UnicodeDecodeError) as e:
            # 错误隔离：跳过损坏文件，不阻断整个列表
            print(f"[skills] 跳过损坏的 SKILL.md {sk_path}: {e}")
            continue
        rel = sk_path.relative_to(base_dir).parent
        name = meta.get("name", str(rel))
        description = meta.get("description", "")
        path_str = str(sk_path).replace("\\", "/")
        skills.append({
            "name": name,
            "description": description,
            "path": path_str,
            "source": source_label,
            "id": str(rel),
        })
    return skills


def _scan_macros_dir(base_dir: Path, source_label: str) -> list[dict[str, str]]:
    """扫描指定目录下的所有 MACRO.md。单个文件损坏不会影响其他文件。"""
    if not base_dir.is_dir():
        return []
    macros_list = []
    try:
        iter_paths = sorted(base_dir.rglob("MACRO.md"))
    except (OSError, RecursionError):
        return []
    for mp_path in iter_paths:
        try:
            content = mp_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(content)
        except (OSError, UnicodeDecodeError) as e:
            print(f"[skills] 跳过损坏的 MACRO.md {mp_path}: {e}")
            continue
        rel = mp_path.relative_to(base_dir).parent
        name = meta.get("name", str(rel))
        description = meta.get("description", "")
        path_str = str(mp_path).replace("\\", "/")
        macros_list.append({
            "name": name,
            "description": description,
            "path": path_str,
            "source": source_label,
            "id": str(rel),
        })
    return macros_list


def _dedup_by_canonical_path(items: list[dict[str, str]]) -> list[dict[str, str]]:
    """按 canonical path（resolve 后的绝对路径）去重。

    开发模式下 ANTHROPIC_SKILLS_DIR 与 SKILLS_DATA_DIR 可能指向同一物理目录，
    rglob 会扫描到同一文件两次。按 path resolve 去重可正确处理这种情况。
    与 agent/prompts.py 的 _scan_anthropic_skills 去重策略保持一致。
    """
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for item in items:
        try:
            canon = str(Path(item["path"]).resolve())
        except OSError:
            canon = item["path"]
        if canon in seen:
            continue
        seen.add(canon)
        result.append(item)
    return result


# ══════════════════════════════════════════════════════════════════════
# Skills CRUD
# ═══════════════════════════════════════════════════════════════════════


class SkillCreateBody(BaseModel):
    name: str
    description: str = ""
    content: str = ""


class SkillUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None


def _find_skill(skill_id: str) -> tuple[Path, str] | None:
    """查找 skill 目录，返回 (SKILL.md path, source_label)。"""
    for base, label in [(SKILLS_DATA_DIR, "user"), (ANTHROPIC_SKILLS_DIR, "builtin")]:
        p = base / skill_id / "SKILL.md"
        if p.exists():
            return p, label
    return None


@router.get("/skills")
async def list_skills():
    """扫描内置 + 用户自定义 skills，返回结构化列表。"""
    skills = _scan_skills_dir(ANTHROPIC_SKILLS_DIR, "builtin")
    skills += _scan_skills_dir(SKILLS_DATA_DIR, "user")
    skills = _dedup_by_canonical_path(skills)
    return {"skills": skills}


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str):
    """获取单个 skill 的完整内容。"""
    skill_id = _validate_id(skill_id, "Skill ID")
    result = _find_skill(skill_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    sk_path, source = result
    content = sk_path.read_text(encoding="utf-8")
    meta = _parse_frontmatter(content)
    return {
        "id": skill_id,
        "name": meta.get("name", skill_id),
        "description": meta.get("description", ""),
        "content": content,
        "source": source,
    }


@router.post("/skills")
async def create_skill(body: SkillCreateBody):
    """创建新的 user skill。"""
    safe_name = _validate_id(body.name, "Skill 名称")
    skill_dir = SKILLS_DATA_DIR / safe_name
    if skill_dir.exists():
        raise HTTPException(status_code=409, detail=f"Skill '{body.name}' 已存在")
    # 检查与内置 skill 的命名冲突（避免用户 skill 被静默遮蔽）
    builtin_path = ANTHROPIC_SKILLS_DIR / safe_name / "SKILL.md"
    if builtin_path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"内置 Skill '{body.name}' 已存在，请使用其他名称以避免冲突",
        )
    skill_dir.mkdir(parents=True, exist_ok=True)
    # 生成 SKILL.md 内容
    if body.content:
        content = body.content
    else:
        content = f"""---
name: {body.name}
description: {body.description}
---

# {body.name}

{body.description}

## 使用场景
- 当用户需要...

## 步骤
1. ...
2. ...

## 注意事项
- ...
"""
    sk_path = skill_dir / "SKILL.md"
    sk_path.write_text(content, encoding="utf-8")
    # 从实际写入的 content 解析 frontmatter，保证返回值与文件一致
    actual_meta = _parse_frontmatter(content)
    _invalidate_prompt_cache()
    return {
        "id": body.name,
        "name": actual_meta.get("name", body.name),
        "description": actual_meta.get("description", body.description),
        "source": "user",
    }


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, body: SkillUpdateBody):
    """更新 skill 内容。仅支持用户自定义 skills。"""
    skill_id = _validate_id(skill_id, "Skill ID")
    result = _find_skill(skill_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    sk_path, source = result
    if source == "builtin":
        raise HTTPException(
            status_code=400,
            detail="内置 skill 不可编辑，请复制到用户目录后修改",
        )
    content = sk_path.read_text(encoding="utf-8")
    if body.content is not None:
        content = body.content
    if body.name is not None or body.description is not None:
        # 保留原 frontmatter 的所有字段（如 version/author），仅更新 name/description
        meta = _parse_frontmatter_full(content)
        if body.name is not None:
            meta["name"] = body.name
        if body.description is not None:
            meta["description"] = body.description
        # 重建 frontmatter，保留所有字段
        fm_lines = [f"{k}: {v}" for k, v in meta.items()]
        body_text = re.sub(r"^---\s*\n.*?\n---", "---\n" + "\n".join(fm_lines) + "\n---", content, count=1, flags=re.DOTALL)
        content = body_text
    sk_path.write_text(content, encoding="utf-8")
    _invalidate_prompt_cache()
    return {"id": skill_id, "status": "updated"}


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str):
    """删除 skill 目录。仅支持用户自定义 skills。"""
    skill_id = _validate_id(skill_id, "Skill ID")
    result = _find_skill(skill_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' 不存在")
    sk_path, source = result
    if source == "builtin":
        raise HTTPException(
            status_code=400,
            detail="内置 skill 不可删除",
        )
    skill_dir = sk_path.parent
    try:
        shutil.rmtree(skill_dir)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"删除失败: {exc}")
    _invalidate_prompt_cache()
    return {"id": skill_id, "status": "deleted"}


# ═══════════════════════════════════════════════════════════════════════
# Macros CRUD
# ═══════════════════════════════════════════════════════════════════════


class MacroCreateBody(BaseModel):
    name: str
    description: str = ""
    content: str = ""


class MacroUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None


def _find_macro(macro_id: str) -> tuple[Path, str] | None:
    """查找 macro 目录，返回 (MACRO.md path, source_label)。"""
    for base, label in [(MACROS_DATA_DIR, "user"), (MACROS_DIR, "builtin")]:
        p = base / macro_id / "MACRO.md"
        if p.exists():
            return p, label
    return None


@router.get("/macros")
async def list_macros():
    """扫描内置 + 用户自定义 macros，返回结构化列表。"""
    macros_list = _scan_macros_dir(MACROS_DIR, "builtin")
    macros_list += _scan_macros_dir(MACROS_DATA_DIR, "user")
    macros_list = _dedup_by_canonical_path(macros_list)
    return {"macros": macros_list}


@router.get("/macros/{macro_id}")
async def get_macro(macro_id: str):
    """获取单个 macro 的完整内容。"""
    macro_id = _validate_id(macro_id, "Macro ID")
    result = _find_macro(macro_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Macro '{macro_id}' 不存在")
    mp_path, source = result
    content = mp_path.read_text(encoding="utf-8")
    meta = _parse_frontmatter(content)
    return {
        "id": macro_id,
        "name": meta.get("name", macro_id),
        "description": meta.get("description", ""),
        "content": content,
        "source": source,
    }


@router.post("/macros")
async def create_macro(body: MacroCreateBody):
    """创建新的 user macro。"""
    safe_name = _validate_id(body.name, "Macro 名称")
    macro_dir = MACROS_DATA_DIR / safe_name
    if macro_dir.exists():
        raise HTTPException(status_code=409, detail=f"Macro '{body.name}' 已存在")
    # 检查与内置 macro 的命名冲突
    builtin_path = MACROS_DIR / safe_name / "MACRO.md"
    if builtin_path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"内置 Macro '{body.name}' 已存在，请使用其他名称以避免冲突",
        )
    macro_dir.mkdir(parents=True, exist_ok=True)
    if body.content:
        content = body.content
    else:
        content = f"""---
name: {body.name}
description: {body.description}
---

# {body.name}

{body.description}

## 指令
...
"""
    mp_path = macro_dir / "MACRO.md"
    mp_path.write_text(content, encoding="utf-8")
    actual_meta = _parse_frontmatter(content)
    _invalidate_prompt_cache()
    return {
        "id": body.name,
        "name": actual_meta.get("name", body.name),
        "description": actual_meta.get("description", body.description),
        "source": "user",
    }


@router.put("/macros/{macro_id}")
async def update_macro(macro_id: str, body: MacroUpdateBody):
    """更新 macro 内容。仅支持用户自定义 macros。"""
    macro_id = _validate_id(macro_id, "Macro ID")
    result = _find_macro(macro_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Macro '{macro_id}' 不存在")
    mp_path, source = result
    if source == "builtin":
        raise HTTPException(status_code=400, detail="内置 macro 不可编辑")
    content = mp_path.read_text(encoding="utf-8")
    if body.content is not None:
        content = body.content
    if body.name is not None or body.description is not None:
        # 保留原 frontmatter 的所有字段
        meta = _parse_frontmatter_full(content)
        if body.name is not None:
            meta["name"] = body.name
        if body.description is not None:
            meta["description"] = body.description
        fm_lines = [f"{k}: {v}" for k, v in meta.items()]
        content = re.sub(
            r"^---\s*\n.*?\n---",
            "---\n" + "\n".join(fm_lines) + "\n---",
            content,
            count=1,
            flags=re.DOTALL,
        )
    mp_path.write_text(content, encoding="utf-8")
    _invalidate_prompt_cache()
    return {"id": macro_id, "status": "updated"}


@router.delete("/macros/{macro_id}")
async def delete_macro(macro_id: str):
    """删除 macro 目录。仅支持用户自定义 macros。"""
    macro_id = _validate_id(macro_id, "Macro ID")
    result = _find_macro(macro_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Macro '{macro_id}' 不存在")
    mp_path, source = result
    if source == "builtin":
        raise HTTPException(status_code=400, detail="内置 macro 不可删除")
    macro_dir = mp_path.parent
    try:
        shutil.rmtree(macro_dir)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"删除失败: {exc}")
    _invalidate_prompt_cache()
    return {"id": macro_id, "status": "deleted"}


# ═══════════════════════════════════════════════════════════════════════
# 内置工具列表
# ═══════════════════════════════════════════════════════════════════════


@router.get("/tools")
async def list_tools(request: Request):
    """返回所有已加载的 Python 内置工具（native_tools + mcp_tools）。"""
    tools = getattr(request.app.state, "tools", [])
    return {"tools": [{"name": t.name, "description": t.description} for t in tools]}
