"""测试 — api/db/hooks.py 事件钩子配置 SQLite 存储。

覆盖 HookDbStore 的 load_all / get / save / delete 方法，包括 JSON
config 序列化、enabled bool 转换、UPSERT 冲突处理及 SQL 注入安全边界。
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from api.db.core import transaction
from api.db.hooks import HookDbStore


# ── DB 隔离 fixture ──────────────────────────────────────────────


@pytest.fixture
def isolated_db(tmp_path: Path, monkeypatch) -> Path:
    """重定向 DB_PATH 到 tmp_path 并初始化 schema。"""
    import api.db.core as db_core

    test_db = tmp_path / "test_hooks.db"
    monkeypatch.setattr(db_core, "DB_PATH", test_db)
    monkeypatch.setattr(db_core, "_db_initialized", False)
    db_core.initialize_database()
    yield test_db


@pytest.fixture
def store(isolated_db) -> HookDbStore:
    """返回使用隔离 DB 的 HookDbStore 实例。"""
    return HookDbStore()


def _make_hook(
    hook_id: str = "h1",
    name: str = "hook name",
    hook_type: str = "webhook",
    config: dict | None = None,
    action: str = "POST http://example.com",
    status: str = "active",
    enabled: bool = True,
    created_at: float | None = None,
    last_triggered: float | None = None,
    trigger_count: int = 0,
) -> dict:
    """构造完整的 hook dict。"""
    return {
        "hook_id": hook_id,
        "name": name,
        "hook_type": hook_type,
        "config": config if config is not None else {"url": "http://x"},
        "action": action,
        "status": status,
        "enabled": enabled,
        "created_at": created_at if created_at is not None else time.time(),
        "last_triggered": last_triggered,
        "trigger_count": trigger_count,
    }


def _raw_insert_hook(hook: dict) -> None:
    """绕过 HookDbStore 直接插入行（用于测试 load/get 的读取逻辑）。"""
    config_json = json.dumps(hook.get("config", {}), ensure_ascii=False)
    with transaction() as conn:
        conn.execute(
            """INSERT INTO event_hooks
               (hook_id, name, hook_type, config, action, status,
                enabled, created_at, last_triggered, trigger_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                hook["hook_id"],
                hook.get("name", ""),
                hook.get("hook_type", ""),
                config_json,
                hook.get("action", ""),
                hook.get("status", "active"),
                1 if hook.get("enabled", True) else 0,
                hook.get("created_at", time.time()),
                hook.get("last_triggered"),
                hook.get("trigger_count", 0),
            ),
        )


# ── load_all ─────────────────────────────────────────────────────


class TestLoadAll:
    def test_empty_returns_empty_list(self, store):
        assert store.load_all() == []

    def test_returns_rows_as_dicts(self, store):
        _raw_insert_hook(_make_hook(hook_id="h1", name="first"))
        result = store.load_all()
        assert len(result) == 1
        assert isinstance(result[0], dict)
        assert result[0]["hook_id"] == "h1"
        assert result[0]["name"] == "first"

    def test_ordered_by_created_at(self, store):
        # 显式设置不同 created_at 以验证排序
        _raw_insert_hook(_make_hook(hook_id="h_late", created_at=200.0))
        _raw_insert_hook(_make_hook(hook_id="h_early", created_at=100.0))
        _raw_insert_hook(_make_hook(hook_id="h_mid", created_at=150.0))

        result = store.load_all()
        # 按 created_at 升序
        assert [r["hook_id"] for r in result] == ["h_early", "h_mid", "h_late"]

    def test_parses_config_json_to_dict(self, store):
        _raw_insert_hook(_make_hook(hook_id="h1", config={"url": "http://x", "method": "POST"}))
        result = store.load_all()
        assert result[0]["config"] == {"url": "http://x", "method": "POST"}

    def test_converts_enabled_int_to_bool(self, store):
        _raw_insert_hook(_make_hook(hook_id="h1", enabled=True))
        _raw_insert_hook(_make_hook(hook_id="h2", enabled=False))
        result = store.load_all()
        # enabled=True 存为 1，load_all 转 bool
        enabled_map = {r["hook_id"]: r["enabled"] for r in result}
        assert enabled_map["h1"] is True
        assert enabled_map["h2"] is False

    def test_returns_dict_with_all_expected_fields(self, store):
        _raw_insert_hook(
            _make_hook(
                hook_id="h1",
                name="n",
                hook_type="webhook",
                action="do",
                status="active",
                enabled=True,
                last_triggered=123.45,
                trigger_count=7,
            )
        )
        result = store.load_all()
        hook = result[0]
        assert hook["hook_id"] == "h1"
        assert hook["name"] == "n"
        assert hook["hook_type"] == "webhook"
        assert hook["action"] == "do"
        assert hook["status"] == "active"
        assert hook["enabled"] is True
        assert hook["last_triggered"] == 123.45
        assert hook["trigger_count"] == 7
        assert "created_at" in hook
        assert isinstance(hook["config"], dict)

    def test_handles_default_empty_config_string(self, store):
        """config 列为 '{}'（schema 默认值）→ load_all 应返回空 dict。

        event_hooks 表的 config 列是 NOT NULL DEFAULT '{}'，所以
        无法插入 NULL，但可以通过显式插入 '{}' 来验证默认行为。
        load_all 的源码使用 dict(r).get('config', '{}') + json.loads 来解析。
        """
        with transaction() as conn:
            conn.execute(
                """INSERT INTO event_hooks
                   (hook_id, name, hook_type, config, action, status,
                    enabled, created_at, last_triggered, trigger_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("h_default", "n", "t", "{}", "a", "active", 1, time.time(), None, 0),
            )
        result = store.load_all()
        assert len(result) == 1
        assert result[0]["config"] == {}

    def test_load_all_after_save_returns_saved_data(self, store):
        hook = _make_hook(hook_id="h1", name="saved", config={"k": "v"})
        store.save(hook)
        result = store.load_all()
        assert len(result) == 1
        assert result[0]["hook_id"] == "h1"
        assert result[0]["name"] == "saved"
        assert result[0]["config"] == {"k": "v"}


# ── get ─────────────────────────────────────────────────────────


class TestGet:
    def test_returns_none_when_missing(self, store):
        assert store.get("does-not-exist") is None

    def test_returns_dict_when_found(self, store):
        _raw_insert_hook(_make_hook(hook_id="h1", name="found"))
        result = store.get("h1")
        assert result is not None
        assert result["hook_id"] == "h1"
        assert result["name"] == "found"

    def test_parses_config_json(self, store):
        _raw_insert_hook(
            _make_hook(hook_id="h1", config={"url": "http://api", "headers": {"x": "y"}})
        )
        result = store.get("h1")
        assert result["config"] == {"url": "http://api", "headers": {"x": "y"}}

    def test_converts_enabled_to_bool(self, store):
        _raw_insert_hook(_make_hook(hook_id="h1", enabled=True))
        _raw_insert_hook(_make_hook(hook_id="h2", enabled=False))
        assert store.get("h1")["enabled"] is True
        assert store.get("h2")["enabled"] is False

    def test_returns_all_expected_fields(self, store):
        _raw_insert_hook(
            _make_hook(
                hook_id="h1",
                name="n",
                hook_type="webhook",
                action="action",
                status="paused",
                enabled=False,
                last_triggered=999.0,
                trigger_count=42,
            )
        )
        result = store.get("h1")
        assert result["hook_id"] == "h1"
        assert result["name"] == "n"
        assert result["hook_type"] == "webhook"
        assert result["action"] == "action"
        assert result["status"] == "paused"
        assert result["enabled"] is False
        assert result["last_triggered"] == 999.0
        assert result["trigger_count"] == 42

    def test_get_after_save_returns_saved_hook(self, store):
        store.save(_make_hook(hook_id="h1", name="via save", config={"a": 1}))
        result = store.get("h1")
        assert result["name"] == "via save"
        assert result["config"] == {"a": 1}


# ── save (UPSERT) ────────────────────────────────────────────────


class TestSave:
    def test_inserts_new_hook(self, store):
        store.save(_make_hook(hook_id="h1", name="new"))
        result = store.get("h1")
        assert result is not None
        assert result["name"] == "new"

    def test_upserts_on_conflict(self, store):
        """同一 hook_id save 两次 → UPSERT，第二次覆盖第一次。"""
        store.save(_make_hook(hook_id="h1", name="first", config={"v": 1}))
        store.save(_make_hook(hook_id="h1", name="second", config={"v": 2}))

        all_hooks = store.load_all()
        assert len(all_hooks) == 1  # 只有一行（UPSERT）
        assert all_hooks[0]["name"] == "second"
        assert all_hooks[0]["config"] == {"v": 2}

    def test_serializes_config_dict_to_json(self, store):
        store.save(
            _make_hook(hook_id="h1", config={"url": "http://x", "method": "POST"})
        )
        # 直接读 DB 验证 config 列是 JSON 字符串
        with transaction() as conn:
            row = conn.execute(
                "SELECT config FROM event_hooks WHERE hook_id = ?", ("h1",)
            ).fetchone()
        raw_config = row["config"]
        assert isinstance(raw_config, str)
        assert json.loads(raw_config) == {"url": "http://x", "method": "POST"}

    def test_enabled_true_stored_as_1(self, store):
        store.save(_make_hook(hook_id="h1", enabled=True))
        with transaction() as conn:
            row = conn.execute(
                "SELECT enabled FROM event_hooks WHERE hook_id = ?", ("h1",)
            ).fetchone()
        assert row["enabled"] == 1

    def test_enabled_false_stored_as_0(self, store):
        store.save(_make_hook(hook_id="h1", enabled=False))
        with transaction() as conn:
            row = conn.execute(
                "SELECT enabled FROM event_hooks WHERE hook_id = ?", ("h1",)
            ).fetchone()
        assert row["enabled"] == 0

    def test_defaults_when_optional_fields_missing(self, store):
        """save 应使用 hook.get(k, default) 为缺失字段填默认值。"""
        minimal_hook = {"hook_id": "h1"}  # 只有 hook_id
        store.save(minimal_hook)

        with transaction() as conn:
            row = conn.execute(
                "SELECT * FROM event_hooks WHERE hook_id = ?", ("h1",)
            ).fetchone()
        assert row["name"] == ""
        assert row["hook_type"] == ""
        assert row["action"] == ""
        assert row["status"] == "active"
        assert row["enabled"] == 1  # 默认 True
        assert row["trigger_count"] == 0
        assert row["config"] == "{}"  # json.dumps({}) = "{}"
        assert row["last_triggered"] is None

    def test_preserves_last_triggered_value(self, store):
        store.save(
            _make_hook(hook_id="h1", last_triggered=12345.67)
        )
        result = store.get("h1")
        assert result["last_triggered"] == 12345.67

    def test_preserves_trigger_count(self, store):
        store.save(
            _make_hook(hook_id="h1", trigger_count=99)
        )
        result = store.get("h1")
        assert result["trigger_count"] == 99

    def test_preserves_status_value(self, store):
        store.save(_make_hook(hook_id="h1", status="paused"))
        result = store.get("h1")
        assert result["status"] == "paused"

    def test_save_with_empty_config_dict(self, store):
        store.save(_make_hook(hook_id="h1", config={}))
        result = store.get("h1")
        assert result["config"] == {}

    def test_save_with_missing_config_key(self, store):
        """config 字段缺失 → hook.get('config', {}) → {}。"""
        hook = {"hook_id": "h1", "name": "n"}
        store.save(hook)
        result = store.get("h1")
        assert result["config"] == {}

    def test_save_unicode_in_name(self, store):
        store.save(_make_hook(hook_id="h1", name="事件钩子-中文"))
        result = store.get("h1")
        assert result["name"] == "事件钩子-中文"

    def test_save_unicode_in_config(self, store):
        store.save(
            _make_hook(hook_id="h1", config={"提示": "你好", "emoji": "🌍"})
        )
        result = store.get("h1")
        assert result["config"] == {"提示": "你好", "emoji": "🌍"}

    def test_save_does_not_affect_other_hooks(self, store):
        store.save(_make_hook(hook_id="h1", name="first"))
        store.save(_make_hook(hook_id="h2", name="second"))
        store.save(_make_hook(hook_id="h3", name="third"))

        all_hooks = {h["hook_id"]: h for h in store.load_all()}
        assert len(all_hooks) == 3
        assert all_hooks["h1"]["name"] == "first"
        assert all_hooks["h2"]["name"] == "second"
        assert all_hooks["h3"]["name"] == "third"

    def test_upsert_preserves_other_hooks(self, store):
        """UPSERT 一个 hook 不应影响其他 hook。"""
        store.save(_make_hook(hook_id="h1", name="first"))
        store.save(_make_hook(hook_id="h2", name="second"))

        # UPSERT h1
        store.save(_make_hook(hook_id="h1", name="updated"))

        all_hooks = {h["hook_id"]: h for h in store.load_all()}
        assert len(all_hooks) == 2
        assert all_hooks["h1"]["name"] == "updated"
        assert all_hooks["h2"]["name"] == "second"  # 未受影响


# ── delete ──────────────────────────────────────────────────────


class TestDelete:
    def test_returns_true_when_exists(self, store):
        store.save(_make_hook(hook_id="h1"))
        assert store.delete("h1") is True

    def test_returns_false_when_missing(self, store):
        assert store.delete("never-existed") is False

    def test_actually_removes_row(self, store):
        store.save(_make_hook(hook_id="h1"))
        assert store.get("h1") is not None
        store.delete("h1")
        assert store.get("h1") is None

    def test_delete_does_not_affect_others(self, store):
        store.save(_make_hook(hook_id="h1"))
        store.save(_make_hook(hook_id="h2"))
        store.delete("h1")
        assert store.get("h1") is None
        assert store.get("h2") is not None

    def test_delete_twice_second_returns_false(self, store):
        store.save(_make_hook(hook_id="h1"))
        assert store.delete("h1") is True
        assert store.delete("h1") is False


# ── 安全边界：SQL 注入尝试 ─────────────────────────────────────────


class TestSecurityBoundaries:
    def test_hook_id_with_sql_injection_is_safe(self, store):
        """参数化查询应防止 SQL 注入 — hook_id 含 SQL 注入字符串不应破坏 DB。"""
        malicious_id = "'; DROP TABLE event_hooks; --"
        store.save(_make_hook(hook_id=malicious_id, name="inject"))

        # 表应仍存在
        result = store.get(malicious_id)
        assert result is not None
        assert result["name"] == "inject"

        # load_all 也能取到
        all_hooks = store.load_all()
        assert any(h["hook_id"] == malicious_id for h in all_hooks)

    def test_hook_id_with_quote_is_safe(self, store):
        """hook_id 含单引号应被正确转义。"""
        hook_id = "hook'with'quotes"
        store.save(_make_hook(hook_id=hook_id))
        result = store.get(hook_id)
        assert result is not None
        assert result["hook_id"] == hook_id

    def test_config_with_sql_injection_string(self, store):
        """config 中的 SQL 注入字符串应被序列化为 JSON，不会执行。"""
        malicious_config = {
            "payload": "'; DROP TABLE users; --",
            "query": "SELECT * FROM event_hooks WHERE 1=1; DROP TABLE event_hooks; --",
        }
        store.save(_make_hook(hook_id="h1", config=malicious_config))
        result = store.get("h1")
        assert result["config"] == malicious_config
        # event_hooks 表应仍存在
        assert store.load_all() is not None

    def test_name_with_xss_is_safe(self, store):
        """name 含 XSS 字符应被原样存储，不执行也不转义。"""
        xss_name = "<script>alert('xss')</script>"
        store.save(_make_hook(hook_id="h1", name=xss_name))
        result = store.get("h1")
        assert result["name"] == xss_name

    def test_long_hook_id_safe(self, store):
        """超长 hook_id 不应崩溃。"""
        long_id = "a" * 10000
        store.save(_make_hook(hook_id=long_id))
        result = store.get(long_id)
        assert result is not None

    def test_long_name_safe(self, store):
        """超长 name 不应崩溃。"""
        long_name = "x" * 10000
        store.save(_make_hook(hook_id="h1", name=long_name))
        result = store.get("h1")
        assert len(result["name"]) == 10000

    def test_delete_with_sql_injection_id_is_safe(self, store):
        """delete 含 SQL 注入的 ID 不应破坏 DB。"""
        store.save(_make_hook(hook_id="legit"))
        malicious_id = "'; DROP TABLE event_hooks; --"
        # delete 应返回 False（不存在的 hook_id），不应破坏表
        result = store.delete(malicious_id)
        assert result is False
        # 表应仍存在
        assert store.get("legit") is not None
        assert store.load_all() is not None

    def test_save_with_unicode_hook_id(self, store):
        """Unicode hook_id 应被正确存储和读取。"""
        unicode_id = "钩子-🌐-1"
        store.save(_make_hook(hook_id=unicode_id))
        result = store.get(unicode_id)
        assert result is not None
        assert result["hook_id"] == unicode_id


# ── 端到端 CRUD 场景 ──────────────────────────────────────────────


class TestEndToEndCrud:
    def test_full_lifecycle(self, store):
        """完整 CRUD 生命周期：save → get → load_all → update (UPSERT) → delete。"""
        # 1. Create
        store.save(_make_hook(hook_id="h1", name="initial", config={"v": 1}))
        assert store.get("h1")["name"] == "initial"

        # 2. Read (load_all)
        all_hooks = store.load_all()
        assert len(all_hooks) == 1

        # 3. Update (UPSERT)
        store.save(_make_hook(hook_id="h1", name="updated", config={"v": 2}))
        result = store.get("h1")
        assert result["name"] == "updated"
        assert result["config"] == {"v": 2}
        assert len(store.load_all()) == 1  # 仍只有一行

        # 4. Delete
        assert store.delete("h1") is True
        assert store.get("h1") is None
        assert store.load_all() == []

    def test_multiple_hooks_full_lifecycle(self, store):
        """多个 hook 的 CRUD 场景。"""
        # 批量创建
        for i in range(5):
            store.save(_make_hook(hook_id=f"h{i}", name=f"name{i}", config={"i": i}))
        assert len(store.load_all()) == 5

        # 部分更新
        store.save(_make_hook(hook_id="h2", name="updated-h2", config={"i": 99}))
        assert store.get("h2")["name"] == "updated-h2"
        assert len(store.load_all()) == 5  # 仍是 5 行

        # 部分删除
        store.delete("h0")
        store.delete("h4")
        remaining = [h["hook_id"] for h in store.load_all()]
        assert set(remaining) == {"h1", "h2", "h3"}

    def test_save_then_update_status_to_paused(self, store):
        """模拟启用 → 暂停 → 启用的状态切换。"""
        store.save(_make_hook(hook_id="h1", status="active", enabled=True))
        assert store.get("h1")["enabled"] is True

        # 暂停
        store.save(_make_hook(hook_id="h1", status="paused", enabled=False))
        result = store.get("h1")
        assert result["status"] == "paused"
        assert result["enabled"] is False

        # 重新启用
        store.save(_make_hook(hook_id="h1", status="active", enabled=True))
        result = store.get("h1")
        assert result["status"] == "active"
        assert result["enabled"] is True
