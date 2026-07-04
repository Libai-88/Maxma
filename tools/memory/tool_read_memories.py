"""Tool: read_memories — 按 ID 读取单条记忆的完整内容（支持跨层）。"""

from pydantic import BaseModel, Field

from app_paths import (
    EPISODIC_MEMORY_PATH,
    MEMORY_CONFIG_PATH as MEMORY_PATH,
    SEMANTIC_MEMORY_PATH,
)
from tools.base import ToolBase, format_error, format_success, register_tool


class ReadMemoriesInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    id: str = Field(
        default="",
        description="要读取的记忆 ID（来自 list_memories 的输出）。"
        "ID 前缀决定层级：ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆",
    )


@register_tool
class ReadMemoriesTool(ToolBase):
    name: str = "read_memories"
    description: str = (
        "根据 ID 读取一条记忆的完整内容（含变更历史，仅长期记忆有）。"
        "自动识别层级：ep_*→情景记忆/fact_*→语义记忆/其他→长期记忆。"
        "先用 list_memories 获取概览和 ID，再用此工具查看全文。"
        "[调用积极性: 绝对不要在用户没有提及该工具名时使用|仅在用户引用或提及时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ReadMemoriesInput

    def _run(self, get_doc: bool = False, id: str = "") -> str:
        if get_doc:
            return self._load_doc()

        if not id:
            return format_error("请提供要读取的记忆 ID")

        # 4 层架构：按 ID 前缀自动分发到对应层
        if id.startswith("ep_"):
            return self._read_episodic(id)
        elif id.startswith("fact_"):
            return self._read_semantic(id)
        return self._read_long(id)

    def _read_long(self, id: str) -> str:
        if not MEMORY_PATH.exists():
            return format_error("长期记忆文件不存在")

        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        items = mm.show()

        # 查找匹配 ID 的条目
        target = None
        for item in items:
            if item["id"] == id:
                target = item
                break

        if target is None:
            return format_error(
                f"未找到 ID 为 {id} 的长期记忆条目。请先调用 list_memories 确认 ID。"
            )

        result = {
            "id": target["id"],
            "layer": "long",
            "description": target["description"],
            "theme": target["theme"],
        }

        # 读取变更历史
        try:
            history = mm.show_description_history(id)
            if len(history) > 1:
                result["history"] = history
                result["history_count"] = len(history)
        except ValueError:
            pass

        # 文本格式
        lines = [f"## {target['theme']}", f"  [{target['id']}] {target['description']}"]
        if result.get("history"):
            lines.append("")
            lines.append("### 变更历史")
            for h in result["history"]:
                lines.append(
                    f"  - {h['time']}: {h['description'][:60]}{'…' if len(h['description']) > 60 else ''}"
                )
        result["formatted"] = "\n".join(lines)

        return format_success(result)

    def _read_episodic(self, id: str) -> str:
        if not EPISODIC_MEMORY_PATH.exists():
            return format_error(
                f"未找到 ID 为 {id} 的情景记忆条目。请先调用 list_memories(layer='episodic') 确认 ID。"
            )

        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        # list_episodes 已按时间倒序，遍历查找匹配 ID
        target = None
        for item in em.list_episodes():
            if item["id"] == id:
                target = item
                break

        if target is None:
            return format_error(
                f"未找到 ID 为 {id} 的情景记忆条目。请先调用 list_memories(layer='episodic') 确认 ID。"
            )

        result = {
            "id": target["id"],
            "layer": "episodic",
            "session_id": target.get("session_id", ""),
            "turn_id": target.get("turn_id", ""),
            "timestamp": target.get("timestamp", ""),
            "summary": target.get("summary", ""),
            "message_count": target.get("message_count", 0),
        }

        # 文本格式
        lines = [
            "## 情景记忆",
            f"  [{target['id']}] ({target.get('timestamp', '')})",
            f"  会话: {target.get('session_id', '')} / 轮次: {target.get('turn_id', '')}",
            f"  消息数: {target.get('message_count', 0)}",
            "",
            target.get("summary", ""),
        ]
        result["formatted"] = "\n".join(lines)

        return format_success(result)

    def _read_semantic(self, id: str) -> str:
        if not SEMANTIC_MEMORY_PATH.exists():
            return format_error(
                f"未找到 ID 为 {id} 的语义记忆条目。请先调用 list_memories(layer='semantic') 确认 ID。"
            )

        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        # list_facts 已按时间倒序，遍历查找匹配 ID
        target = None
        for item in sm.list_facts():
            if item["id"] == id:
                target = item
                break

        if target is None:
            return format_error(
                f"未找到 ID 为 {id} 的语义记忆条目。请先调用 list_memories(layer='semantic') 确认 ID。"
            )

        subject = target.get("subject", "")
        predicate = target.get("predicate", "")
        obj = target.get("object", "")
        result = {
            "id": target["id"],
            "layer": "semantic",
            "subject": subject,
            "predicate": predicate,
            "object": obj,
            "source": target.get("source", ""),
            "timestamp": target.get("timestamp", ""),
        }

        # 文本格式
        lines = [
            "## 语义记忆",
            f"  [{target['id']}] {subject} {predicate} {obj}",
            f"  来源: {target.get('source', '未知')} / 时间: {target.get('timestamp', '')}",
        ]
        result["formatted"] = "\n".join(lines)

        return format_success(result)
