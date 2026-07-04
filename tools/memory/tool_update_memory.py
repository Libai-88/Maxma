"""Tool: update_memory — 更新已有记忆条目（支持跨层）。"""

from typing import Optional

from pydantic import BaseModel, Field

from app_paths import (
    EPISODIC_MEMORY_PATH,
    MEMORY_CONFIG_PATH as MEMORY_PATH,
    SEMANTIC_MEMORY_PATH,
)
from tools.base import ToolBase, format_error, format_success, register_tool
from memory.memory_manager import MAX_DESC_LENGTH


class UpdateMemoryInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    id: str = Field(
        default="",
        description="要更新的记忆 ID（来自 read_memories 的输出）。"
        "ID 前缀决定层级：ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆",
    )
    content: str = Field(
        default="",
        description="更新后的完整内容。long 层：完整记忆描述；"
        "episodic 层：新的摘要文本；semantic 层：新的客体（object）",
    )
    reason: str = Field(default="", description="修改原因，说明为什么要更新这条记忆")
    ttl: Optional[int] = Field(
        default=None,
        description="可选新 TTL（秒）。None=保留原过期时间；0=改为永久；>0=重置过期时间",
    )


@register_tool
class UpdateMemoryTool(ToolBase):
    name: str = "update_memory"
    description: str = (
        "根据 ID 更新一条已有记忆的内容。自动识别层级："
        "ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆。"
        "注意：情景/语义记忆无原生 update，采用删除+重建方式（ID 会变化）。"
        "[调用积极性: 绝对不要在用户没有提及该工具名时使用|仅在用户引用或提及时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = UpdateMemoryInput

    def _run(
        self,
        get_doc: bool = False,
        id: str = "",
        content: str = "",
        reason: str = "",
        ttl: Optional[int] = None,
    ) -> str:
        if get_doc:
            return self._load_doc()

        if not id:
            return format_error("id 不能为空，请提供要更新的记忆 ID")
        if not content:
            return format_error("content 不能为空，请提供更新后的内容")
        if not reason:
            return format_error("reason 不能为空，请说明更新原因")

        # 4 层架构：按 ID 前缀自动分发到对应层
        if id.startswith("ep_"):
            return self._update_episodic(id, content, reason, ttl)
        elif id.startswith("fact_"):
            return self._update_semantic(id, content, reason, ttl)
        return self._update_long(id, content, reason, ttl)

    def _update_long(
        self, id: str, content: str, reason: str, ttl: Optional[int]
    ) -> str:
        if len(content) > MAX_DESC_LENGTH:
            return format_error(
                f"更新后的记忆内容超过 {MAX_DESC_LENGTH} 字限制（当前 {len(content)} 字），"
                f"请精简至 {MAX_DESC_LENGTH} 字以内，避免列举；或拆分为多条独立条目"
            )

        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        try:
            mm.update(id, reason=reason, new_description=content, new_ttl=ttl)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的长期记忆条目。请先调用 read_memories 确认 ID。"
            )
        return format_success(
            {
                "id": id,
                "layer": "long",
                "content": content,
                "reason": reason,
                "ttl": ttl,
                "message": f"已更新长期记忆 [{id}]: {content}",
            }
        )

    def _update_episodic(
        self, id: str, content: str, reason: str, ttl: Optional[int]
    ) -> str:
        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        # 读取原记录以保留 session_id/turn_id/message_count
        target = None
        for item in em.list_episodes():
            if item["id"] == id:
                target = item
                break

        if target is None:
            return format_error(
                f"未找到 ID 为 {id} 的情景记忆条目。请先调用 list_memories(layer='episodic') 确认 ID。"
            )

        # 删除 + 重建（episodic 无原生 update）
        try:
            em.delete_episode(id)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的情景记忆条目。请先调用 list_memories(layer='episodic') 确认 ID。"
            )

        # ttl 为 None 时保留原 ttl
        effective_ttl = ttl
        if effective_ttl is None:
            effective_ttl = target.get("ttl")

        new_id = em.add_episode(
            summary=content,
            session_id=target.get("session_id", ""),
            turn_id=target.get("turn_id", ""),
            message_count=target.get("message_count", 0),
            ttl=effective_ttl,
        )
        return format_success(
            {
                "id": new_id,
                "old_id": id,
                "layer": "episodic",
                "summary": content,
                "reason": reason,
                "ttl": effective_ttl,
                "message": f"已更新情景记忆 [{id}→{new_id}]: {content}",
            }
        )

    def _update_semantic(
        self, id: str, content: str, reason: str, ttl: Optional[int]
    ) -> str:
        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        # 读取原记录以保留 subject/predicate
        target = None
        for item in sm.list_facts():
            if item["id"] == id:
                target = item
                break

        if target is None:
            return format_error(
                f"未找到 ID 为 {id} 的语义记忆条目。请先调用 list_memories(layer='semantic') 确认 ID。"
            )

        # 删除 + 重建（semantic 无原生 update）；content 作为新的 object
        try:
            sm.delete_fact(id)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的语义记忆条目。请先调用 list_memories(layer='semantic') 确认 ID。"
            )

        # ttl 为 None 时保留原 ttl
        effective_ttl = ttl
        if effective_ttl is None:
            effective_ttl = target.get("ttl")

        new_id = sm.add_fact(
            subject=target.get("subject", ""),
            predicate=target.get("predicate", ""),
            obj=content,
            source=target.get("source", "manual"),
            ttl=effective_ttl,
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
                "old_id": id,
                "layer": "semantic",
                "subject": target.get("subject", ""),
                "predicate": target.get("predicate", ""),
                "object": content,
                "reason": reason,
                "ttl": effective_ttl,
                "message": (
                    f"已更新语义记忆 [{id}→{new_id}]: "
                    f"{target.get('subject', '')} {target.get('predicate', '')} {content}"
                ),
            }
        )
