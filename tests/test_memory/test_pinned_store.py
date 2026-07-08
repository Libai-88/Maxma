# tests/test_memory/test_pinned_store.py
import pytest
from pathlib import Path
from memory.pinned_store import PinnedMemoryStore

@pytest.fixture
def store(tmp_path):
    return PinnedMemoryStore(
        md_path=str(tmp_path / "pinned.md"),
        json_path=str(tmp_path / "pinned.json"),
    )

def test_add_pinned(store):
    """添加固定记忆"""
    store.add("用户偏好深色主题")
    items = store.list_all()
    assert len(items) >= 1
    assert any("深色主题" in i["content"] for i in items)

def test_dedup(store):
    """相同内容去重"""
    store.add("用户偏好深色主题")
    store.add("用户偏好深色主题")
    items = store.list_all()
    assert len(items) == 1

def test_remove_pinned(store):
    """删除固定记忆"""
    pid = store.add("临时记忆")
    assert store.remove(pid) is True
    items = store.list_all()
    assert all(i["id"] != pid for i in items)

def test_dual_write(store):
    """双写：md 和 json 都应有内容"""
    store.add("双写测试")
    assert Path(store._md_path).exists()
    assert Path(store._json_path).exists()
