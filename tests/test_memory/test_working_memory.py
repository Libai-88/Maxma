"""工作记忆 Push 注入层测试。"""
import pytest
from pathlib import Path
from agent.memory.working_memory import WorkingMemoryStore


def test_create_memory_file(tmp_path):
    """首次创建工作记忆文件。"""
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    assert not store.exists()
    store.ensure_created()
    assert store.exists()


def test_read_empty_memory(tmp_path):
    """空记忆返回空字符串。"""
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    store.ensure_created()
    content = store.read_now_section()
    assert content == ""


def test_write_and_read_now_section(tmp_path):
    """写入并读取 # now 块。"""
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    store.ensure_created()
    store.write_content(
        "# now\n\n## State | 测试状态\n- runs: 1\n\n# History\n\n## 2026-07-10-1200 | test\n"
    )
    now = store.read_now_section()
    assert "测试状态" in now
    assert "runs: 1" in now


def test_build_snapshot_small_file(tmp_path):
    """小文件（≤30 行）返回完整内容。"""
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    store.ensure_created()
    content = "# now\n\n## State | test\n- x: 1\n"
    store.write_content(content)
    snapshot = store.build_snapshot()
    assert "# now" in snapshot
    assert "test" in snapshot


def test_build_snapshot_nonexistent_file(tmp_path):
    """文件不存在时返回创建引导。"""
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    snapshot = store.build_snapshot()
    assert "create" in snapshot.lower() or "创建" in snapshot


def test_pre_insert_history_heading(tmp_path):
    """在 # History 顶部预插时间戳标题。"""
    import time
    store = WorkingMemoryStore(tmp_path / "working_memory.md")
    store.ensure_created()
    store.write_content("# now\n\n## State | test\n\n# History\n\n## old entry\n")
    store.pre_insert_history_heading()
    content = store.read_content()
    # 应在 # History 之后插入新的 ## 时间戳标题
    assert "# History" in content
    history_idx = content.index("# History")
    after_history = content[history_idx:]
    # 应有两个 ## 标题（新插入的 + 原有的）
    assert after_history.count("## ") >= 2
