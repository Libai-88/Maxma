"""Tests for api/checkpointer_factory.py — 持久化 checkpointer 工厂单元测试。

测试策略：
- 单例行为验证：init 后 get 返回同一实例
- 配置禁用分支：persistence_enabled=False 时回退到非持久化 saver
- 未初始化回退：get_persistent_checkpointer 未 init 时返回非持久化 saver
- 生命周期：close 后单例清空，可重新 init
- 失败回退：SQLite 初始化失败时回退到非持久化 saver
- info 接口：get_checkpointer_info 返回正确状态

注：使用"非 AsyncSqliteSaver"（persistent=False）判断回退分支，而非检查具体类名。
因为 test_session_manager.py 在模块级 mock 了 sys.modules['langgraph.checkpoint.memory'].MemorySaver = object，
会污染全局导入，导致 checkpointer_factory 拿到的 MemorySaver 实际是 object 类。
这里关注"是否持久化"的行为契约，而非具体类型名。

每项测试前后重置全局单例状态，避免测试间污染。
"""

import pytest

import api.checkpointer_factory as factory
from api.checkpointer_factory import (
    close_persistent_checkpointer,
    get_checkpointer_info,
    get_persistent_checkpointer,
    init_persistent_checkpointer,
)


def _is_async_sqlite_saver(cp) -> bool:
    """判断 checkpointer 是否为 AsyncSqliteSaver（持久化）。"""
    return type(cp).__name__ == "AsyncSqliteSaver"


@pytest.fixture(autouse=True)
async def _reset_checkpointer_singleton():
    """每项测试前后清空全局单例，避免测试间污染。"""
    await close_persistent_checkpointer()
    yield
    await close_persistent_checkpointer()


@pytest.fixture
def patch_settings(monkeypatch):
    """便捷 fixture：返回一个用于 patch settings 字段的辅助函数。"""

    def _patch(**kwargs):
        fake = type("FakeSettings", (), {})()
        for k, v in kwargs.items():
            setattr(fake, k, v)
        monkeypatch.setattr(
            "config.settings.get_settings",
            lambda: fake,
        )
        return fake

    return _patch


# ── get_persistent_checkpointer（同步） ─────────────────────────


class TestGetPersistentCheckpointer:
    def test_uninitialized_returns_non_persistent_saver(self):
        """未 init 时回退到非持久化 saver（MemorySaver 或等效）。"""
        cp = get_persistent_checkpointer()
        assert not _is_async_sqlite_saver(cp)
        assert cp is not None

    def test_returns_singleton_instance(self):
        """多次调用返回同一实例。"""
        cp1 = get_persistent_checkpointer()
        cp2 = get_persistent_checkpointer()
        assert cp1 is cp2


# ── init_persistent_checkpointer（异步） ────────────────────────


class TestInitPersistentCheckpointer:
    @pytest.mark.asyncio
    async def test_disabled_returns_non_persistent_saver(self, patch_settings):
        """persistence_enabled=False 时返回非持久化 saver。"""
        patch_settings(persistence_enabled=False, persistence_db_path="")
        cp = await init_persistent_checkpointer()
        assert not _is_async_sqlite_saver(cp)

    @pytest.mark.asyncio
    async def test_init_returns_singleton(self, patch_settings, tmp_path):
        """多次 init 返回同一实例（不重复创建）。"""
        patch_settings(
            persistence_enabled=True,
            persistence_db_path=str(tmp_path / "cp.sqlite"),
        )
        cp1 = await init_persistent_checkpointer()
        cp2 = await init_persistent_checkpointer()
        assert cp1 is cp2

    @pytest.mark.asyncio
    async def test_init_creates_async_sqlite_saver(self, patch_settings, tmp_path):
        """启用持久化时创建 AsyncSqliteSaver 实例。"""
        patch_settings(
            persistence_enabled=True,
            persistence_db_path=str(tmp_path / "cp.sqlite"),
        )
        cp = await init_persistent_checkpointer()
        assert _is_async_sqlite_saver(cp)
        assert get_checkpointer_info()["persistent"] is True

    @pytest.mark.asyncio
    async def test_get_returns_initialized_instance(self, patch_settings, tmp_path):
        """init 后 get 返回同一实例。"""
        patch_settings(
            persistence_enabled=True,
            persistence_db_path=str(tmp_path / "cp.sqlite"),
        )
        await init_persistent_checkpointer()
        cp = get_persistent_checkpointer()
        assert _is_async_sqlite_saver(cp)

    @pytest.mark.asyncio
    async def test_init_falls_back_on_invalid_path(self, patch_settings):
        """SQLite 初始化失败时回退到非持久化 saver。"""
        # 使用无效路径触发异常（Windows 下 NUL 字符路径无效）
        patch_settings(
            persistence_enabled=True,
            persistence_db_path="/nonexistent\x00invalid/cp.sqlite",
        )
        cp = await init_persistent_checkpointer()
        assert not _is_async_sqlite_saver(cp)


# ── close_persistent_checkpointer ─────────────────────────────


class TestClosePersistentCheckpointer:
    @pytest.mark.asyncio
    async def test_close_clears_singleton(self):
        """close 后单例清空。"""
        cp_before = get_persistent_checkpointer()
        await close_persistent_checkpointer()
        # 重新 get 会创建新实例
        cp_after = get_persistent_checkpointer()
        assert cp_before is not cp_after

    @pytest.mark.asyncio
    async def test_close_when_uninitialized_is_noop(self):
        """未初始化时 close 不抛异常。"""
        await close_persistent_checkpointer()  # 不应抛异常

    @pytest.mark.asyncio
    async def test_can_reinit_after_close(self, patch_settings, tmp_path):
        """close 后可以重新 init。"""
        patch_settings(
            persistence_enabled=True,
            persistence_db_path=str(tmp_path / "cp.sqlite"),
        )
        cp1 = await init_persistent_checkpointer()
        await close_persistent_checkpointer()
        cp2 = await init_persistent_checkpointer()
        assert cp1 is not cp2
        assert _is_async_sqlite_saver(cp2)


# ── get_checkpointer_info ─────────────────────────────────────


class TestGetCheckpointerInfo:
    def test_uninitialized_info(self):
        """未初始化时返回 type=uninitialized。"""
        info = get_checkpointer_info()
        assert info["type"] == "uninitialized"

    @pytest.mark.asyncio
    async def test_non_persistent_saver_info(self, patch_settings):
        """非持久化 saver 状态信息：persistent=False。"""
        patch_settings(persistence_enabled=False, persistence_db_path="")
        await init_persistent_checkpointer()
        info = get_checkpointer_info()
        assert info["persistent"] is False
        assert info["type"] != "AsyncSqliteSaver"

    @pytest.mark.asyncio
    async def test_async_sqlite_saver_info(self, patch_settings, tmp_path):
        """AsyncSqliteSaver 状态信息正确，包含 db_path。"""
        db_path = str(tmp_path / "cp.sqlite")
        patch_settings(
            persistence_enabled=True,
            persistence_db_path=db_path,
        )
        await init_persistent_checkpointer()
        info = get_checkpointer_info()
        assert info["type"] == "AsyncSqliteSaver"
        assert info["persistent"] is True
        assert info["db_path"] == db_path


# ── _resolve_db_path ──────────────────────────────────────────


class TestResolveDbPath:
    def test_uses_custom_path_when_provided(self, patch_settings):
        """settings.persistence_db_path 非空时使用该路径。"""
        patch_settings(persistence_db_path="/custom/path.sqlite")
        path = factory._resolve_db_path()
        assert path == "/custom/path.sqlite"

    def test_falls_back_to_data_dir_when_empty(self, patch_settings):
        """settings.persistence_db_path 留空时使用 DATA_DIR/checkpoints.sqlite。"""
        patch_settings(persistence_db_path="")
        path = factory._resolve_db_path()
        assert path.endswith("checkpoints.sqlite")
