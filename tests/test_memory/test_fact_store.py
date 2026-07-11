# tests/test_memory/test_fact_store.py
import pytest

from memory.fact_store import FactStore

@pytest.fixture
def fact_store(tmp_path):
    store = FactStore(db_path=str(tmp_path / "test_facts.db"))
    yield store
    store.close()

def test_add_and_search_fact(fact_store):
    """添加事实并全文搜索"""
    fact_store.add(
        content="用户喜欢古典音乐，尤其是巴赫的作品",
        tags=["preference", "music"],
        source="dialogue",
        session_id="sess-1",
    )
    results = fact_store.search("古典音乐", limit=5)
    assert len(results) >= 1
    assert "古典音乐" in results[0]["content"]

def test_cjk_search(fact_store):
    """CJK 搜索应该有效"""
    fact_store.add(content="我喜欢用 Python 编程", tags=[], source="dialogue", session_id="s1")
    fact_store.add(content="今天天气很好", tags=[], source="dialogue", session_id="s2")
    results = fact_store.search("Python", limit=5)
    assert len(results) >= 1
    assert "Python" in results[0]["content"]

def test_tag_search(fact_store):
    """标签搜索"""
    fact_store.add(content="事实A", tags=["tag1"], source="dialogue", session_id="s1")
    fact_store.add(content="事实B", tags=["tag2"], source="dialogue", session_id="s2")
    results = fact_store.search_by_tag("tag1", limit=5)
    assert len(results) == 1
    assert results[0]["content"] == "事实A"


def test_tag_search_escapes_like_metacharacters(fact_store):
    fact_store.add(content="精确标签", tags=["priority_high"])
    fact_store.add(content="不应匹配", tags=["priorityXhigh"])

    results = fact_store.search_by_tag("priority_high")

    assert [item["content"] for item in results] == ["精确标签"]


def test_search_cjk_partial_phrase_and_filters_by_session(fact_store):
    fact_store.add(content="用户喜欢古典音乐", session_id="session-a")
    fact_store.add(content="用户喜欢古典文学", session_id="session-b")

    results = fact_store.search("古典", session_id="session-a")

    assert [item["session_id"] for item in results] == ["session-a"]
    assert results[0]["content"] == "用户喜欢古典音乐"


def test_expired_facts_are_hidden_from_text_and_tag_searches(fact_store):
    fact_store.add(content="短期事实", tags=["temporary"], ttl=1)
    fact_store._conn.execute("UPDATE facts SET expires_at = 0")
    fact_store._conn.commit()

    assert fact_store.search("短期事实") == []
    assert fact_store.search_by_tag("temporary") == []
    assert len(fact_store.search("短期事实", include_expired=True)) == 1
    assert len(fact_store.search_by_tag("temporary", include_expired=True)) == 1


def test_empty_query_and_invalid_limit_do_not_issue_fts_query(fact_store):
    fact_store.add(content="一个事实")

    assert fact_store.search("") == []
    assert fact_store.search("事实", limit=0) == []

def test_delete_fact(fact_store):
    """删除事实"""
    fact_id = fact_store.add(content="待删除", tags=[], source="dialogue", session_id="s1")
    assert fact_store.delete(fact_id) is True
    results = fact_store.search("待删除", limit=5)
    assert len(results) == 0


def test_purge_expired_removes_fact_and_fts_row(fact_store):
    fact_id = fact_store.add(content="即将过期", ttl=1)

    assert fact_store.purge_expired(now=10**12) == 1
    assert fact_store.search("即将过期", include_expired=True) == []
    if fact_store._fts_available:
        count = fact_store._conn.execute(
            "SELECT COUNT(*) FROM facts_fts WHERE fact_id = ?", (fact_id,)
        ).fetchone()[0]
        assert count == 0


def test_idempotency_key_returns_existing_fact(fact_store):
    first = fact_store.add(
        content="用户偏好简洁回答", tags=["preference"], session_id="s1",
        idempotency_key="memory-ticker:stable-input",
    )
    replay = fact_store.add(
        content="用户偏好简洁回答", tags=["preference"], session_id="s1",
        idempotency_key="memory-ticker:stable-input",
    )

    assert replay == first
    assert len(fact_store.search("简洁回答", session_id="s1")) == 1


def test_existing_database_migrates_idempotency_column(tmp_path):
    import sqlite3

    db_path = tmp_path / "facts-v2.db"
    connection = sqlite3.connect(db_path)
    connection.executescript("""
        CREATE TABLE facts (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'dialogue', session_id TEXT NOT NULL DEFAULT '',
            created_at REAL NOT NULL, updated_at REAL NOT NULL, ttl INTEGER, expires_at REAL
        );
        CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO schema_meta (key, value) VALUES ('version', '2');
    """)
    connection.close()

    from memory.fact_store import FactStore
    store = FactStore(db_path=str(db_path))
    try:
        fact_id = store.add(content="迁移后事实", idempotency_key="migration-key")
        assert store.add(content="迁移后事实", idempotency_key="migration-key") == fact_id
    finally:
        store.close()


def test_reopening_backfills_fts_for_preexisting_facts(tmp_path):
    db_path = tmp_path / "facts.db"
    store = FactStore(db_path=str(db_path))
    try:
        store.add(content="需要回填的事实", tags=["backfill"])
        store._conn.execute("DELETE FROM facts_fts")
        store._conn.commit()
    finally:
        store.close()

    reopened = FactStore(db_path=str(db_path))
    try:
        results = reopened.search("回填")
        assert [item["content"] for item in results] == ["需要回填的事实"]
    finally:
        reopened.close()
