"""REST API — 人设文件 (SOUL.md / USER.md) 读写 + 多人格管理。"""

import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Literal

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import PERSONAS_DATA_DIR as PERSONAS_DIR
from api.yaml_store import yaml_file_lock
from agent.prompts import (
    get_active_persona_file,
    set_active_persona,
    list_personas as scan_personas,
    invalidate_prompt_cache,
)

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_TYPES = {"soul": "SOUL.md", "user": "USER.md"}
_PERSONA_FILENAME_RE = re.compile(r"^SOUL\.[\w\u4e00-\u9fff\-]+\.md$")


class PersonaResponse(BaseModel):
    content: str
    type: str


class PersonaUpdateRequest(BaseModel):
    content: str


class PersonaInfo(BaseModel):
    id: str
    file: str
    name: str
    description: str
    active: bool


class PersonaListResponse(BaseModel):
    personas: list[PersonaInfo]
    active_file: str


class SwitchPersonaRequest(BaseModel):
    file: str


class CreatePersonaRequest(BaseModel):
    name: str
    description: str = ""
    tools: str = ""
    # B-012: restrict memory mode to a known enum to prevent frontmatter
    # injection via arbitrary user-supplied strings.
    memory: Literal["shared", "persona", "isolated"] = "shared"


def _is_template_placeholder(text: str) -> bool:
    """判断 USER.md 的称呼值是否为未填写的模板占位符。

    USER.example.md 中的示例值形如：
    - 全角括号包裹的提示：``（Agent 对你的称呼）``、``（你的名字）``
    - 含"Agent"关键字的占位提示
    真实称呼（如"小美"）不含这些特征。命中返回 True，调用方应回退到"你"。
    """
    if not text:
        return True
    stripped = text.strip()
    # 全角括号包裹的模板提示（示例文件中的占位格式）
    if stripped.startswith("（") and stripped.endswith("）"):
        return True
    if stripped.startswith("(") and stripped.endswith(")"):
        return True
    # 英文占位关键字（旧模板 "Agent 对你的称呼"）
    if "agent" in stripped.lower():
        return True
    return False


def _get_persona_variant_path(variant: str) -> Path:
    """Return a verified custom SOUL file path.

    Keep this check shared by read, write, and activation endpoints.  Besides
    preventing traversal, it prevents a malformed active_persona.yaml from
    turning a normal SOUL page into an empty or unrelated file.
    """
    if not _PERSONA_FILENAME_RE.fullmatch(variant):
        raise HTTPException(status_code=400, detail="无效的人格文件名")
    path = PERSONAS_DIR / variant
    if not path.resolve().is_relative_to(PERSONAS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="非法路径")
    return path


def _write_text_atomically(path: Path, content: str) -> None:
    """Persist an editor update without exposing a partially written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with yaml_file_lock(path):
        fd, temp_name = tempfile.mkstemp(
            dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp", text=True
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)


@router.get("/persona", response_model=PersonaResponse)
async def get_persona(
    type: str = Query(..., description="soul 或 user"),
    variant: str | None = Query(None, description="指定人格文件名，如 SOUL.饱饱.md"),
):
    t = type.lower()
    if t not in VALID_TYPES:
        raise HTTPException(
            status_code=400, detail=f"无效 type: {type}，仅支持 soul/user"
        )
    if t == "soul" and variant:
        path = _get_persona_variant_path(variant)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"人格文件不存在: {variant}")
        content = path.read_text(encoding="utf-8")
        return PersonaResponse(content=content, type=t)
    path = PERSONAS_DIR / VALID_TYPES[t]
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    return PersonaResponse(content=content, type=t)


@router.put("/persona", response_model=PersonaResponse)
async def update_persona(
    type: str = Query(..., description="soul 或 user"),
    variant: str | None = Query(None, description="指定人格文件名，如 SOUL.饱饱.md"),
    body: PersonaUpdateRequest | None = None,
):
    if body is None:
        raise HTTPException(status_code=400, detail="请求体不能为空")
    t = type.lower()
    if t not in VALID_TYPES:
        raise HTTPException(
            status_code=400, detail=f"无效 type: {type}，仅支持 soul/user"
        )
    if t == "soul" and variant:
        path = _get_persona_variant_path(variant)
    else:
        path = PERSONAS_DIR / VALID_TYPES[t]
    try:
        _write_text_atomically(path, body.content)
    except OSError as exc:
        logger.exception("保存 %s 失败", path.name)
        raise HTTPException(status_code=500, detail="保存失败，请检查磁盘空间和目录权限") from exc
    invalidate_prompt_cache()
    return PersonaResponse(content=body.content, type=t)


@router.get("/personas", response_model=PersonaListResponse)
async def list_available_personas():
    """列出所有可用的内置人格。"""
    personas = scan_personas()
    return PersonaListResponse(
        personas=[PersonaInfo(**p) for p in personas],
        active_file=get_active_persona_file(),
    )


@router.put("/personas/active")
async def switch_active_persona(body: SwitchPersonaRequest):
    """切换当前活跃人格。"""
    path = _get_persona_variant_path(body.file) if body.file != "SOUL.md" else PERSONAS_DIR / body.file
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"人格文件不存在: {body.file}")
    set_active_persona(body.file)
    logger.info(f"切换人格: {body.file}")
    return {"status": "ok", "active_file": body.file}


@router.post("/personas")
async def create_new_persona(body: CreatePersonaRequest):
    """创建新人格文件。"""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="名称不能为空")

    # 安全校验：防止路径穿越
    import re
    if not re.match(r'^[\w\u4e00-\u9fff\-]+$', body.name.strip()):
        raise HTTPException(status_code=400, detail="名称只能包含字母、数字、中文、下划线和连字符")

    safe_name = body.name.strip().replace(" ", "_")
    filename = f"SOUL.{safe_name}.md"
    filepath = PERSONAS_DIR / filename

    # PERSONA-CREATE-001：check-then-act 与写入必须包在同一把锁内，
    # 且写入用临时文件 + os.replace 原子替换——此前 exists() 检查与
    # write_text 之间无锁（并发创建同名人格互相覆盖、均返回 201），
    # 直接截断写还会在崩溃时留下半截 SOUL.md。
    with yaml_file_lock(filepath):
        if filepath.exists():
            raise HTTPException(status_code=409, detail=f"人格文件已存在: {filename}")

        # B-011: normalize "isolated" → "persona" so that get_persona_memory_path's
        # `== "persona"` check matches regardless of which alias the client used.
        # This keeps the frontmatter value, memory file creation, and read-time
        # check all consistent — no silent fallthrough to shared memory.yaml.
        effective_memory = "persona" if body.memory == "isolated" else body.memory

        # B-012: build frontmatter as a dict and dump with yaml.safe_dump so that
        # special characters in description/tools/memory (quotes, newlines, colons,
        # etc.) are properly escaped. F-string interpolation allowed injection of
        # arbitrary keys (e.g. description='x"\nmemory: persona').
        fm_dict: dict[str, str] = {}
        if body.description:
            fm_dict["description"] = body.description
        if body.tools:
            fm_dict["tools"] = body.tools
        if effective_memory != "shared":
            fm_dict["memory"] = effective_memory

        fm_yaml = yaml.safe_dump(
            fm_dict, sort_keys=False, default_flow_style=False, allow_unicode=True
        ).strip()
        fm_block = f"---\n{fm_yaml}\n---\n\n" if fm_yaml else "---\n---\n\n"

        # 构建模板
        content_lines = [
            f"# {body.name}",
            "",
            "## 角色定义",
            f"你是 **{body.name}**。{body.description or '一个独特的 Agent 人格。'}",
            "",
            "## 性格特征",
            "（请在此处描述人格的性格特征、说话风格、行为模式等）",
            "",
            "## 说话风格",
            "（请在此处描述人格的语言风格、常用词汇、语气特点等）",
            "",
        ]

        full_content = fm_block + "\n".join(content_lines)
        filepath.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(
            dir=str(filepath.parent), prefix=f".{filepath.name}.", suffix=".tmp", text=True
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write(full_content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, filepath)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

        # 如果配置了独立记忆，创建空的记忆文件
        # 兼容前端 PersonaMemoryMode: 'shared' | 'isolated'（已归一化为 'persona'）
        if effective_memory == "persona":
            persona_id = filepath.stem
            memory_path = PERSONAS_DIR / f"memory_{persona_id}.yaml"
            if not memory_path.exists():
                _write_text_atomically(memory_path, "{}\n")

    invalidate_prompt_cache()
    logger.info(f"创建新人格: {filename}")

    return {
        "status": "created",
        "file": filename,
        "memory_mode": effective_memory,
        "tools": body.tools or "(全部)",
    }


# ── 人设删除 / 重命名（UX-SOUL-MANAGE-001：此前人设只能创建和切换，
# 误建的人设永久留在列表中） ──────────────────────────────

class RenamePersonaRequest(BaseModel):
    new_name: str


@router.delete("/personas/{file}")
async def delete_persona(file: str):
    """删除一个人格文件（含其独立记忆文件）。

    保护规则：内置 SOUL.md 不可删。若删除的是当前活跃人格，自动回退到
    默认 SOUL.md——UI 是"选择即切换"，任何人格被选中即成为当前，若禁止
    删除活跃人格将导致除 SOUL 外的人格永远无法删除（死锁）。
    """
    if not file or file == "SOUL.md":
        raise HTTPException(status_code=400, detail="内置默认人格不可删除")
    # 路径穿越防护
    import re as _re
    if not _re.match(r'^SOUL\.[\w\u4e00-\u9fff\-]+\.md$', file):
        raise HTTPException(status_code=400, detail="非法的人格文件名")

    path = _get_persona_variant_path(file) if file != "SOUL.md" else PERSONAS_DIR / file
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"人格文件不存在: {file}")

    was_active = get_active_persona_file() == file

    try:
        with yaml_file_lock(path):
            path.unlink()
        # 清理独立记忆文件（memory_{persona_id}.yaml）
        memory_path = PERSONAS_DIR / f"memory_{path.stem}.yaml"
        if memory_path.exists():
            with yaml_file_lock(memory_path):
                memory_path.unlink()
    except OSError as exc:
        logger.exception("删除人格 %s 失败", file)
        raise HTTPException(status_code=500, detail="删除失败，请检查文件权限") from exc

    # 删除的是活跃人格 → 回退默认（UI"选择即切换"，被删人格已不可再选）
    if was_active:
        set_active_persona("SOUL.md")

    invalidate_prompt_cache()
    logger.info("删除人格: %s", file)
    return {"status": "deleted", "file": file}


@router.put("/personas/{file}/rename")
async def rename_persona(file: str, body: RenamePersonaRequest):
    """重命名人格文件（保留内容与独立记忆归属）。"""
    if not file or file == "SOUL.md":
        raise HTTPException(status_code=400, detail="内置默认人格不可重命名")
    import re as _re
    if not _re.match(r'^SOUL\.[\w\u4e00-\u9fff\-]+\.md$', file):
        raise HTTPException(status_code=400, detail="非法的人格文件名")

    new_name = (body.new_name or "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="名称不能为空")
    if not _re.match(r'^[\w\u4e00-\u9fff\-]+$', new_name):
        raise HTTPException(status_code=400, detail="名称只能包含字母、数字、中文、下划线和连字符")
    new_name = new_name.replace(" ", "_")

    src = _get_persona_variant_path(file)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"人格文件不存在: {file}")

    new_filename = f"SOUL.{new_name}.md"
    dst = PERSONAS_DIR / new_filename
    if dst.exists():
        raise HTTPException(status_code=409, detail=f"人格文件已存在: {new_filename}")

    # ACTIVE-FOLLOW-RENAME-001：rename 前记录活跃状态——rename 后旧文件已
    # 不存在，get_active_persona_file() 会按防御逻辑回退到 SOUL.md，无法
    # 再据此判断"被重命名的人格是否活跃"。
    was_active = get_active_persona_file() == file

    try:
        with yaml_file_lock(src):
            # 文件内标题同步更新（# Name）
            text = src.read_text(encoding="utf-8")
            import re as _re2
            text = _re2.sub(r'^#\s+.+$', f'# {new_name}', text, count=1, flags=_re2.MULTILINE)
            src.write_text(text, encoding="utf-8")
            src.rename(dst)
    except OSError as exc:
        logger.exception("重命名人格 %s 失败", file)
        raise HTTPException(status_code=500, detail="重命名失败，请检查文件权限") from exc

    # 独立记忆文件跟随重命名（memory_SOUL.旧名.yaml → memory_SOUL.新名.yaml）
    old_memory = PERSONAS_DIR / f"memory_{src.stem}.yaml"
    new_memory = PERSONAS_DIR / f"memory_{dst.stem}.yaml"
    if old_memory.exists() and not new_memory.exists():
        try:
            with yaml_file_lock(old_memory):
                old_memory.rename(new_memory)
        except OSError:
            logger.warning("重命名人格记忆文件失败（忽略）: %s", old_memory)

    # 活跃人格指向更新（基于 rename 前记录的状态）
    if was_active:
        set_active_persona(new_filename)

    invalidate_prompt_cache()
    logger.info("重命名人格: %s → %s", file, new_filename)
    return {"status": "renamed", "file": new_filename}


@router.get("/persona/profile")
async def get_persona_profile():
    """返回当前活跃人格的展示信息（从 SOUL.md + USER.md 解析）。"""
    soul_path = PERSONAS_DIR / "SOUL.md"
    user_path = PERSONAS_DIR / "USER.md"

    name = "Maxma"
    description = "温暖体贴又有点调皮的大姐姐"
    scene = "吵闹的小公寓，窗外有一条马路"
    style = "playful · 直接 · 温暖"
    nickname = "你"
    greeting = "你来啦。"

    # Parse SOUL.md for name and description
    if soul_path.exists():
        text = soul_path.read_text("utf-8")
        m = re.search(r'^#\s+(.+)', text, re.MULTILINE)
        if m:
            name = m.group(1).strip()
        parts = re.split(r'\n#+\s+', text)
        if len(parts) > 0:
            lines = [l.strip() for l in parts[0].split('\n') if l.strip() and not l.startswith('#')]
            if lines:
                description = lines[0][:50]
        scene_m = re.search(r'默认居住在一个(.+?)(?:\n|$)', text)
        if scene_m:
            scene = scene_m.group(1).strip()
        style_hints = []
        for kw in ['playful', '直接', '温暖', '调皮', '可爱']:
            if kw.lower() in text.lower():
                style_hints.append(kw)
        if style_hints:
            style = ' · '.join(style_hints[:3])

    if user_path.exists():
        user_text = user_path.read_text("utf-8")
        nn = re.search(r'\*\*称呼\*\*\s*[：:]\s*(.+)', user_text)
        if nn:
            raw_nickname = nn.group(1).strip()
            # 模板占位符防御：seed 机制会把 USER.example.md 的字面内容复制为
            # USER.md，若用户尚未填写，称呼字段仍是"（Agent 对你的称呼）"这类
            # 占位提示。此时应回退到通用称呼"你"，而不是把占位符展示给用户
            #（曾导致首页 greeting 显示 "(Agent 对你的称呼)，你来啦"）。
            if _is_template_placeholder(raw_nickname):
                nickname = "你"
            else:
                nickname = raw_nickname

    greeting = f"{nickname}，你来啦。"

    return {
        "name": name,
        "description": description,
        "nickname": nickname,
        "scene": scene,
        "style": style,
        "greeting": greeting,
        "avatar": "✦",
    }
