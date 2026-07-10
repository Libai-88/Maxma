"""情景记忆层测试 — memory/episodic.py。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装（测试优雅降级）
- 使用 tmp_path 隔离 JSON 存储
- 使用 mock 测试向量检索路径
"""

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from memory.episodic import EpisodicMemoryManager
from memory.memory_manager import _is_expired
from memory.rag import embedding, vector_store


@pytest.fixture(autouse=True)
def _reset_rag_singletons():
    """每个测试前后重置 RAG 单例，避免污染。"""
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()
    yield
    embedding.reset_embedding_engine()
    vector_store.reset_vector_store()


class TestEpisodicInit:
    """初始化与文件创建测试。"""

    def test_init_creates_json_file(self, tmp_path):
        path = tmp_path / "episodic.json"
        em = EpisodicMemoryManager(json_file=str(path))
        assert path.exists()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data == {}

    def test_init_creates_parent_dir(self, tmp_path):
        path = tmp_path / "sub" / "episodic.json"
        EpisodicMemoryManager(json_file=str(path))
        assert path.exists()

    def test_default_ttl_none(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        assert em._default_ttl is None


class TestAddEpisode:
    """add_episode 行为测试。"""

    def test_add_returns_ep_id(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        ep_id = em.add_episode(summary="用户询问天气", session_id="s1")
        assert ep_id.startswith("ep_")
        assert len(ep_id) == len("ep_") + 8

    def test_add_persists_to_json(self, tmp_path):
        path = tmp_path / "e.json"
        em = EpisodicMemoryManager(json_file=str(path))
        ep_id = em.add_episode(
            summary="测试摘要",
            session_id="s1",
            turn_id="t1",
            message_count=4,
        )
        data = json.loads(path.read_text(encoding="utf-8"))
        assert ep_id in data
        record = data[ep_id]
        assert record["summary"] == "测试摘要"
        assert record["session_id"] == "s1"
        assert record["turn_id"] == "t1"
        assert record["message_count"] == 4
        assert record["timestamp"]  # 非空

    def test_add_with_ttl_sets_expires_at(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        ep_id = em.add_episode(summary="临时", ttl=3600)
        data = em.list_episodes()
        assert data[0]["ttl"] == 3600
        assert data[0]["expires_at"]
        assert _is_expired(data[0]["expires_at"]) is False

    def test_add_uses_default_ttl(self, tmp_path):
        em = EpisodicMemoryManager(
            json_file=str(tmp_path / "e.json"),
            default_ttl=86400,
        )
        em.add_episode(summary="默认 TTL")
        data = em.list_episodes()
        assert data[0]["ttl"] == 86400

    def test_add_no_ttl_permanent(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        em.add_episode(summary="永久")
        data = em.list_episodes()
        assert data[0]["ttl"] is None
        assert data[0]["expires_at"] is None

    def test_add_is_idempotent_for_session_and_turn(self, tmp_path):
        """自动投影重试不能为同一个 chat turn 创建多个快照。"""
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        first_id = em.add_episode(
            summary="首次摘要", session_id="session-1", turn_id="turn-1"
        )
        duplicate_id = em.add_episode(
            summary="重试时不应覆盖", session_id="session-1", turn_id="turn-1"
        )

        assert duplicate_id == first_id
        episodes = em.list_episodes()
        assert len(episodes) == 1
        assert episodes[0]["summary"] == "首次摘要"

    def test_same_turn_id_is_not_deduplicated_across_sessions(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        first_id = em.add_episode(
            summary="会话一", session_id="session-1", turn_id="turn-1"
        )
        second_id = em.add_episode(
            summary="会话二", session_id="session-2", turn_id="turn-1"
        )

        assert second_id != first_id
        assert len(em.list_episodes()) == 2


class TestListAndDelete:
    """list_episodes / delete_episode 测试。"""

    def test_list_empty(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        assert em.list_episodes() == []

    def test_list_returns_sorted_desc(self, tmp_path):
        import time

        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        id1 = em.add_episode(summary="first")
        time.sleep(1.1)  # 跨秒确保 timestamp 不同
        id2 = em.add_episode(summary="second")
        result = em.list_episodes()
        assert len(result) == 2
        # 时间倒序：second 在前
        assert result[0]["id"] == id2
        assert result[1]["id"] == id1

    def test_list_filters_expired(self, tmp_path):
        path = tmp_path / "e.json"
        em = EpisodicMemoryManager(json_file=str(path))
        # 添加一条已过期的
        em.add_episode(summary="过期项", ttl=1)
        # 手动改 expires_at 为过去时间
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for record in data.values():
            record["expires_at"] = (
                datetime.now() - timedelta(hours=1)
            ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # 默认不显示已过期
        assert em.list_episodes() == []
        # include_expired=True 显示
        assert len(em.list_episodes(include_expired=True)) == 1

    def test_delete_removes_episode(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        ep_id = em.add_episode(summary="to delete")
        removed = em.delete_episode(ep_id)
        assert removed == "to delete"
        assert em.list_episodes() == []

    def test_delete_nonexistent_raises(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        with pytest.raises(ValueError, match="not found"):
            em.delete_episode("ep_nonexistent")


class TestPurgeExpired:
    """purge_expired 行为测试。"""

    def test_purge_no_expired_returns_zero(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        em.add_episode(summary="permanent")
        assert em.purge_expired() == 0

    def test_purge_removes_expired(self, tmp_path):
        path = tmp_path / "e.json"
        em = EpisodicMemoryManager(json_file=str(path))
        em.add_episode(summary="永久")
        em.add_episode(summary="临时", ttl=1)
        # 手动改第二条 expires_at 为过去
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        keys = list(data.keys())
        data[keys[1]]["expires_at"] = (
            datetime.now() - timedelta(hours=1)
        ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # 清理
        purged = em.purge_expired()
        assert purged == 1
        assert len(em.list_episodes()) == 1
        assert em.list_episodes()[0]["summary"] == "永久"


class TestRetrieveDegradation:
    """retrieve 在 RAG 不可用时的优雅降级。"""

    def test_retrieve_returns_empty_when_rag_unavailable(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        em.add_episode(summary="测试")
        # RAG 单例已被 fixture 重置为 None
        results = em.retrieve(query="测试")
        assert results == []

    def test_retrieve_uses_vector_store(self, tmp_path):
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        ep_id = em.add_episode(summary="用户询问天气")
        # Mock 向量检索
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2, 0.3]]
        mock_store = MagicMock()
        mock_store.query.return_value = [
            {"id": ep_id, "document": "用户询问天气", "metadata": {}, "distance": 0.1}
        ]
        with (
            patch(
                "memory.rag.embedding.get_embedding_engine", return_value=mock_engine
            ),
            patch(
                "memory.rag.vector_store.get_vector_store", return_value=mock_store
            ),
        ):
            results = em.retrieve(query="天气", top_k=5)
        assert len(results) == 1
        assert results[0]["id"] == ep_id
        assert results[0]["summary"] == "用户询问天气"
        # similarity = 1 - 0.1 = 0.9
        assert results[0]["similarity"] == pytest.approx(0.9, abs=0.01)

    def test_retrieve_filters_to_requested_session(self, tmp_path):
        """自动检索不能把另一会话的相似记录注入当前上下文。"""
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        current_id = em.add_episode(summary="当前会话的项目计划", session_id="current")
        other_id = em.add_episode(summary="其他会话的私有计划", session_id="other")
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2, 0.3]]
        mock_store = MagicMock()
        # 即使底层索引返回了不匹配记录，JSON 权威层也会再次过滤。
        mock_store.query.return_value = [
            {"id": other_id, "document": "其他会话的私有计划", "metadata": {}, "distance": 0.01},
            {"id": current_id, "document": "当前会话的项目计划", "metadata": {}, "distance": 0.1},
        ]
        with (
            patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine),
            patch("memory.rag.vector_store.get_vector_store", return_value=mock_store),
        ):
            results = em.retrieve(query="计划", session_id="current")

        assert [item["id"] for item in results] == [current_id]
        assert mock_store.query.call_args.kwargs["where"] == {"session_id": "current"}

    def test_retrieve_filters_expired(self, tmp_path):
        path = tmp_path / "e.json"
        em = EpisodicMemoryManager(json_file=str(path))
        ep_id = em.add_episode(summary="已过期")
        # 改为过期
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data[ep_id]["expires_at"] = (
            datetime.now() - timedelta(hours=1)
        ).strftime("%Y-%m-%d %H:%M:%S")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # Mock 向量检索仍然返回这条
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2, 0.3]]
        mock_store = MagicMock()
        mock_store.query.return_value = [
            {"id": ep_id, "document": "已过期", "metadata": {}, "distance": 0.1}
        ]
        with (
            patch(
                "memory.rag.embedding.get_embedding_engine", return_value=mock_engine
            ),
            patch(
                "memory.rag.vector_store.get_vector_store", return_value=mock_store
            ),
        ):
            # 默认不包含已过期
            assert em.retrieve(query="测试") == []
            # include_expired=True 返回
            assert len(em.retrieve(query="测试", include_expired=True)) == 1


class TestVectorIndexBestEffort:
    """向量索引 best-effort 行为。"""

    def test_index_failure_does_not_raise(self, tmp_path):
        """向量索引失败不应影响 add_episode。"""
        em = EpisodicMemoryManager(json_file=str(tmp_path / "e.json"))
        with patch(
            "memory.rag.embedding.get_embedding_engine",
            side_effect=RuntimeError("boom"),
        ):
            # 不应抛异常
            ep_id = em.add_episode(summary="测试")
        assert ep_id  # 仍然写入 JSON
        assert len(em.list_episodes()) == 1
