"""Tests for api/checkpointer_factory.py — oh-my-pi sidecar 模式 no-op 存根。

该模块保留为兼容导入的零操作存根（LangGraph 时代遗留）。测试锁定其
no-op 契约：所有 init/get/close 都是无副作用操作，info 返回固定结构。

发现：模块当前无任何内部 Python 代码导入（仅在文档/计划中引用），
是 oh-my-pi 迁移后保留的兼容性存根。建议在兼容窗口结束后移除。
"""

from __future__ import annotations

from api import checkpointer_factory


class TestInitPersistentCheckpointer:
    """init_persistent_checkpointer 是异步 no-op。"""

    async def test_returns_none(self):
        """应返回 None 且无副作用。"""
        result = await checkpointer_factory.init_persistent_checkpointer()
        assert result is None

    async def test_is_callable_multiple_times(self):
        """多次调用应幂等。"""
        await checkpointer_factory.init_persistent_checkpointer()
        await checkpointer_factory.init_persistent_checkpointer()
        # 无异常即通过


class TestGetPersistentCheckpointer:
    """get_persistent_checkpointer 返回 None。"""

    def test_returns_none(self):
        """sidecar 模式下不存在 checkpointer。"""
        assert checkpointer_factory.get_persistent_checkpointer() is None

    def test_returns_none_consistently(self):
        """多次调用始终返回 None。"""
        for _ in range(3):
            assert checkpointer_factory.get_persistent_checkpointer() is None


class TestClosePersistentCheckpointer:
    """close_persistent_checkpointer 是异步 no-op。"""

    async def test_returns_none(self):
        """应返回 None 且无副作用。"""
        result = await checkpointer_factory.close_persistent_checkpointer()
        assert result is None

    async def test_close_without_init_is_safe(self):
        """未 init 直接 close 也应安全。"""
        await checkpointer_factory.close_persistent_checkpointer()


class TestGetCheckpointerInfo:
    """get_checkpointer_info 返回 sidecar 模式状态信息。"""

    def test_returns_dict(self):
        """应返回字典。"""
        info = checkpointer_factory.get_checkpointer_info()
        assert isinstance(info, dict)

    def test_type_is_none(self):
        """sidecar 模式下 type 应为 'none'。"""
        assert checkpointer_factory.get_checkpointer_info()["type"] == "none"

    def test_persistent_is_false(self):
        """persistent 应为 False（无持久化）。"""
        assert checkpointer_factory.get_checkpointer_info()["persistent"] is False

    def test_db_path_is_empty(self):
        """db_path 应为空字符串。"""
        assert checkpointer_factory.get_checkpointer_info()["db_path"] == ""

    def test_mode_indicates_sidecar(self):
        """mode 应表明使用 sidecar 模式、无需 checkpointer。"""
        mode = checkpointer_factory.get_checkpointer_info()["mode"]
        assert "sidecar" in mode
        assert "no checkpointer" in mode

    def test_info_has_expected_keys(self):
        """info 字典应包含全部预期字段。"""
        info = checkpointer_factory.get_checkpointer_info()
        assert set(info.keys()) == {"type", "persistent", "db_path", "mode"}


class TestNoopContract:
    """验证 init/get/close 完整生命周期无副作用。"""

    async def test_full_lifecycle_is_noop(self):
        """init -> get -> close -> info 全链路 no-op。"""
        await checkpointer_factory.init_persistent_checkpointer()
        assert checkpointer_factory.get_persistent_checkpointer() is None
        await checkpointer_factory.close_persistent_checkpointer()
        info = checkpointer_factory.get_checkpointer_info()
        # 关闭后状态仍一致
        assert info["type"] == "none"
        assert info["persistent"] is False
