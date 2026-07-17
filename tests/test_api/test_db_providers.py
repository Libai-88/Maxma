"""测试 — api/db/providers.py ProviderDbStore STUB（已弃用）。

模块本身是 STUB，所有方法都是 no-op。验证 STUB 行为正确：
- load_all → []
- get → None
- save → 无副作用
- delete → False
- is_empty → True
- migrate_from_yaml → 0
确保弃用后调用不会抛异常或返回非预期值。
"""

from __future__ import annotations

import pytest

from api.db.providers import ProviderDbStore


# ── STUB 方法行为验证 ────────────────────────────────────────────


class TestStubBehavior:
    def test_load_all_returns_empty_list(self):
        store = ProviderDbStore()
        result = store.load_all()
        assert result == []
        assert isinstance(result, list)

    def test_get_returns_none_for_any_id(self):
        store = ProviderDbStore()
        assert store.get("openai") is None
        assert store.get("anthropic") is None
        assert store.get("any-id") is None
        assert store.get("") is None

    def test_save_is_noop_no_exception(self):
        store = ProviderDbStore()
        # 任何 config 都不应抛异常
        store.save({"id": "openai", "api_key": "sk-xxx"})
        store.save(None)
        store.save({})
        store.save([])
        store.save("string")

    def test_save_returns_none(self):
        store = ProviderDbStore()
        result = store.save({"id": "x"})
        assert result is None

    def test_delete_returns_false(self):
        store = ProviderDbStore()
        assert store.delete("openai") is False
        assert store.delete("") is False
        assert store.delete("any-id") is False

    def test_is_empty_true(self):
        store = ProviderDbStore()
        assert store.is_empty is True

    def test_migrate_from_yaml_returns_zero(self):
        store = ProviderDbStore()
        result = store.migrate_from_yaml()
        assert result == 0

    def test_is_empty_remains_true_after_save(self):
        """save 是 no-op，is_empty 应仍为 True。"""
        store = ProviderDbStore()
        store.save({"id": "openai", "api_key": "sk-xxx"})
        assert store.is_empty is True

    def test_load_all_remains_empty_after_save(self):
        """save 是 no-op，load_all 应仍返回 []。"""
        store = ProviderDbStore()
        store.save({"id": "openai", "api_key": "sk-xxx"})
        assert store.load_all() == []

    def test_get_remains_none_after_save(self):
        """save 是 no-op，get 应仍返回 None。"""
        store = ProviderDbStore()
        store.save({"id": "openai", "api_key": "sk-xxx"})
        assert store.get("openai") is None

    def test_migrate_from_yaml_idempotent(self):
        """多次调用 migrate_from_yaml 都返回 0，无副作用。"""
        store = ProviderDbStore()
        for _ in range(5):
            assert store.migrate_from_yaml() == 0


# ── 实例独立性 ───────────────────────────────────────────────────


class TestInstanceIndependence:
    def test_multiple_instances_independent(self):
        """多个 ProviderDbStore 实例互不影响。"""
        s1 = ProviderDbStore()
        s2 = ProviderDbStore()

        s1.save({"id": "openai"})
        # s2 不应受影响
        assert s2.load_all() == []
        assert s2.get("openai") is None
        assert s2.is_empty is True

    def test_each_instance_has_independent_state(self):
        """每个实例都是独立的 STUB（实际上无状态）。"""
        s1 = ProviderDbStore()
        s2 = ProviderDbStore()
        # STUB 无状态，但实例是不同对象
        assert s1 is not s2


# ── 安全边界：保证 STUB 不返回任何凭据 ───────────────────────────────


class TestSecurityBoundaries:
    def test_get_does_not_leak_credentials(self):
        """get 应始终返回 None — STUB 不会泄漏任何凭据。"""
        store = ProviderDbStore()
        # 即使先 save 了凭据，get 也应返回 None
        store.save({"id": "x", "api_key": "super-secret-key-12345"})
        result = store.get("x")
        assert result is None
        assert result != "super-secret-key-12345"

    def test_load_all_does_not_leak_credentials(self):
        """load_all 应始终返回空列表 — 不会泄漏已 save 的凭据。"""
        store = ProviderDbStore()
        store.save({"id": "x", "api_key": "super-secret-key-12345"})
        result = store.load_all()
        assert result == []
        # 不应包含任何凭据信息
        for item in result:
            assert "api_key" not in item
            assert "secret" not in item

    def test_save_does_not_persist_sensitive_data(self):
        """save 是 no-op — 不会持久化任何敏感数据。"""
        store = ProviderDbStore()
        # save 含敏感数据的 config
        store.save({
            "id": "x",
            "api_key": "sk-super-secret",
            "password": "my-password",
            "token": "my-token",
        })
        # 通过其他方法验证未持久化
        assert store.get("x") is None
        assert store.load_all() == []
        assert store.is_empty is True

    def test_get_with_empty_id(self):
        store = ProviderDbStore()
        assert store.get("") is None

    def test_get_with_none_id(self):
        """get(None) 应返回 None（STUB 不依赖 provider_id）。"""
        store = ProviderDbStore()
        assert store.get(None) is None

    def test_delete_with_empty_id(self):
        store = ProviderDbStore()
        assert store.delete("") is False

    def test_delete_with_none_id(self):
        store = ProviderDbStore()
        assert store.delete(None) is False

    def test_delete_with_sql_injection_id(self):
        """delete 含 SQL 注入的 ID 应安全返回 False（不接触 DB）。"""
        store = ProviderDbStore()
        malicious_id = "'; DROP TABLE providers; --"
        assert store.delete(malicious_id) is False

    def test_save_with_none_does_not_raise(self):
        """save(None) 应是 no-op，不抛异常。"""
        store = ProviderDbStore()
        store.save(None)

    def test_save_with_empty_dict(self):
        """save({}) 应是 no-op。"""
        store = ProviderDbStore()
        store.save({})


# ── 弃用契约验证 ───────────────────────────────────────────────


class TestDeprecationContract:
    """验证 STUB 的弃用契约：所有方法可调用且无副作用。

    这确保遗留代码导入 ProviderDbStore 时不会崩溃，同时不会污染
    OMP ModelRegistry 管理的真实 provider 配置。
    """

    def test_all_methods_callable(self):
        store = ProviderDbStore()
        # 所有方法都应可调用且不抛异常
        assert store.load_all() == []
        assert store.get("any") is None
        store.save({"any": "config"})
        assert store.delete("any") is False
        assert store.is_empty is True
        assert store.migrate_from_yaml() == 0

    def test_method_signatures_compatible(self):
        """方法签名应与未弃用版本兼容（参数不强制类型）。"""
        store = ProviderDbStore()
        # load_all 无参数
        store.load_all()
        # get 接受 str
        store.get("openai")
        # save 接受任意对象
        store.save({})
        store.save(None)
        # delete 接受 str
        store.delete("openai")
        # migrate_from_yaml 无参数
        store.migrate_from_yaml()

    def test_stub_does_not_touch_real_db(self, tmp_path, monkeypatch):
        """STUB 不应触碰真实 DB — 即使 DB_PATH 重定向，行为不变。"""
        import api.db.core as db_core

        test_db = tmp_path / "test_providers.db"
        monkeypatch.setattr(db_core, "DB_PATH", test_db)
        monkeypatch.setattr(db_core, "_db_initialized", False)
        db_core.initialize_database()

        store = ProviderDbStore()
        # 所有操作都不应创建 providers 表行（STUB 不写 DB）
        store.save({"id": "x"})
        assert store.load_all() == []
        assert store.get("x") is None
        assert store.is_empty is True
        assert store.migrate_from_yaml() == 0
