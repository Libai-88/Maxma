"""RAG 子系统测试 — 向量检索 + 优雅降级 + CRUD 钩子。

测试策略：
- 不依赖 chromadb/onnxruntime/transformers 实际安装（测试优雅降级）
- 使用 mock 测试向量检索路径和 CRUD 钩子
- 使用 tmp_path 隔离测试环境
"""

from unittest.mock import MagicMock, patch

import pytest

from memory.memory_manager import MemoryManager
from memory.rag import embedding, vector_store
from memory.rag.indexer import index_memory, reindex_all, remove_memory


class TestGracefulDegradation:
    """优雅降级测试：依赖未安装时返回 None。"""

    def setup_method(self):
        """每个测试前重置单例。"""
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()

    def teardown_method(self):
        """每个测试后重置单例，避免影响其他测试。"""
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()

    def test_get_embedding_engine_returns_none_when_not_installed(self):
        """onnxruntime/transformers 未安装时 get_embedding_engine 返回 None。"""
        # sys.modules 中设为 None 会导致 import 该模块时抛 ImportError
        with patch.dict("sys.modules", {"onnxruntime": None, "transformers": None}):
            engine = embedding.get_embedding_engine()
        assert engine is None

    def test_get_vector_store_returns_none_when_not_installed(self):
        """chromadb 未安装时 get_vector_store 返回 None。"""
        with patch.dict("sys.modules", {"chromadb": None}):
            store = vector_store.get_vector_store()
        assert store is None

    def test_find_similar_falls_back_to_bigram(self, tmp_path):
        """RAG 不可用时 find_similar 回退到 bigram Jaccard。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("用户喜欢听初音未来的歌", theme="音乐")
        mm.add("今天天气很好", theme="瞬间")

        # 确保 RAG 单例未初始化
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()

        results = mm.find_similar("用户爱听初音未来", theme="音乐", threshold=0.3)
        assert len(results) >= 1
        assert results[0]["theme"] == "音乐"
        assert "初音" in results[0]["description"]


class TestEmbeddingEngine:
    """EmbeddingEngine 单元测试（不加载真实模型）。"""

    def setup_method(self):
        embedding.reset_embedding_engine()

    def teardown_method(self):
        embedding.reset_embedding_engine()

    def test_embed_empty_list_returns_empty(self):
        """embed([]) 返回空列表，不加载模型。"""
        engine = embedding.EmbeddingEngine(model_name="test-model")
        assert engine.embed([]) == []

    def test_get_embedding_engine_singleton(self):
        """get_embedding_engine 返回同一实例。"""
        with patch.dict("sys.modules", {"onnxruntime": MagicMock(), "transformers": MagicMock()}):
            embedding.reset_embedding_engine()
            engine1 = embedding.get_embedding_engine()
            engine2 = embedding.get_embedding_engine()
            assert engine1 is engine2


class TestVectorStore:
    """VectorStore 单元测试（mock chromadb）。"""

    def setup_method(self):
        vector_store.reset_vector_store()

    def teardown_method(self):
        vector_store.reset_vector_store()

    def test_collection_constants_are_distinct(self):
        """4 个 collection 名称互不相同。"""
        names = {
            vector_store.COLLECTION_LONG_TERM,
            vector_store.COLLECTION_EPISODIC,
            vector_store.COLLECTION_SEMANTIC,
            vector_store.COLLECTION_KB,
        }
        assert len(names) == 4


class TestCrudHooks:
    """CRUD 钩子测试：add/update/delete/merge 时同步索引到向量库。"""

    def setup_method(self):
        """每个测试前重置 RAG 单例和 auto-reindex 标记。"""
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        # 清空 auto-reindex 标记
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def teardown_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def test_add_calls_index_memory(self, tmp_path):
        """add 操作后调用 index_memory。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        with patch("memory.rag.indexer.index_memory") as mock_index:
            mm.add("测试记忆", theme="测试")
        mock_index.assert_called_once()
        args = mock_index.call_args[0]
        assert args[1] == "测试记忆"
        assert args[2] == "测试"

    def test_delete_calls_remove_memory(self, tmp_path):
        """delete 操作后调用 remove_memory。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mem_id = mm.add("待删除", theme="测试")
        with patch("memory.rag.indexer.remove_memory") as mock_remove:
            mm.delete(mem_id)
        mock_remove.assert_called_once_with(mem_id)

    def test_update_calls_index_memory(self, tmp_path):
        """update 操作后调用 index_memory 更新索引。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mem_id = mm.add("旧内容", theme="测试")
        with patch("memory.rag.indexer.index_memory") as mock_index:
            mm.update(mem_id, reason="更新", new_description="新内容")
        mock_index.assert_called_once()
        args = mock_index.call_args[0]
        assert args[0] == mem_id
        assert args[1] == "新内容"

    def test_merge_calls_remove_and_index(self, tmp_path):
        """merge 操作后调用 remove_memory(id2) + index_memory(id1)。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        id1 = mm.add("记忆A", theme="测试")
        id2 = mm.add("记忆B", theme="测试")
        with patch("memory.rag.indexer.remove_memory") as mock_remove, \
             patch("memory.rag.indexer.index_memory") as mock_index:
            mm.merge(id1, id2, merged_description="合并后", merged_theme="测试", reason="合并")
        mock_remove.assert_called_once_with(id2)
        mock_index.assert_called_once()
        args = mock_index.call_args[0]
        assert args[0] == id1
        assert args[1] == "合并后"


class TestFindSimilarVector:
    """向量检索路径测试（mock embedding + vector_store）。"""

    def setup_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def teardown_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def test_find_similar_uses_vector_when_available(self, tmp_path):
        """RAG 可用时使用向量检索。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("已有记忆", theme="测试")

        # Mock RAG 组件
        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2, 0.3]]
        mock_store = MagicMock()
        mock_store.count.return_value = 1  # collection 已有数据，跳过 auto-reindex
        mock_store.query.return_value = [
            {
                "id": "abc123",
                "document": "已有记忆",
                "metadata": {"theme": "测试"},
                "distance": 0.1,  # similarity = 0.9
            }
        ]

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine), \
             patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
            results = mm.find_similar("查询文本", theme="测试", threshold=0.5)

        assert len(results) == 1
        assert results[0]["id"] == "abc123"
        assert results[0]["similarity"] >= 0.9
        mock_engine.embed.assert_called_once_with(["查询文本"])

    def test_find_similar_falls_back_on_vector_error(self, tmp_path):
        """向量检索异常时回退到 bigram。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("用户喜欢初音未来", theme="音乐")

        mock_engine = MagicMock()
        mock_engine.embed.side_effect = RuntimeError("model load failed")
        mock_store = MagicMock()
        mock_store.count.return_value = 1

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine), \
             patch("memory.rag.vector_store.get_vector_store", return_value=mock_store):
            results = mm.find_similar("用户爱初音未来", theme="音乐", threshold=0.2)

        # 应回退到 bigram 并返回结果
        assert len(results) >= 1
        assert "初音" in results[0]["description"]


class TestAutoReindex:
    """自动重建索引测试。"""

    def setup_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def teardown_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def test_auto_reindex_triggers_on_empty_collection(self, tmp_path):
        """collection 为空但 YAML 有数据时，自动触发 reindex。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("记忆1", theme="测试")
        mm.add("记忆2", theme="测试")

        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2]]
        mock_store = MagicMock()
        mock_store.count.return_value = 0  # collection 为空
        mock_store.query.return_value = []

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine), \
             patch("memory.rag.vector_store.get_vector_store", return_value=mock_store), \
             patch("memory.rag.indexer.reindex_all", return_value=2) as mock_reindex:
            mm.find_similar("查询", threshold=0.5)

        mock_reindex.assert_called_once()
        # 验证传入 reindex_all 的是 MemoryItem 字典
        items_arg = mock_reindex.call_args[0][0]
        assert len(items_arg) == 2

    def test_auto_reindex_skips_when_collection_has_data(self, tmp_path):
        """collection 已有数据时不触发 reindex。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("记忆1", theme="测试")

        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2]]
        mock_store = MagicMock()
        mock_store.count.return_value = 5  # collection 已有数据
        mock_store.query.return_value = []

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine), \
             patch("memory.rag.vector_store.get_vector_store", return_value=mock_store), \
             patch("memory.rag.indexer.reindex_all") as mock_reindex:
            mm.find_similar("查询", threshold=0.5)

        mock_reindex.assert_not_called()

    def test_auto_reindex_only_runs_once_per_file(self, tmp_path):
        """同一 yaml 文件只 auto-reindex 一次。"""
        yaml_path = str(tmp_path / "memory.yaml")
        mm = MemoryManager(yaml_file=yaml_path)
        mm.add("记忆1", theme="测试")

        mock_engine = MagicMock()
        mock_engine.embed.return_value = [[0.1, 0.2]]
        mock_store = MagicMock()
        mock_store.count.return_value = 0
        mock_store.query.return_value = []

        with patch("memory.rag.embedding.get_embedding_engine", return_value=mock_engine), \
             patch("memory.rag.vector_store.get_vector_store", return_value=mock_store), \
             patch("memory.rag.indexer.reindex_all", return_value=1):
            mm.find_similar("查询1", threshold=0.5)
            mm.find_similar("查询2", threshold=0.5)

        from memory import memory_manager as mm_module
        assert yaml_path in mm_module._auto_reindexed


class TestReindexPublic:
    """公开 reindex 方法测试。"""

    def setup_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def teardown_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()
        from memory import memory_manager as mm_module
        mm_module._auto_reindexed.clear()

    def test_reindex_returns_zero_when_empty(self, tmp_path):
        """空 YAML 调用 reindex 返回 0。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        with patch("memory.rag.indexer.reindex_all") as mock_reindex:
            result = mm.reindex()
        assert result == 0
        mock_reindex.assert_not_called()

    def test_reindex_delegates_to_indexer(self, tmp_path):
        """有数据时 reindex 委托给 reindex_all。"""
        mm = MemoryManager(yaml_file=str(tmp_path / "memory.yaml"))
        mm.add("记忆1", theme="测试")
        mm.add("记忆2", theme="测试")

        with patch("memory.rag.indexer.reindex_all", return_value=2) as mock_reindex:
            result = mm.reindex()
        assert result == 2
        mock_reindex.assert_called_once()


class TestIndexerBestEffort:
    """Indexer best-effort 行为测试：RAG 不可用时静默跳过。"""

    def setup_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()

    def teardown_method(self):
        embedding.reset_embedding_engine()
        vector_store.reset_vector_store()

    def test_index_memory_noop_when_unavailable(self):
        """RAG 不可用时 index_memory 是 no-op，不抛异常。"""
        # 不 mock，依赖未安装时直接跳过
        index_memory("test-id", "测试内容", "测试")  # 不应抛异常

    def test_remove_memory_noop_when_unavailable(self):
        """RAG 不可用时 remove_memory 是 no-op，不抛异常。"""
        remove_memory("test-id")  # 不应抛异常

    def test_reindex_all_returns_zero_when_unavailable(self):
        """RAG 不可用时 reindex_all 返回 0。"""
        result = reindex_all({})
        assert result == 0
