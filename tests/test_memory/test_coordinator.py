"""4 层记忆协调器测试 — memory/coordinator.py。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装
- 使用 tmp_path 隔离存储
- 验证跨层聚合、容错、retrieve_text 格式化
"""

from unittest.mock import MagicMock

import pytest

from memory.coordinator import MemoryCoordinator, VALID_LAYERS
from memory.episodic import EpisodicMemoryManager
from memory.memory_manager import MemoryManager
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


@pytest.fixture
def coordinator(tmp_path):
    """构造包含 3 层（long/episodic/semantic）的协调器。"""
    mm = MemoryManager(yaml_file=str(tmp_path / "long.yaml"))
    em = EpisodicMemoryManager(json_file=str(tmp_path / "episodic.json"))
    sm = SemanticMemoryManager(json_file=str(tmp_path / "semantic.json"))
    return MemoryCoordinator(
        long_term_mm=mm,
        episodic_mm=em,
        semantic_mm=sm,
    )


class TestInit:
    """协调器初始化测试。"""

    def test_init_all_none(self):
        c = MemoryCoordinator()
        assert c.long_term_mm is None
        assert c.episodic_mm is None
        assert c.semantic_mm is None

    def test_init_partial(self, tmp_path):
        mm = MemoryManager(yaml_file=str(tmp_path / "l.yaml"))
        c = MemoryCoordinator(long_term_mm=mm)
        assert c.long_term_mm is mm
        assert c.episodic_mm is None
        assert c.semantic_mm is None

    def test_valid_layers_constant(self):
        assert VALID_LAYERS == {"short", "long", "episodic", "semantic"}


class TestRetrieveDefault:
    """默认检索行为测试。"""

    def test_retrieve_empty_returns_empty_dict_per_layer(self, coordinator):
        # 默认 layers=None → 检索 long/episodic/semantic 三层
        results = coordinator.retrieve(query="测试")
        # short 不在默认 layers，所以 results 不应包含 short
        assert "short" not in results
        assert results["long"] == []
        assert results["episodic"] == []
        assert results["semantic"] == []

    def test_retrieve_short_returns_empty_placeholder(self, coordinator):
        results = coordinator.retrieve(query="测试", layers=["short"])
        assert results["short"] == []

    def test_retrieve_invalid_layer_filtered(self, coordinator):
        # 包含无效层名，应被过滤
        results = coordinator.retrieve(
            query="测试", layers=["long", "invalid_layer"]
        )
        assert "long" in results
        assert "invalid_layer" not in results


class TestRetrieveWithLongTerm:
    """含长期记忆的检索测试。"""

    def test_retrieve_long_term_with_match(self, tmp_path):
        mm = MemoryManager(yaml_file=str(tmp_path / "l.yaml"))
        mm.add(description="用户喜欢古典音乐", theme="偏好")
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        c = MemoryCoordinator(long_term_mm=mm, episodic_mm=em, semantic_mm=sm)
        # find_similar 在 RAG 不可用时回退到 bigram，可能仍有结果
        results = c.retrieve(query="古典音乐", layers=["long"])
        assert "long" in results
        assert isinstance(results["long"], list)


class TestRetrieveWithSemantic:
    """含语义记忆的检索测试（关键词回退）。"""

    def test_retrieve_semantic_keyword_fallback(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact("用户", "喜欢", "古典音乐")
        c = MemoryCoordinator(semantic_mm=sm)
        results = c.retrieve(query="喜欢", layers=["semantic"])
        assert len(results["semantic"]) == 1
        assert results["semantic"][0]["object"] == "古典音乐"


class TestRetrieveText:
    """retrieve_text 格式化输出测试。"""

    def test_retrieve_text_empty(self, coordinator):
        text = coordinator.retrieve_text(query="测试")
        assert text == ""

    def test_retrieve_text_with_semantic(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact("用户", "喜欢", "古典音乐")
        c = MemoryCoordinator(semantic_mm=sm)
        text = c.retrieve_text(query="喜欢", layers=["semantic"])
        assert "## 语义记忆" in text
        assert "用户" in text
        assert "古典音乐" in text

    def test_retrieve_text_with_episodic_mocked(self, tmp_path):
        """使用 mock 让 episodic retrieve 返回结果。"""
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        em.add_episode(summary="用户询问了天气")
        c = MemoryCoordinator(episodic_mm=em)
        # Mock episodic_mm.retrieve 返回有内容
        c.episodic_mm.retrieve = MagicMock(
            return_value=[
                {
                    "id": "ep_test",
                    "summary": "用户询问了天气",
                    "timestamp": "2026-07-04 12:00:00",
                    "similarity": 0.85,
                }
            ]
        )
        text = c.retrieve_text(query="天气", layers=["episodic"])
        assert "## 情景记忆" in text
        assert "用户询问了天气" in text
        assert "85%" in text

    def test_retrieve_text_with_long_mocked(self, tmp_path):
        mm = MemoryManager(yaml_file=str(tmp_path / "l.yaml"))
        c = MemoryCoordinator(long_term_mm=mm)
        c.long_term_mm.find_similar = MagicMock(
            return_value=[
                {
                    "id": "abc12345",
                    "description": "用户喜欢古典音乐",
                    "theme": "偏好",
                    "similarity": 0.92,
                }
            ]
        )
        text = c.retrieve_text(query="音乐", layers=["long"])
        assert "## 长期记忆" in text
        assert "用户喜欢古典音乐" in text
        assert "92%" in text


class TestRetrieveErrorHandling:
    """检索失败的容错测试。"""

    def test_long_term_exception_returns_empty(self, tmp_path):
        mm = MemoryManager(yaml_file=str(tmp_path / "l.yaml"))
        c = MemoryCoordinator(long_term_mm=mm)
        # find_similar 抛异常时应被捕获
        c.long_term_mm.find_similar = MagicMock(side_effect=RuntimeError("boom"))
        results = c.retrieve(query="测试", layers=["long"])
        assert results["long"] == []

    def test_episodic_exception_returns_empty(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        c = MemoryCoordinator(episodic_mm=em)
        c.episodic_mm.retrieve = MagicMock(side_effect=RuntimeError("boom"))
        results = c.retrieve(query="测试", layers=["episodic"])
        assert results["episodic"] == []

    def test_semantic_exception_returns_empty(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        c = MemoryCoordinator(semantic_mm=sm)
        c.semantic_mm.retrieve = MagicMock(side_effect=RuntimeError("boom"))
        results = c.retrieve(query="测试", layers=["semantic"])
        assert results["semantic"] == []


class TestPurgeAllExpired:
    """purge_all_expired 跨层清理测试。"""

    def test_purge_empty_returns_zero(self, coordinator):
        result = coordinator.purge_all_expired()
        assert result == {"long": 0, "episodic": 0, "semantic": 0}

    def test_purge_with_expired_items(self, tmp_path):
        import json
        from datetime import datetime, timedelta

        path_l = tmp_path / "l.yaml"
        path_e = tmp_path / "e.json"
        path_s = tmp_path / "s.json"
        mm = MemoryManager(yaml_file=str(path_l))
        em = EpisodicMemoryManager(json_file=str(path_e))
        sm = SemanticMemoryManager(json_file=str(path_s))
        # 添加永久条目
        mm.add(description="永久", theme="身份")
        em.add_episode(summary="永久 episode")
        sm.add_fact("用户", "喜欢", "音乐")

        # 给 episodic 加一条已过期的
        ep_id_expired = em.add_episode(summary="临时", ttl=1)
        with open(path_e, "r", encoding="utf-8") as f:
            data_e = json.load(f)
        data_e[ep_id_expired]["expires_at"] = (
            datetime.now() - timedelta(hours=1)
        ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path_e, "w", encoding="utf-8") as f:
            json.dump(data_e, f, ensure_ascii=False, indent=2)

        c = MemoryCoordinator(long_term_mm=mm, episodic_mm=em, semantic_mm=sm)
        result = c.purge_all_expired()
        assert result["long"] == 0
        assert result["episodic"] == 1
        assert result["semantic"] == 0

    def test_purge_with_none_managers(self):
        c = MemoryCoordinator()
        # 所有层都是 None → 空字典
        assert c.purge_all_expired() == {}

    def test_purge_exception_isolated(self, tmp_path):
        mm = MemoryManager(yaml_file=str(tmp_path / "l.yaml"))
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        c = MemoryCoordinator(long_term_mm=mm, episodic_mm=em, semantic_mm=sm)
        # 让 long_term 抛异常
        c.long_term_mm.purge_expired = MagicMock(side_effect=RuntimeError("boom"))
        result = c.purge_all_expired()
        assert result["long"] == 0  # 异常被捕获，返回 0
        assert result["episodic"] == 0
        assert result["semantic"] == 0


class TestRetrieveWithPartialLayers:
    """仅指定部分层时的检索行为。"""

    def test_retrieve_only_semantic(self, tmp_path):
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        sm.add_fact("用户", "喜欢", "音乐")
        c = MemoryCoordinator(semantic_mm=sm)
        results = c.retrieve(query="喜欢", layers=["semantic"])
        # 不应包含 long/episodic 键
        assert "long" not in results
        assert "episodic" not in results
        assert len(results["semantic"]) == 1

    def test_retrieve_layer_with_none_manager_skipped(self, tmp_path):
        # episodic_mm 为 None，但 layers 指定 episodic
        sm = SemanticMemoryManager(json_file=str(tmp_path / "s.json"))
        c = MemoryCoordinator(semantic_mm=sm)  # 没有 episodic_mm
        results = c.retrieve(query="测试", layers=["episodic", "semantic"])
        # episodic 因 manager 为 None 被跳过（不在 results 中）
        assert "episodic" not in results
        assert "semantic" in results
