"""补充测试 — api/pi_bridge/session_adapter.py SessionMap CRUD + 对话轮次持久化。

使用 tmp_path 创建临时 SQLite 数据库，避免触碰真实的 ~/.maxma/session_map.db。
"""

import json
import sqlite3

import pytest

from api.pi_bridge.session_adapter import MAX_TURNS, SESSION_MAP_DIR, SessionMap


@pytest.fixture
def db_path(tmp_path):
    """返回一个独立的临时 DB 路径。"""
    return tmp_path / "test_session_map.db"


class TestSessionMapInit:
    def test_init_creates_db_file_and_parent_dir(self, db_path):
        # 父目录是 tmp_path 本身（已存在）；DB 文件应被创建
        sm = SessionMap(db_path)
        try:
            assert db_path.exists()
        finally:
            sm.close()

    def test_init_creates_missing_parent_dir(self, tmp_path):
        nested = tmp_path / "nested" / "deep" / "test.db"
        sm = SessionMap(nested)
        try:
            assert nested.exists()
            assert nested.parent.is_dir()
        finally:
            sm.close()

    def test_init_creates_session_map_table(self, db_path):
        sm = SessionMap(db_path)
        try:
            # 直接查 sqlite_master 验证表已建
            row = sm._conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='session_map'"
            ).fetchone()
            assert row is not None
            assert row[0] == "session_map"
        finally:
            sm.close()

    def test_migration_add_columns_is_idempotent(self, db_path):
        """打开同一个 DB 两次，第二次的 ALTER TABLE 应被吞掉（列已存在）。"""
        sm1 = SessionMap(db_path)
        sm1.set_mapping("m1", "s1")
        sm1.close()

        # 第二次打开会执行 ALTER TABLE，应不抛 OperationalError
        sm2 = SessionMap(db_path)
        try:
            assert sm2.get_sidecar_id("m1") == "s1"
            # 验证 is_const / turns 列存在
            cols = {
                r[1]
                for r in sm2._conn.execute("PRAGMA table_info(session_map)").fetchall()
            }
            assert "is_const" in cols
            assert "turns" in cols
        finally:
            sm2.close()

    def test_init_uses_wal_journal_mode(self, db_path):
        sm = SessionMap(db_path)
        try:
            row = sm._conn.execute("PRAGMA journal_mode").fetchone()
            assert row[0].lower() == "wal"
        finally:
            sm.close()


class TestSessionMapContextManager:
    def test_context_manager_returns_self_and_closes(self, db_path):
        with SessionMap(db_path) as sm:
            assert isinstance(sm, SessionMap)
            sm.set_mapping("m1", "s1")
            assert sm.get_sidecar_id("m1") == "s1"
        # 退出后连接应已关闭；再查询应报 ProgrammingError
        with pytest.raises(sqlite3.ProgrammingError):
            sm.get_sidecar_id("m1")


class TestSessionMapCRUD:
    @pytest.fixture
    def sm(self, db_path):
        m = SessionMap(db_path)
        yield m
        m.close()

    def test_get_sidecar_id_missing_returns_none(self, sm):
        assert sm.get_sidecar_id("ghost") is None

    def test_set_and_get_sidecar_id(self, sm):
        sm.set_mapping("m1", "s1")
        assert sm.get_sidecar_id("m1") == "s1"

    def test_get_maxma_id_reverse_lookup(self, sm):
        sm.set_mapping("m1", "s1")
        assert sm.get_maxma_id("s1") == "m1"

    def test_get_maxma_id_missing_returns_none(self, sm):
        assert sm.get_maxma_id("ghost") is None

    def test_set_mapping_updates_existing_sidecar_id(self, sm):
        sm.set_mapping("m1", "s1")
        sm.set_mapping("m1", "s2")
        assert sm.get_sidecar_id("m1") == "s2"
        # 反向查找也更新
        assert sm.get_maxma_id("s2") == "m1"
        assert sm.get_maxma_id("s1") is None

    def test_remove_existing_returns_true(self, sm):
        sm.set_mapping("m1", "s1")
        assert sm.remove("m1") is True
        assert sm.get_sidecar_id("m1") is None

    def test_remove_missing_returns_false(self, sm):
        assert sm.remove("ghost") is False


class TestSessionMapConst:
    @pytest.fixture
    def sm(self, db_path):
        m = SessionMap(db_path)
        yield m
        m.close()

    def test_get_const_missing_returns_false(self, sm):
        assert sm.get_const("ghost") is False

    def test_set_const_true_for_existing(self, sm):
        sm.set_mapping("m1", "s1")
        sm.set_const("m1", True)
        assert sm.get_const("m1") is True

    def test_set_const_false_for_existing(self, sm):
        sm.set_mapping("m1", "s1")
        sm.set_const("m1", True)
        sm.set_const("m1", False)
        assert sm.get_const("m1") is False

    def test_set_const_on_missing_row_is_noop(self, sm):
        # UPDATE 不存在的行不影响任何记录，但不抛异常
        sm.set_const("ghost", True)
        assert sm.get_const("ghost") is False


class TestSessionMapAppendTurn:
    @pytest.fixture
    def sm(self, db_path):
        m = SessionMap(db_path)
        yield m
        m.close()

    def test_append_turn_creates_row_when_missing(self, sm):
        # 没有预先 set_mapping，直接 append_turn 也应能创建一行
        sm.append_turn("m1", "hello", "world")
        turns = sm.get_recent_turns("m1", count=10)
        assert len(turns) == 1
        assert turns[0] == {"user": "hello", "assistant": "world"}

    def test_append_turn_appends_to_existing_row(self, sm):
        sm.set_mapping("m1", "s1")
        sm.append_turn("m1", "u1", "a1")
        sm.append_turn("m1", "u2", "a2")
        turns = sm.get_recent_turns("m1", count=10)
        assert len(turns) == 2
        assert turns[0] == {"user": "u1", "assistant": "a1"}
        assert turns[1] == {"user": "u2", "assistant": "a2"}

    def test_append_turn_truncates_user_to_500(self, sm):
        long_user = "x" * 1000
        sm.append_turn("m1", long_user, "a")
        turns = sm.get_recent_turns("m1", count=1)
        assert len(turns[0]["user"]) == 500

    def test_append_turn_truncates_assistant_to_1000(self, sm):
        long_assistant = "y" * 2000
        sm.append_turn("m1", "u", long_assistant)
        turns = sm.get_recent_turns("m1", count=1)
        assert len(turns[0]["assistant"]) == 1000

    def test_append_turn_caps_at_max_turns(self, sm):
        # 追加 25 轮，应只保留最后 MAX_TURNS=20 轮
        for i in range(25):
            sm.append_turn("m1", f"u{i}", f"a{i}")
        turns = sm.get_recent_turns("m1", count=100)
        assert len(turns) == MAX_TURNS
        # 验证保留的是最后 20 轮（索引 5..24）
        assert turns[0] == {"user": "u5", "assistant": "a5"}
        assert turns[-1] == {"user": "u24", "assistant": "a24"}


class TestSessionMapGetRecentTurns:
    @pytest.fixture
    def sm(self, db_path):
        m = SessionMap(db_path)
        for i in range(5):
            m.append_turn("m1", f"u{i}", f"a{i}")
        yield m
        m.close()

    def test_get_recent_turns_returns_last_n(self, sm):
        turns = sm.get_recent_turns("m1", count=2)
        assert len(turns) == 2
        assert turns[0] == {"user": "u3", "assistant": "a3"}
        assert turns[1] == {"user": "u4", "assistant": "a4"}

    def test_get_recent_turns_count_exceeds_available(self, sm):
        turns = sm.get_recent_turns("m1", count=100)
        assert len(turns) == 5

    def test_get_recent_turns_empty_returns_empty(self, sm):
        assert sm.get_recent_turns("ghost", count=5) == []

    def test_get_recent_turns_row_with_empty_turns_returns_empty(self, sm):
        # 直接插入一个 turns='' 的行
        sm._conn.execute(
            "INSERT INTO session_map (maxma_id, sidecar_id, turns) VALUES ('empty-row', '', '')"
        )
        sm._conn.commit()
        assert sm.get_recent_turns("empty-row", count=5) == []

    def test_get_recent_turns_ignores_malformed_json(self, sm):
        sm._conn.execute(
            "INSERT INTO session_map (maxma_id, sidecar_id, turns) VALUES ('broken-row', '', '{')"
        )
        sm._conn.commit()
        assert sm.get_recent_turns("broken-row", count=5) == []


class TestSessionMapListAll:
    def test_list_all_orders_by_updated_at_desc(self, db_path):
        sm = SessionMap(db_path)
        try:
            sm.set_mapping("m1", "s1")
            # 让 m2 的 updated_at 比 m1 晚
            sm.set_mapping("m2", "s2")
            sm.set_mapping("m1", "s1b")  # 更新 m1，使 updated_at 推后
            rows = sm.list_all()
            assert len(rows) == 2
            # m1 最后被更新，应排在前面
            assert rows[0]["maxma_id"] == "m1"
            assert rows[0]["sidecar_id"] == "s1b"
            assert rows[1]["maxma_id"] == "m2"
            # 字段完整
            for r in rows:
                assert {"maxma_id", "sidecar_id", "created_at", "updated_at"} <= set(r)
        finally:
            sm.close()

    def test_list_all_empty(self, db_path):
        sm = SessionMap(db_path)
        try:
            assert sm.list_all() == []
        finally:
            sm.close()


class TestSessionMapCount:
    def test_count_empty(self, db_path):
        sm = SessionMap(db_path)
        try:
            assert sm.count == 0
        finally:
            sm.close()

    def test_count_after_inserts(self, db_path):
        sm = SessionMap(db_path)
        try:
            sm.set_mapping("m1", "s1")
            sm.set_mapping("m2", "s2")
            # 同一 maxma_id 重复 set_mapping 不应增加计数
            sm.set_mapping("m1", "s1b")
            assert sm.count == 2
        finally:
            sm.close()

    def test_count_decreases_after_remove(self, db_path):
        sm = SessionMap(db_path)
        try:
            sm.set_mapping("m1", "s1")
            sm.set_mapping("m2", "s2")
            sm.remove("m1")
            assert sm.count == 1
        finally:
            sm.close()


class TestSessionMapClose:
    def test_close_closes_connection(self, db_path):
        sm = SessionMap(db_path)
        sm.close()
        with pytest.raises(sqlite3.ProgrammingError):
            sm._conn.execute("SELECT 1")

    def test_close_is_idempotent(self, db_path):
        # 多次 close 不抛异常
        sm = SessionMap(db_path)
        sm.close()
        sm.close()


class TestSessionMapModuleConstants:
    def test_session_map_dir_under_home(self):
        # 验证默认 DB 路径在用户主目录的 .maxma 下
        assert SESSION_MAP_DIR.name == ".maxma"

    def test_max_turns_is_20(self):
        # 行为契约：MAX_TURNS 决定 append_turn 的截断阈值
        assert MAX_TURNS == 20


class TestSessionMapPersistenceRoundTrip:
    def test_data_persists_across_reopen(self, db_path):
        sm1 = SessionMap(db_path)
        sm1.set_mapping("m1", "s1")
        sm1.set_const("m1", True)
        sm1.append_turn("m1", "u1", "a1")
        sm1.close()

        sm2 = SessionMap(db_path)
        try:
            assert sm2.get_sidecar_id("m1") == "s1"
            assert sm2.get_const("m1") is True
            turns = sm2.get_recent_turns("m1", count=5)
            assert turns == [{"user": "u1", "assistant": "a1"}]
            # turns 列在 DB 中以 JSON 字符串存储
            raw = sm2._conn.execute(
                "SELECT turns FROM session_map WHERE maxma_id = ?", ("m1",)
            ).fetchone()
            parsed = json.loads(raw[0])
            assert parsed == [{"user": "u1", "assistant": "a1"}]
        finally:
            sm2.close()
