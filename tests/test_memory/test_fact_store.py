# tests/test_memory/test_fact_store.py
import pytest
import tempfile
import os
from pathlib import Path

@pytest.fixture
def fact_store(tmp_path):
    from memory.fact_store import FactStore
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

def test_delete_fact(fact_store):
    """删除事实"""
    fact_id = fact_store.add(content="待删除", tags=[], source="dialogue", session_id="s1")
    assert fact_store.delete(fact_id) is True
    results = fact_store.search("待删除", limit=5)
    assert len(results) == 0
