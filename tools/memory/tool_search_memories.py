"""Tool: search_memories — 搜索长期记忆条目（RAG 向量检索 + 关键词回退）。"""

from pydantic import BaseModel, Field

from app_paths import MEMORY_CONFIG_PATH as MEMORY_PATH
from tools.base import ToolBase, format_error, format_success, register_tool


class SearchMemoriesInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    keyword: str = Field(
        default="",
        description="搜索关键词或自然语言查询。优先使用 RAG 向量检索语义相似的记忆，"
        "向量库不可用时回退到关键词模糊匹配",
    )
    section: str = Field(
        default="",
        description="可选，按分区过滤（如 '身份'、'音乐'、'品味' 等）",
    )
    since: str = Field(
        default="",
        description="可选，时间范围起始（格式 YYYY-MM-DD），仅返回此日期之后更新的条目",
    )
    top_k: int = Field(
        default=5,
        description="向量检索返回的最大结果数（默认 5）",
    )


@register_tool
class SearchMemoriesTool(ToolBase):
    name: str = "search_memories"
    description: str = (
        "搜索长期记忆条目。优先使用 RAG 向量检索（语义相似度），"
        "向量库不可用时回退到关键词模糊匹配。支持按分区、时间范围二次过滤。"
        "当用户提到'我之前跟你说过关于 XX 的事'或需要回忆历史信息时使用。"
        "[调用积极性: 用户询问过去的对话或记忆时主动调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = SearchMemoriesInput

    def _run(
        self,
        get_doc: bool = False,
        keyword: str = "",
        section: str = "",
        since: str = "",
        top_k: int = 5,
    ) -> str:
        if get_doc:
            return self._load_doc()

        if not keyword and not section and not since:
            return format_error("至少需要提供 keyword、section 或 since 中的一个参数")

        from memory.memory_manager import MemoryManager

        mm = MemoryManager(yaml_file=str(MEMORY_PATH))

        # 优先尝试 RAG 向量检索（仅当有 keyword 可作为查询向量时）
        if keyword:
            rag_results = self._rag_search(keyword, section, top_k)
            if rag_results is not None:
                # 向量检索成功，应用 since 二次过滤
                if since:
                    rag_results = [
                        r for r in rag_results
                        if self._is_after(r.get("updated_at", ""), since)
                    ]
                if rag_results:
                    return self._format_results(rag_results, "rag")
                # 向量检索无结果，且无其他过滤条件时直接返回空
                if not section and not since:
                    return format_success({
                        "count": 0,
                        "engine": "rag",
                        "items": [],
                        "message": "未找到语义相似的记忆条目",
                    })
                # 有 section/since 过滤但向量检索为空，回退到关键词搜索

        # 回退：关键词模糊匹配
        results = mm.search(keyword=keyword, theme=section, since=since)
        if not results:
            return format_success({
                "count": 0,
                "engine": "keyword",
                "items": [],
                "message": "未找到匹配的记忆条目",
            })

        return self._format_results(results, "keyword")

    def _rag_search(
        self, keyword: str, section: str, top_k: int
    ) -> list[dict] | None:
        """RAG 向量检索。返回结果列表，或 None 表示向量库不可用。"""
        try:
            from memory.rag.embedding import get_embedding_engine
            from memory.rag.vector_store import COLLECTION_LONG_TERM, get_vector_store

            engine = get_embedding_engine()
            store = get_vector_store()
            if engine is None or store is None:
                return None

            embeddings = engine.embed([keyword])
            if not embeddings:
                return None

            where = {"theme": section} if section else None
            raw = store.query(
                collection=COLLECTION_LONG_TERM,
                query_embeddings=embeddings,
                n_results=top_k,
                where=where,
            )
            if not raw:
                return []

            # 从向量库结果反查完整记忆条目（需要 description/theme/updated_at）
            from memory.memory_manager import MemoryManager

            mm = MemoryManager(yaml_file=str(MEMORY_PATH))
            all_items = {item["id"]: item for item in mm.show()}

            results = []
            for hit in raw:
                item_id = hit.get("id", "")
                item = all_items.get(item_id)
                if item is None:
                    continue
                # 距离越小越相似（chromadb 默认余弦距离）
                distance = hit.get("distance", 0.0)
                similarity = max(0.0, 1.0 - distance)
                results.append({
                    "id": item["id"],
                    "description": item["description"],
                    "theme": item["theme"],
                    "updated_at": item.get("updated_at", ""),
                    "similarity": round(similarity * 100, 1),
                })
            return results
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                "[search_memories] RAG 检索失败，回退到关键词: %s", e
            )
            return None

    @staticmethod
    def _is_after(updated_at: str, since: str) -> bool:
        """检查 updated_at 是否 >= since（字符串前缀比较，适合 YYYY-MM-DD 格式）。"""
        if not updated_at or not since:
            return True
        return updated_at[:10] >= since

    @staticmethod
    def _format_results(results: list[dict], engine: str) -> str:
        """格式化搜索结果。"""
        lines = []
        for item in results:
            sim = item.get("similarity")
            sim_str = f" (相似度 {sim}%)" if sim is not None else ""
            lines.append(
                f"[{item['id']}] ({item.get('theme', '')}){sim_str} {item.get('description', '')}"
            )
        return format_success({
            "count": len(results),
            "engine": engine,
            "items": results,
            "formatted": "\n".join(lines),
        })
