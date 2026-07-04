"""KB 检索器测试 — memory/kb/retriever.py。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装
- 使用 mock 测试向量检索路径
- 测试降级场景（向量库不可用时返回空列表）
"""

from unittest.mock import MagicMock, patch

import pytest

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


class TestKBRetrieverInit:
    """检索器初始化测试。"""

    def test_default_params(self):
        r = KBRetriever()
        assert r._top_k == 5
        assert r._threshold == 0.3

    def test_custom_params(self):
        r = KBRetriever(top_k=10, threshold=0.5)
        assert r._top_k == 10
        assert r._threshold == 0.5


class TestKBRetrieverRetrieve:
    """检索逻辑测试。"""

    def test_empty_query_returns_empty(self):
        r = KBRetriever()
        assert r.retrieve("") == []
        assert r.retrieve("   ") == []

    def test_no_vector_store_returns_empty(self):
        """向量库不可用时返回空列表。"""
        with patch("memory.rag.embedding.get_embedding_engine", return_value=None):
            with patch("memory.rag.vector_store.get_vector_store", return_value=None):
                r = KBRetriever()
                results = r.retrieve("test query")
                assert results == []

    def test_retrieve_with_mock(self):
        """模拟向量库返回结果。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1] * 10]
        mock_store.query.return_value = [
            {
                "id": "chunk_001",
                "document": "相关文档片段",
                "metadata": {
                    "doc_id": "doc1",
                    "filename": "test.txt",
                    "source_path": "/path/to/test.txt",
                },
                "distance": 0.2,  # 相似度 = 1 - 0.2 = 0.8
            }
        ]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever(threshold=0.3)
                results = r.retrieve("test query")
                assert len(results) == 1
                assert results[0]["chunk_id"] == "chunk_001"
                assert results[0]["text"] == "相关文档片段"
                assert results[0]["source_doc_id"] == "doc1"
                assert results[0]["source_filename"] == "test.txt"
                assert results[0]["similarity"] == 0.8
                assert results[0]["score_percent"] == 80.0

    def test_threshold_filtering(self):
        """低于阈值的结果被过滤。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1] * 10]
        mock_store.query.return_value = [
            {
                "id": "chunk_001",
                "document": "不太相关",
                "metadata": {"doc_id": "doc1", "filename": "f.txt"},
                "distance": 0.9,  # 相似度 = 0.1
            }
        ]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever(threshold=0.3)
                results = r.retrieve("test query")
                assert results == []  # 相似度 0.1 < 0.3 被过滤

    def test_override_top_k_and_threshold(self):
        """retrieve() 参数覆盖默认值。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1] * 10]
        mock_store.query.return_value = []

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever(top_k=5, threshold=0.3)
                r.retrieve("query", top_k=10, threshold=0.5)
                # 验证 store.query 被调用时 n_results=10
                call_kwargs = mock_store.query.call_args
                assert call_kwargs.kwargs["n_results"] == 10

    def test_retrieve_exception_returns_empty(self):
        """向量库异常时返回空列表。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.side_effect = Exception("embedding failed")

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                r = KBRetriever()
                results = r.retrieve("test query")
                assert results == []


class TestKBRetrieverText:
    """retrieve_text 格式化输出测试。"""

    def test_empty_results(self):
        r = KBRetriever()
        with patch.object(r, "retrieve", return_value=[]):
            assert r.retrieve_text("query") == ""

    def test_formatted_output(self):
        r = KBRetriever()
        mock_results = [
            {
                "chunk_id": "c1",
                "text": "文档片段内容",
                "source_filename": "test.txt",
                "similarity": 0.85,
                "score_percent": 85.0,
                "source_doc_id": "doc1",
                "source_path": "/path",
            }
        ]
        with patch.object(r, "retrieve", return_value=mock_results):
            text = r.retrieve_text("query")
            assert "知识库检索结果" in text
            assert "test.txt" in text
            assert "85" in text
            assert "文档片段内容" in text

    def test_long_text_truncated(self):
        r = KBRetriever()
        long_text = "A" * 500
        mock_results = [
            {
                "chunk_id": "c1",
                "text": long_text,
                "source_filename": "test.txt",
                "similarity": 0.9,
                "score_percent": 90.0,
                "source_doc_id": "doc1",
                "source_path": "/path",
            }
        ]
        with patch.object(r, "retrieve", return_value=mock_results):
            text = r.retrieve_text("query")
            assert "…" in text  # 被截断
            assert len(text) < 600
