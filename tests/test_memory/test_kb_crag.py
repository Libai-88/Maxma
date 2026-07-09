"""CRAG-lite 纠正式检索集成测试 — memory/kb/retriever.py。

测试策略：
- mock embedding engine、vector store、LLM model
- 验证 retrieve_with_correction 的完整流程
- 验证 grading 通过时不触发 Tavily 回退
- 验证 grading 全失败时触发 Tavily 回退
- 验证 crag_enabled=False 时行为与原 retrieve() 一致
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage

from memory.kb.retriever import KBRetriever
from memory.rag import embedding, vector_store


@pytest.fixture(autouse=True)
def _reset_rag_singletons():
    """每个测试前后重置 RAG 单例。"""
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()
    yield
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()


def _make_mock_store_and_engine(docs):
    """创建返回指定 docs 的 mock store + engine。"""
    mock_store = MagicMock()
    mock_engine = MagicMock()
    mock_engine.embed.return_value = [[0.1] * 10]
    mock_store.query.return_value = docs
    return mock_store, mock_engine


def _make_mock_model(responses):
    """创建按顺序返回 JSON 响应的 mock model。"""
    mock = MagicMock(spec=BaseChatModel)
    it = iter(responses)
    mock.ainvoke = AsyncMock(side_effect=lambda msgs: AIMessage(content=next(it)))
    return mock


class TestRetrieveWithCorrectionDisabled:
    """crag_enabled=False（默认）时，retrieve_with_correction 退化为 retrieve。"""

    @pytest.mark.asyncio
    async def test_disabled_behaves_like_retrieve(self):
        docs = [
            {
                "id": "chunk_001",
                "document": "相关文档",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.2,
            }
        ]
        mock_store, mock_engine = _make_mock_store_and_engine(docs)
        mock_model = _make_mock_model([])

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever()
                results = await r.retrieve_with_correction(
                    model=mock_model,
                    query="test",
                    crag_enabled=False,
                )
                assert len(results) == 1
                assert results[0]["source"] == "kb"
                mock_model.ainvoke.assert_not_called()


class TestRetrieveWithCorrectionEnabled:
    """crag_enabled=True 时的纠正式检索。"""

    @pytest.mark.asyncio
    async def test_all_relevant_no_fallback(self):
        """全部文档相关时，不触发 Tavily 回退。"""
        docs = [
            {
                "id": "chunk_001",
                "document": "LangGraph 是状态机框架",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.1,
            }
        ]
        mock_store, mock_engine = _make_mock_store_and_engine(docs)
        mock_model = _make_mock_model(['{"relevant":true,"reasoning":"相关"}'])

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever()
                results = await r.retrieve_with_correction(
                    model=mock_model,
                    query="LangGraph 是什么",
                    crag_enabled=True,
                )
                assert len(results) == 1
                assert results[0]["source"] == "kb"

    @pytest.mark.asyncio
    async def test_all_irrelevant_triggers_tavily_fallback(self):
        """全部文档不相关时，触发 Tavily 回退。"""
        docs = [
            {
                "id": "chunk_001",
                "document": "天气晴朗",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.5,
            }
        ]
        mock_store, mock_engine = _make_mock_store_and_engine(docs)
        mock_model = _make_mock_model(['{"relevant":false,"reasoning":"无关"}'])

        r = KBRetriever()

        async def mock_tavily(query, max_results):
            return [
                {
                    "chunk_id": "web_001",
                    "text": "LangGraph 是 LangChain 的状态机库",
                    "source_doc_id": "",
                    "source_filename": "web_search",
                    "source_path": "https://example.com/langgraph",
                    "similarity": 1.0,
                    "score_percent": 100.0,
                }
            ]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                with patch.object(r, "_tavily_fallback", side_effect=mock_tavily):
                    results = await r.retrieve_with_correction(
                        model=mock_model,
                        query="LangGraph 是什么",
                        crag_enabled=True,
                    )
                    assert len(results) >= 1
                    assert any(item["source"] == "web" for item in results)

    @pytest.mark.asyncio
    async def test_empty_kb_triggers_tavily_fallback(self):
        """KB 无结果时，直接触发 Tavily 回退（无需 grading）。"""
        mock_store, mock_engine = _make_mock_store_and_engine([])
        mock_model = _make_mock_model([])

        r = KBRetriever()

        async def mock_tavily(query, max_results):
            return [
                {
                    "chunk_id": "web_001",
                    "text": "网页结果",
                    "source_doc_id": "",
                    "source_filename": "web_search",
                    "source_path": "https://example.com",
                    "similarity": 1.0,
                    "score_percent": 100.0,
                }
            ]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                with patch.object(r, "_tavily_fallback", side_effect=mock_tavily):
                    results = await r.retrieve_with_correction(
                        model=mock_model,
                        query="问题",
                        crag_enabled=True,
                    )
                    assert len(results) == 1
                    assert results[0]["source"] == "web"
                    mock_model.ainvoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_tavily_failure_returns_empty(self):
        """Tavily 回退也失败时，返回空列表（不阻塞）。"""
        mock_store, mock_engine = _make_mock_store_and_engine([])
        mock_model = _make_mock_model([])

        r = KBRetriever()

        async def mock_tavily(query, max_results):
            return []

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                with patch.object(r, "_tavily_fallback", side_effect=mock_tavily):
                    results = await r.retrieve_with_correction(
                        model=mock_model,
                        query="问题",
                        crag_enabled=True,
                    )
                    assert results == []
