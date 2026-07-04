"""Tool: list_memories — 列出所有记忆条目（每条截断以节省上下文）。"""

from pydantic import BaseModel, Field

from app_paths import (
    EPISODIC_MEMORY_PATH,
    MEMORY_CONFIG_PATH as MEMORY_PATH,
    SEMANTIC_MEMORY_PATH,
)
from tools.base import ToolBase, format_error, format_success, register_tool


class ListMemoriesInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    layer: str = Field(
        default="long",
        description="记忆层级：long=长期记忆（默认）/episodic=情景记忆/semantic=语义记忆",
    )

# 描述截断长度（字符数），取自现有 memory.yaml 描述长度分布分析
# 大部分描述在 100-300 字符，200 字能覆盖关键信息，节省约 40% 上下文
TRUNCATE_LEN = 200


def _truncate(text: str) -> str:
    """超出 TRUNCATE_LEN 的描述截断并追加 …。"""
    if len(text) <= TRUNCATE_LEN:
        return text
    return text[:TRUNCATE_LEN] + "…"


def _format_entries(items: list[dict]) -> str:
    """按 theme 分组格式化记忆条目（已截断）。"""
    if not items:
        return "（暂无记忆条目）"
    by_theme: dict[str, list[dict]] = {}
    theme_order: list[str] = []
    for item in items:
        theme = item["theme"]
        by_theme.setdefault(theme, []).append(item)
        if theme not in theme_order:
            theme_order.append(theme)
    lines = []
    for theme in theme_order:
        lines.append(f"## {theme}")
        for item in by_theme[theme]:
            desc = _truncate(item["description"])
            lines.append(f"  [{item['id']}] {desc}")
        lines.append("")
    return "\n".join(lines).strip()


def _format_episodes(items: list[dict]) -> str:
    """格式化情景记忆条目（按时间倒序）。"""
    if not items:
        return "（暂无情景记忆）"
    lines = ["## 情景记忆"]
    for item in items:
        summary = _truncate(item.get("summary", ""))
        lines.append(f"  [{item['id']}] ({item.get('timestamp', '')}) {summary}")
    return "\n".join(lines)


def _format_facts(items: list[dict]) -> str:
    """格式化语义记忆条目。"""
    if not items:
        return "（暂无语义记忆）"
    lines = ["## 语义记忆"]
    for item in items:
        text = f"{item.get('subject', '')} {item.get('predicate', '')} {item.get('object', '')}"
        lines.append(f"  [{item['id']}] {text}")
    return "\n".join(lines)


@register_tool
class ListMemoriesTool(ToolBase):
    name: str = "list_memories"
    description: str = (
        "查看记忆条目的概览列表（每条描述已截断以节省上下文）。"
        "支持 layer 参数选择记忆层级：long=长期记忆（默认）/episodic=情景记忆/semantic=语义记忆。"
        "如需读取某条记忆的完整内容，再调用 read_memories 传入其 ID。"
        "[调用积极性: 绝对不要在用户没有提及该工具名时使用|仅在用户引用或提及时调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = ListMemoriesInput

    def _run(self, get_doc: bool = False, layer: str = "long") -> str:
        if get_doc:
            return self._load_doc()

        layer = (layer or "long").lower()
        if layer == "long":
            return self._list_long()
        elif layer == "episodic":
            return self._list_episodic()
        elif layer == "semantic":
            return self._list_semantic()
        return format_error(f"不支持的 layer: {layer}（可选：long/episodic/semantic）")

    def _list_long(self) -> str:
        if not MEMORY_PATH.exists():
            return format_success({"items": [], "formatted": "（暂无记忆条目）"})
        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))
        items = mm.show()
        truncated_items = [
            {**item, "description": _truncate(item["description"])} for item in items
        ]
        formatted = _format_entries(items)
        return format_success(
            {
                "layer": "long",
                "count": len(items),
                "items": truncated_items,
                "formatted": formatted,
            }
        )

    def _list_episodic(self) -> str:
        if not EPISODIC_MEMORY_PATH.exists():
            return format_success({"layer": "episodic", "items": [], "formatted": "（暂无情景记忆）"})
        from memory.episodic import EpisodicMemoryManager

        em = EpisodicMemoryManager(json_file=str(EPISODIC_MEMORY_PATH))
        items = em.list_episodes()
        truncated_items = [
            {**item, "summary": _truncate(item.get("summary", ""))} for item in items
        ]
        formatted = _format_episodes(items)
        return format_success(
            {
                "layer": "episodic",
                "count": len(items),
                "items": truncated_items,
                "formatted": formatted,
            }
        )

    def _list_semantic(self) -> str:
        if not SEMANTIC_MEMORY_PATH.exists():
            return format_success({"layer": "semantic", "items": [], "formatted": "（暂无语义记忆）"})
        from memory.semantic import SemanticMemoryManager

        sm = SemanticMemoryManager(json_file=str(SEMANTIC_MEMORY_PATH))
        items = sm.list_facts()
        formatted = _format_facts(items)
        return format_success(
            {
                "layer": "semantic",
                "count": len(items),
                "items": items,
                "formatted": formatted,
            }
        )
