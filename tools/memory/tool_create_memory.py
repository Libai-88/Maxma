"""Tool: create_memory — 添加一条新记忆条目（支持多层级）。"""

from typing import Optional

from pydantic import BaseModel, Field

from app_paths import (
    EPISODIC_MEMORY_PATH,
    MEMORY_CONFIG_PATH as MEMORY_PATH,
    SEMANTIC_MEMORY_PATH,
)
from memory.memory_manager import MAX_DESC_LENGTH
from tools.base import ToolBase, format_error, format_success, register_tool


class CreateMemoryInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    layer: str = Field(
        default="long",
        description="记忆层级：long=长期记忆（默认）/episodic=情景记忆/semantic=语义记忆",
    )
    content: str = Field(
        default="",
        description="记忆内容。long 层：用第三人称中文描述用户的一个事实；"
        "episodic 层：对话摘要文本",
    )
    section: str = Field(
        default="",
        description="记忆分区（仅 long 层需要），如「身份」「音乐」「品味」「地点与路径」「瞬间」「时效待办」，也可创建新分区（1-4字中文名词）",
    )
    subject: str = Field(
        default="",
        description="语义记忆主体（仅 semantic 层），如「用户」",
    )
    predicate: str = Field(
        default="",
        description="语义记忆谓词（仅 semantic 层），如「喜欢」",
    )
    object: str = Field(
        default="",
        description="语义记忆客体（仅 semantic 层），如「古典音乐」",
    )
    ttl: Optional[int] = Field(
        default=None,
        description="可选 TTL（秒），过期后自动清理。None=永久；建议「瞬间」分区设 86400（1 天）、「时效待办」按截止日期设值",
    )


@register_tool
class CreateMemoryTool(ToolBase):
    name: str = "create_memory"
    description: str = (
        "添加一条新记忆条目。支持 layer 参数选择层级："
        "long=长期记忆（默认，需 content+section）/"
        "episodic=情景记忆（需 content 作为摘要）/"
        "semantic=语义记忆（需 subject+predicate+object）。"
        "返回该条目的唯一 ID。"
        "[调用积极性: 绝对不要在用户没有提及该工具名时使用|仅在用户引用或提及时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = CreateMemoryInput

    def _run(
        self,
        get_doc: bool = False,
        layer: str = "long",
        content: str = "",
        section: str = "",
        subject: str = "",
        predicate: str = "",
        object: str = "",
        ttl: Optional[int] = None,
    ) -> str:
        if get_doc:
            return self._load_doc()

        layer = (layer or "long").lower()
        if layer == "long":
            return self._create_long(content, section, ttl)
        elif layer == "episodic":
            return self._create_episodic(content, ttl)
        elif layer == "semantic":
            return self._create_semantic(subject, predicate, object, ttl)
        return format_error(f"不支持的 layer: {layer}（可选：long/episodic/semantic）")

    def _create_long(
        self, content: str, section: str, ttl: Optional[int]
    ) -> str:
        if not content:
            return format_error("content 不能为空，请提供记忆内容")
        if len(content) > MAX_DESC_LENGTH:
            return format_error(
                f"记忆内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字），"
                f"请精简至 {MAX_DESC_LENGTH} 字以内，避免列举。"
            )
        if not section:
            return format_error("section 不能为空，请指定记忆分区")

        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        new_id = mm.add(description=content, theme=section, ttl=ttl)
        return format_success(
            {
                "id": new_id,
                "layer": "long",
                "content": content,
                "section": section,
                "ttl": ttl,
                "message": f"已创建长期记忆 [{new_id}] ({section}): {content}",
            }
        )

    def _create_episodic(
        self, content: str, ttl: Optional[int]
    ) -> str:
        if not content:
            return format_error("content 不能为空，请提供情景记忆摘要文本")

        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        new_id = em.add_episode(summary=content, ttl=ttl)
        return format_success(
            {
                "id": new_id,
                "layer": "episodic",
                "summary": content,
                "ttl": ttl,
                "message": f"已创建情景记忆 [{new_id}]: {content}",
            }
        )

    def _create_semantic(
        self,
        subject: str,
        predicate: str,
        object: str,
        ttl: Optional[int],
    ) -> str:
        if not subject:
            return format_error("semantic 层需要 subject 参数")
        if not predicate:
            return format_error("semantic 层需要 predicate 参数")
        if not object:
            return format_error("semantic 层需要 object 参数")

        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        new_id = sm.add_fact(
            subject=subject, predicate=predicate, obj=object,
            source="manual", ttl=ttl,
        )
        # 4 层架构：语义记忆变更后失效系统提示词缓存
        try:
            from agent.prompts import invalidate_prompt_cache
            invalidate_prompt_cache()
        except Exception:
            pass
        return format_success(
            {
                "id": new_id,
                "layer": "semantic",
                "subject": subject,
                "predicate": predicate,
                "object": object,
                "ttl": ttl,
                "message": f"已创建语义记忆 [{new_id}]: {subject} {predicate} {object}",
            }
        )
