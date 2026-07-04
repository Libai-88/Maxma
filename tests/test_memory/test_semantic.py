"""语义记忆层测试 — memory/semantic.py。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装（测试优雅降级）
- 使用 tmp_path 隔离 JSON 存储
- 验证去重、关键词回退、向量检索路径
"""

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from memory.memory_manager import _is_expired
from memory.rag import embedding, vector_store
from memory.semantic import SemanticMemoryManager


@pytest.fixture(autouse=True)
def _reset_rag_singletons():
    """每个测试前后重置 RAG 单例。"""
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()
    yield
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()


class TestSemanticInit:
    def test_init_creates_json_file(self, tmp_path):
        path = tmp_path / "semantic.json"
        SemanticMemoryManager(json_file=str(path))
        assert path.exists()
        assert json.loads(path.read_text(encoding="utf-8")) == {}

    def test_init_creates_parent_dir(self, tmp_path):
        path = tmp_path / "sub" / "semantic.json"
        SemanticMemoryManager(json_file=str(path))
        assert path.exists()


class TestAddFact:
    def test_add_returns_fact_id(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        fid = sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        assert fid.startswith("fact_")
        assert len(fid) == len("fact_") + 8

    def test_add_persists_to_json(self, tmp_path):
        path = tmp_path / "s.json"
        sm = SemanticMemoryManager(json_file=str(path))
        fid = sm.add_fact(
            subject="用户", predicate="喜欢", obj="古典音乐", source="dialogue"
        )
        data = json.loads(path.read_text(encoding="utf-8"))
        assert fid in data
        record = data[fid]
        assert record["subject"] == "用户"
        assert record["predicate"] == "喜欢"
        assert record["object"] == "古典音乐"
        assert record["source"] == "dialogue"
        assert record["timestamp"]
        assert record["ttl"] is None
        assert record["expires_at"] is None

    def test_add_dedup_returns_existing_id(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        fid1 = sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        fid2 = sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        assert fid1 == fid2
        assert len(sm.list_facts()) == 1

    def test_add_dedup_updates_timestamp(self, tmp_path):
        path = tmp_path / "s.json"
        sm = SemanticMemoryManager(json_file=str(path))
        fid1 = sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        # 记录原 timestamp
        original_ts = sm.list_facts()[0]["timestamp"]
        # 再次添加（相同三元组）
        fid2 = sm.add_fact(
            subject="用户", predicate="喜欢", obj="古典音乐", source="manual"
        )
        assert fid1 == fid2
        record = sm.list_facts()[0]
        # source 应被更新
        assert record["source"] == "manual"

    def test_add_different_facts(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        sm.add_fact(subject="用户", predicate="不喜欢", obj="嘈杂环境")
        assert len(sm.list_facts()) == 2

    def test_add_with_ttl(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact(subject="项目", predicate="截止", obj="2026-12-31", ttl=86400)
        data = sm.list_facts()
        assert data[0]["ttl"] == 86400
        assert data[0]["expires_at"]
        assert _is_expired(data[0]["expires_at"]) is False


class TestListAndDelete:
    def test_list_empty(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        assert sm.list_facts() == []

    def test_list_sorted_desc(self, tmp_path):
        import time

        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        id1 = sm.add_fact("用户", "喜欢", "A")
        time.sleep(1.1)  # 跨秒确保 timestamp 不同
        id2 = sm.add_fact("用户", "喜欢", "B")
        result = sm.list_facts()
        assert result[0]["id"] == id2
        assert result[1]["id"] == id1

    def test_list_filters_expired(self, tmp_path):
        path = tmp_path / "s.json"
        sm = SemanticMemoryManager(json_file=str(path))
        sm.add_fact("用户", "喜欢", "A", ttl=1)
        # 改为过期
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for record in data.values():
            record["expires_at"] = (
                datetime.now() - timedelta(hours=1)
            ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        assert sm.list_facts() == []
        assert len(sm.list_facts(include_expired=True)) == 1

    def test_delete_removes_fact(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        fid = sm.add_fact("用户", "喜欢", "A")
        removed_text = sm.delete_fact(fid)
        assert "用户" in removed_text
        assert "喜欢" in removed_text
        assert sm.list_facts() == []

    def test_delete_nonexistent_raises(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        with pytest.raises(ValueError, match="not found"):
            sm.delete_fact("fact_nonexistent")


class TestRetrieveKeywordFallback:
    """retrieve 在 RAG 不可用时应回退到关键词匹配。"""

    def test_retrieve_keyword_when_rag_unavailable(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact(subject="用户", predicate="喜欢", obj="古典音乐")
        sm.add_fact(subject="用户", predicate="居住", obj="北京")
        # RAG 单例被 fixture 重置为 None
        results = sm.retrieve(query="喜欢")
        assert len(results) == 1
        assert results[0]["subject"] == "用户"
        assert results[0]["object"] == "古典音乐"
        # 关键词命中视为最高相似度
        assert results[0]["similarity"] == 1.0

    def test_retrieve_keyword_no_match_returns_empty(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact("用户", "喜欢", "古典音乐")
        results = sm.retrieve(query="运动")
        assert results == []

    def test_retrieve_keyword_filters_expired(self, tmp_path):
        path = tmp_path / "s.json"
        sm = SemanticMemoryManager(json_file=str(path))
        sm.add_fact("用户", "喜欢", "古典音乐", ttl=1)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for record in data.values():
            record["expires_at"] = (
                datetime.now() - timedelta(hours=1)
            ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # 默认过滤过期
        assert sm.retrieve(query="古典音乐") == []
        # include_expired=True 返回
        assert len(sm.retrieve(query="古典音乐", include_expired=True)) == 1


class TestRetrieveVector:
    """retrieve 在 RAG 可用时使用向量检索。"""

    def test_retrieve_uses_vector(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        fid = sm.add_fact("用户", "喜欢", "古典音乐")
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2, 0.3]]
        mock_store = MagicMock()
        mock_store.query.return_value = [
            {"id": fid, "document": "用户 喜欢 古典音乐", "metadata": {}, "distance": 0.2}
        ]
        with (
            patch(
                "memory.rag.embedding.get_embedding_engine", return_value=mock_engine
            ),
            patch(
                "memory.rag.vector_store.get_vector_store", return_value=mock_store
            ),
        ):
            results = sm.retrieve(query="音乐偏好")
        assert len(results) == 1
        assert results[0]["id"] == fid
        assert results[0]["subject"] == "用户"
        assert results[0]["similarity"] == pytest.approx(0.8, abs=0.01)


class TestPurgeExpired:
    def test_purge_no_expired(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact("用户", "喜欢", "音乐")
        assert sm.purge_expired() == 0

    def test_purge_removes_expired(self, tmp_path):
        path = tmp_path / "s.json"
        sm = SemanticMemoryManager(json_file=str(path))
        sm.add_fact("用户", "喜欢", "音乐")  # 永久
        sm.add_fact("项目", "截止", "明天", ttl=1)  # 临时
        # 改第二条为过期
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        keys = list(data.keys())
        data[keys[1]]["expires_at"] = (
            datetime.now() - timedelta(hours=1)
        ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        assert sm.purge_expired() == 1
        assert len(sm.list_facts()) == 1
        assert sm.list_facts()[0]["object"] == "音乐"


class TestFactText:
    """_fact_text 渲染测试。"""

    def test_fact_text_format(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        text = sm._fact_text("用户", "喜欢", "古典音乐")
        assert text == "用户 喜欢 古典音乐"
