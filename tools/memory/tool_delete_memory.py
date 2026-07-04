"""Tool: delete_memory — 删除一条记忆条目（支持跨层）。"""

from pydantic import BaseModel, Field

from app_paths import (
    EPISODIC_MEMORY_PATH,
    MEMORY_CONFIG_PATH as MEMORY_PATH,
    SEMANTIC_MEMORY_PATH,
)
from tools.base import ToolBase, format_error, format_success, register_tool


class DeleteMemoryInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    id: str = Field(
        default="",
        description="要删除的记忆 ID（来自 list_memories/read_memories 的输出）。"
        "ID 前缀决定层级：ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆",
    )
    reason: str = Field(default="", description="删除原因，说明为什么要删除这条记忆")


@register_tool
class DeleteMemoryTool(ToolBase):
    name: str = "delete_memory"
    description: str = (
        "根据 ID 删除一条记忆。自动识别层级：ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆。"
        "[调用积极性: 绝对不要在用户没有提及该工具名时使用|仅在用户引用或提及时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = DeleteMemoryInput

    def _run(self, get_doc: bool = False, id: str = "", reason: str = "") -> str:
        if get_doc:
            return self._load_doc()

        if not id:
            return format_error("id 不能为空，请提供要删除的记忆 ID")
        if not reason:
            return format_error("reason 不能为空，请说明删除原因")

        # 4 层架构：按 ID 前缀自动分发到对应层
        if id.startswith("ep_"):
            return self._delete_episodic(id, reason)
        elif id.startswith("fact_"):
            return self._delete_semantic(id, reason)
        return self._delete_long(id, reason)

    def _delete_long(self, id: str, reason: str) -> str:
        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        try:
            removed = mm.delete(id)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的长期记忆条目。请先调用 list_memories 确认 ID。"
            )
        return format_success(
            {
                "id": id,
                "layer": "long",
                "removed_content": removed,
                "reason": reason,
                "message": f"已删除长期记忆 [{id}]: {removed}",
            }
        )

    def _delete_episodic(self, id: str, reason: str) -> str:
        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        try:
            removed = em.delete_episode(id)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的情景记忆条目。请先调用 list_memories(layer='episodic') 确认 ID。"
            )
        return format_success(
            {
                "id": id,
                "layer": "episodic",
                "removed_content": removed,
                "reason": reason,
                "message": f"已删除情景记忆 [{id}]: {removed}",
            }
        )

    def _delete_semantic(self, id: str, reason: str) -> str:
        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        try:
            removed = sm.delete_fact(id)
        except ValueError:
            return format_error(
                f"未找到 ID 为 {id} 的语义记忆条目。请先调用 list_memories(layer='semantic') 确认 ID。"
            )
        # 4 层架构：语义记忆变更后失效系统提示词缓存
        try:
            from agent.prompts import invalidate_prompt_cache
            invalidate_prompt_cache()
        except Exception:
            pass
        return format_success(
            {
                "id": id,
                "layer": "semantic",
                "removed_content": removed,
                "reason": reason,
                "message": f"已删除语义记忆 [{id}]: {removed}",
            }
        )
