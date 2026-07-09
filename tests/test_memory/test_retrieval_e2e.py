"""检索层端到端集成测试。

验证 CRAG-lite + Tavily 回退的完整流程，
以及全部关闭时与原 retrieve() 行为完全一致（回归保护）。
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage

from memory.kb.retriever import KBRetriever
from memory.rag import embedding, vector_store


@pytest.fixture(autouse=True)
def _reset_rag_singletons():
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()
    yield
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()


def _make_store_engine(docs):
    mock_store = MagicMock()
    mock_engine = MagicMock()
    mock_engine.embed.return_value = [[0.1] * 10]
    mock_store.query.return_value = docs
    return mock_store, mock_engine


def _make_model(responses):
    mock = MagicMock(spec=BaseChatModel)
    it = iter(responses)
    mock.ainvoke = AsyncMock(side_effect=lambda msgs: AIMessage(content=next(it)))
    return mock


class TestRetrievalAllDisabled:
    """全部特性关闭时，retrieve_with_correction 退化为 retrieve。"""

    @pytest.mark.asyncio
    async def test_original_behavior_preserved(self):
        docs = [
            {
                "id": "chunk_001",
                "document": "LangGraph 文档",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.1,
            }
        ]
        mock_store, mock_engine = _make_store_engine(docs)
        mock_model = _make_model([])

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever()
                results = await r.retrieve_with_correction(
                    model=mock_model,
                    query="LangGraph",
                    crag_enabled=False,
                )
                assert len(results) == 1
                assert results[0]["source"] == "kb"
                mock_model.ainvoke.assert_not_called()


class TestRetrievalCragFullPipeline:
    """CRAG-lite 完整流程测试。"""

    @pytest.mark.asyncio
    async def test_relevant_kb_results_no_fallback(self):
        """KB 有相关结果时，不触发 Tavily 回退。"""
        docs = [
            {
                "id": "chunk_001",
                "document": "LangGraph 是状态机框架",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.1,
            }
        ]
        mock_store, mock_engine = _make_store_engine(docs)
        mock_model = _make_model(['{"relevant":true,"reasoning":"相关"}'])

        r = KBRetriever()

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                with patch.object(r, "_tavily_fallback", new_callable=AsyncMock) as mock_tavily:
                    results = await r.retrieve_with_correction(
                        model=mock_model,
                        query="LangGraph 是什么",
                        crag_enabled=True,
                    )
                    assert len(results) == 1
                    assert results[0]["source"] == "kb"
                    mock_tavily.assert_not_called()

    @pytest.mark.asyncio
    async def test_irrelevant_kb_triggers_web_fallback(self):
        """KB 全不相关时，触发 Tavily 回退并返回 web 结果。"""
        docs = [
            {
                "id": "chunk_001",
                "document": "天气晴朗",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.5,
            }
        ]
        mock_store, mock_engine = _make_store_engine(docs)
        mock_model = _make_model(['{"relevant":false,"reasoning":"无关"}'])

        r = KBRetriever()

        async def mock_tavily(query, max_results):
            return [{
                "chunk_id": "web_001",
                "text": "LangGraph 网页结果",
                "source_filename": "web",
                "source_path": "https://example.com",
                "similarity": 1.0,
                "score_percent": 100.0,
            }]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                with patch.object(r, "_tavily_fallback", side_effect=mock_tavily):
                    results = await r.retrieve_with_correction(
                        model=mock_model,
                        query="LangGraph 是什么",
                        crag_enabled=True,
                    )
                    assert len(results) == 1
                    assert results[0]["source"] == "web"
                    assert results[0]["text"] == "LangGraph 网页结果"
