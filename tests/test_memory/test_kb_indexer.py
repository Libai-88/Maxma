"""KB 索引器测试 — memory/kb/indexer.py。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装（测试优雅降级）
- 使用 tmp_path 隔离元数据存储
- 测试文档加载、切块、元数据管理、删除逻辑
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from memory.kb.chunker import Chunk, chunk_document
from memory.kb.document_loader import Document, load_document
from memory.kb.indexer import KBIndexer
from memory.rag import embedding, vector_store


@pytest.fixture(autouse=True)
def _reset_rag_singletons():
    """每个测试前后重置 RAG 单例。"""
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()
    yield
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()


class TestDocumentLoader:
    """文档加载器测试。"""

    def test_load_txt(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("Hello world", encoding="utf-8")
        doc = load_document(f)
        assert doc.content == "Hello world"
        assert doc.file_type == "txt"
        assert doc.filename == "test.txt"

    def test_load_md(self, tmp_path):
        f = tmp_path / "test.md"
        f.write_text("# Title\n\nContent", encoding="utf-8")
        doc = load_document(f)
        assert "# Title" in doc.content
        assert doc.file_type == "md"

    def test_load_json(self, tmp_path):
        f = tmp_path / "test.json"
        f.write_text('{"key": "value"}', encoding="utf-8")
        doc = load_document(f)
        assert "key" in doc.content
        assert doc.file_type == "json"

    def test_load_csv(self, tmp_path):
        f = tmp_path / "test.csv"
        f.write_text("a,b,c\n1,2,3", encoding="utf-8")
        doc = load_document(f)
        assert "a | b | c" in doc.content
        assert doc.file_type == "csv"

    def test_load_unsupported(self, tmp_path):
        f = tmp_path / "test.xyz"
        f.write_text("content", encoding="utf-8")
        with pytest.raises(ValueError, match="不支持"):
            load_document(f)

    def test_load_nonexistent(self, tmp_path):
        with pytest.raises(ValueError, match="不存在"):
            load_document(tmp_path / "nonexistent.txt")

    def test_load_empty_file(self, tmp_path):
        f = tmp_path / "empty.txt"
        f.write_text("", encoding="utf-8")
        with pytest.raises(ValueError, match="为空"):
            load_document(f)


class TestChunker:
    """文档切块器测试。"""

    def _make_doc(self, content: str, doc_id: str = "test") -> Document:
        return Document(
            id=doc_id,
            content=content,
            source="test.txt",
            filename="test.txt",
            file_type="txt",
            size=len(content),
        )

    def test_short_text_single_chunk(self):
        doc = self._make_doc("Short text.")
        chunks = chunk_document(doc, chunk_size=500, overlap=50)
        assert len(chunks) == 1
        assert chunks[0].text == "Short text."
        assert chunks[0].source_doc_id == "test"

    def test_long_text_multiple_chunks(self):
        content = "A" * 1200
        doc = self._make_doc(content)
        chunks = chunk_document(doc, chunk_size=500, overlap=50)
        assert len(chunks) > 1
        # 所有切块组合应覆盖原文（考虑重叠）
        assert all(c.source_doc_id == "test" for c in chunks)

    def test_chunk_ids_unique(self):
        content = "A" * 1200
        doc = self._make_doc(content)
        chunks = chunk_document(doc, chunk_size=500, overlap=50)
        ids = [c.id for c in chunks]
        assert len(ids) == len(set(ids))

    def test_empty_content(self):
        doc = self._make_doc("")
        chunks = chunk_document(doc)
        assert chunks == []

    def test_invalid_params(self):
        doc = self._make_doc("text")
        with pytest.raises(ValueError):
            chunk_document(doc, chunk_size=0)
        with pytest.raises(ValueError):
            chunk_document(doc, chunk_size=100, overlap=100)


class TestKBIndexerMetadata:
    """KB 索引器元数据管理测试（不依赖向量库）。"""

    def test_index_text_creates_metadata(self, tmp_path):
        meta_path = tmp_path / "kb_meta.json"
        indexer = KBIndexer(meta_path=meta_path)
        result = indexer.index_text(
            content="这是一段测试文本",
            doc_id="doc1",
            filename="doc1.txt",
        )
        assert result["doc_id"] == "doc1"
        assert result["chunks"] >= 1
        assert result["status"] in ("ok", "metadata_only")

        # 验证元数据文件
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        assert "doc1" in meta
        assert meta["doc1"]["doc_id"] == "doc1"
        assert meta["doc1"]["chunk_count"] >= 1

    def test_list_documents(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        indexer.index_text(content="doc1 content", doc_id="doc1")
        indexer.index_text(content="doc2 content", doc_id="doc2")
        docs = indexer.list_documents()
        assert len(docs) == 2
        doc_ids = {d["doc_id"] for d in docs}
        assert doc_ids == {"doc1", "doc2"}

    def test_get_document(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        indexer.index_text(content="test", doc_id="doc1")
        doc = indexer.get_document("doc1")
        assert doc is not None
        assert doc["doc_id"] == "doc1"
        assert indexer.get_document("nonexistent") is None

    def test_delete_document(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        indexer.index_text(content="test content here", doc_id="doc1")
        assert indexer.delete_document("doc1") is True
        assert indexer.get_document("doc1") is None
        # 重复删除返回 False
        assert indexer.delete_document("doc1") is False

    def test_reindex_overwrites_old(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        indexer.index_text(content="original content", doc_id="doc1")
        indexer.index_text(content="updated content with more text", doc_id="doc1")
        docs = indexer.list_documents()
        assert len(docs) == 1
        assert docs[0]["doc_id"] == "doc1"

    def test_index_file_txt(self, tmp_path):
        f = tmp_path / "test.txt"
        f.write_text("File content for testing", encoding="utf-8")
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        result = indexer.index_file(f)
        assert result["doc_id"] == "test"
        assert result["chunks"] >= 1

    def test_index_file_unsupported(self, tmp_path):
        f = tmp_path / "test.xyz"
        f.write_text("content", encoding="utf-8")
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        with pytest.raises(ValueError, match="不支持"):
            indexer.index_file(f)

    def test_index_url(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        result = indexer.index_url(
            url="https://example.com/article",
            markdown="# Article\n\nContent here",
        )
        assert "doc_id" in result
        assert result["chunks"] >= 1

    def test_index_empty_text_raises(self, tmp_path):
        indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
        with pytest.raises(ValueError, match="为空"):
            indexer.index_text(content="", doc_id="doc1")


class TestKBIndexerVectorIntegration:
    """KB 索引器与向量库集成测试（使用 mock）。"""

    def test_index_with_mock_vector_store(self, tmp_path):
        """模拟向量库可用时，切块应被索引。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1] * 10]  # 假向量

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
                result = indexer.index_text(
                    content="这是一段需要被索引的文本内容",
                    doc_id="doc1",
                )
                assert result["status"] == "ok"
                assert result["indexed"] >= 1
                # 验证向量库 upsert 被调用
                assert mock_store.upsert.called

    def test_index_without_vector_store(self, tmp_path):
        """向量库不可用时，仅记录元数据。"""
        with patch("memory.rag.embedding.get_embedding_engine", return_value=None):
            with patch("memory.rag.vector_store.get_vector_store", return_value=None):
                indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
                result = indexer.index_text(
                    content="这是一段文本内容",
                    doc_id="doc1",
                )
                assert result["status"] == "metadata_only"
                assert result["indexed"] == 0

    def test_delete_with_mock_vector_store(self, tmp_path):
        """删除文档时也应从向量库删除切块。"""
        mock_store = MagicMock()
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1] * 10]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine):
            with patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
                indexer = KBIndexer(meta_path=tmp_path / "kb_meta.json")
                indexer.index_text(content="test content", doc_id="doc1")
                # 删除时应调用 store.delete
                indexer.delete_document("doc1")
                assert mock_store.delete.called
