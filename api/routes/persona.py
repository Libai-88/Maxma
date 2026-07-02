"""REST API — 人设文件 (SOUL.md / USER.md) 读写 + 多人格管理。"""

import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app_paths import PERSONAS_DATA_DIR as PERSONAS_DIR
from agent.prompts import (
    get_active_persona_file,
    set_active_persona,
    list_personas as scan_personas,
    invalidate_prompt_cache,
)

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_TYPES = {"soul": "SOUL.md", "user": "USER.md"}


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
    memory: str = "shared"


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
        # 安全校验：防止路径穿越
        import re
        if not re.match(r'^SOUL\.[\w\u4e00-\u9fff\-]+\.md$', variant):
            raise HTTPException(status_code=400, detail="无效的人格文件名")
        path = PERSONAS_DIR / variant
        # 二次校验：确保路径在 PERSONAS_DIR 内
        if not path.resolve().is_relative_to(PERSONAS_DIR.resolve()):
            raise HTTPException(status_code=400, detail="非法路径")
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
        import re
        if not re.match(r'^SOUL\.[\w\u4e00-\u9fff\-]+\.md$', variant):
            raise HTTPException(status_code=400, detail="无效的人格文件名")
        path = PERSONAS_DIR / variant
        if not path.resolve().is_relative_to(PERSONAS_DIR.resolve()):
            raise HTTPException(status_code=400, detail="非法路径")
    else:
        path = PERSONAS_DIR / VALID_TYPES[t]
    path.write_text(body.content, encoding="utf-8")
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
    # 验证文件存在
    path = PERSONAS_DIR / body.file
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

    if filepath.exists():
        raise HTTPException(status_code=409, detail=f"人格文件已存在: {filename}")

    # 构建 frontmatter
    fm_lines = ["---"]
    if body.description:
        fm_lines.append(f'description: "{body.description}"')
    if body.tools:
        fm_lines.append(f"tools: {body.tools}")
    if body.memory and body.memory != "shared":
        fm_lines.append(f"memory: {body.memory}")
    fm_lines.append("---")
    fm_lines.append("")

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

    full_content = "\n".join(fm_lines + content_lines)
    filepath.write_text(full_content, encoding="utf-8")

    # 如果配置了独立记忆，创建空的记忆文件
    if body.memory == "persona":
        persona_id = filepath.stem
        memory_path = PERSONAS_DIR / f"memory_{persona_id}.yaml"
        if not memory_path.exists():
            memory_path.write_text("{}\n", encoding="utf-8")

    invalidate_prompt_cache()
    logger.info(f"创建新人格: {filename}")

    return {
        "status": "created",
        "file": filename,
        "memory_mode": body.memory,
        "tools": body.tools or "(全部)",
    }
