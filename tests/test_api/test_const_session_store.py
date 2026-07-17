"""测试 — api/const_session_store.py Const 固定会话 YAML 持久化。

覆盖 _ensure_dir / serialize_messages / save_const_session /
load_const_session / load_const_session_by_id / load_all_const_sessions /
delete_const_session 等函数。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from api import const_session_store as store


@pytest.fixture
def const_dir(monkeypatch, tmp_path: Path) -> Path:
    """隔离 CONST_SESSIONS_DIR 到 tmp_path。"""
    target = tmp_path / "const-sessions"
    monkeypatch.setattr(store, "_CONST_DIR", target)
    return target


class _FakeMessage:
    """模拟 LangChain 风格的消息对象。"""

    def __init__(
        self,
        type="human",
        content="hello",
        tool_call_id=None,
        name=None,
        tool_calls=None,
        additional_kwargs=None,
    ):
        self.type = type
        self.content = content
        self.tool_call_id = tool_call_id
        self.name = name
        self.tool_calls = tool_calls
        self.additional_kwargs = additional_kwargs


# ── _ensure_dir ──────────────────────────────────────────────


class TestEnsureDir:
    def test_creates_directory_if_missing(self, const_dir: Path):
        # fixture 已 monkeypatch，但目录尚未创建
        result = store._ensure_dir()
        assert result == const_dir
        assert const_dir.exists()

    def test_idempotent_when_directory_exists(self, const_dir: Path):
        const_dir.mkdir(parents=True, exist_ok=True)
        result = store._ensure_dir()
        assert result == const_dir
        assert const_dir.exists()


# ── serialize_messages ───────────────────────────────────────


class TestSerializeMessages:
    def test_empty_list(self):
        assert store.serialize_messages([]) == []

    def test_basic_human_message(self):
        msg = _FakeMessage(type="human", content="hi")
        result = store.serialize_messages([msg])
        assert len(result) == 1
        assert result[0]["type"] == "human"
        assert result[0]["content"] == "hi"

    def test_ai_message_with_tool_calls(self):
        msg = _FakeMessage(
            type="ai",
            content="",
            tool_calls=[{"id": "t1", "name": "search"}],
        )
        result = store.serialize_messages([msg])
        assert result[0]["tool_calls"] == [{"id": "t1", "name": "search"}]

    def test_tool_message_with_tool_call_id(self):
        msg = _FakeMessage(
            type="tool",
            content="result",
            tool_call_id="t1",
            name="search",
        )
        result = store.serialize_messages([msg])
        assert result[0]["tool_call_id"] == "t1"
        assert result[0]["name"] == "search"

    def test_message_with_additional_kwargs(self):
        msg = _FakeMessage(
            type="ai",
            content="x",
            additional_kwargs={"foo": "bar"},
        )
        result = store.serialize_messages([msg])
        assert result[0]["additional_kwargs"] == {"foo": "bar"}

    def test_message_without_content_falls_back_to_str(self):
        # 没有 content 属性时，使用 str(msg)
        class Bare:
            type = "system"

        result = store.serialize_messages([Bare()])
        assert result[0]["type"] == "system"
        assert "Bare" in result[0]["content"]

    def test_message_without_type_attribute_uses_unknown(self):
        class NoType:
            content = "data"

        result = store.serialize_messages([NoType()])
        assert result[0]["type"] == "unknown"
        assert result[0]["content"] == "data"

    def test_empty_tool_call_id_not_serialized(self):
        msg = _FakeMessage(type="tool", content="x", tool_call_id="")
        result = store.serialize_messages([msg])
        assert "tool_call_id" not in result[0]

    def test_empty_name_not_serialized(self):
        msg = _FakeMessage(type="human", content="x", name="")
        result = store.serialize_messages([msg])
        assert "name" not in result[0]

    def test_empty_tool_calls_not_serialized(self):
        msg = _FakeMessage(type="ai", content="x", tool_calls=[])
        result = store.serialize_messages([msg])
        assert "tool_calls" not in result[0]

    def test_empty_additional_kwargs_not_serialized(self):
        msg = _FakeMessage(type="ai", content="x", additional_kwargs={})
        result = store.serialize_messages([msg])
        assert "additional_kwargs" not in result[0]


# ── save / load round-trip ───────────────────────────────────


class TestSaveAndLoad:
    def test_save_creates_yaml_file(self, const_dir: Path):
        messages = [{"type": "human", "content": "hi"}]
        path = store.save_const_session(
            session_id="s1",
            const_name="my_const",
            metadata={"key": "value"},
            messages=messages,
        )
        assert Path(path).exists()
        assert Path(path).name == "s1.yaml"

    def test_save_load_round_trip(self, const_dir: Path):
        messages = [{"type": "human", "content": "hello"}]
        path = store.save_const_session(
            session_id="s2",
            const_name="c1",
            metadata={"foo": "bar"},
            messages=messages,
        )
        loaded = store.load_const_session(Path(path))
        assert loaded is not None
        assert loaded["session_id"] == "s2"
        assert loaded["const_name"] == "c1"
        assert loaded["metadata"] == {"foo": "bar"}
        assert loaded["messages"] == messages
        assert "const_saved_at" in loaded

    def test_load_nonexistent_file_returns_none(self, const_dir: Path):
        const_dir.mkdir(parents=True, exist_ok=True)
        result = store.load_const_session(const_dir / "nope.yaml")
        assert result is None

    def test_load_non_dict_yaml_returns_none(self, const_dir: Path):
        const_dir.mkdir(parents=True, exist_ok=True)
        bad = const_dir / "bad.yaml"
        bad.write_text("- just\n- a\n- list\n", encoding="utf-8")
        result = store.load_const_session(bad)
        assert result is None

    def test_load_corrupted_yaml_returns_none(self, const_dir: Path):
        const_dir.mkdir(parents=True, exist_ok=True)
        bad = const_dir / "corrupt.yaml"
        bad.write_text(":\n  : invalid yaml :::", encoding="utf-8")
        result = store.load_const_session(bad)
        assert result is None


# ── load_const_session_by_id ─────────────────────────────────


class TestLoadById:
    def test_load_existing_session_by_id(self, const_dir: Path):
        store.save_const_session(
            session_id="byid1",
            const_name="c",
            metadata={},
            messages=[],
        )
        loaded = store.load_const_session_by_id("byid1")
        assert loaded is not None
        assert loaded["session_id"] == "byid1"

    def test_load_missing_session_by_id_returns_none(self, const_dir: Path):
        result = store.load_const_session_by_id("missing")
        assert result is None


# ── load_all_const_sessions ──────────────────────────────────


class TestLoadAll:
    def test_empty_directory_returns_empty_list(self, const_dir: Path):
        sessions = store.load_all_const_sessions()
        assert sessions == []

    def test_loads_all_yaml_files_sorted(self, const_dir: Path):
        store.save_const_session("b_session", "c1", {}, [])
        store.save_const_session("a_session", "c2", {}, [])
        sessions = store.load_all_const_sessions()
        # 按文件名排序
        assert len(sessions) == 2
        assert sessions[0]["session_id"] == "a_session"
        assert sessions[1]["session_id"] == "b_session"

    def test_skips_invalid_sessions(self, const_dir: Path):
        const_dir.mkdir(parents=True, exist_ok=True)
        # 有效会话
        store.save_const_session("good", "c", {}, [])
        # 无效（非 dict）
        (const_dir / "bad.yaml").write_text("- list\n", encoding="utf-8")
        # 缺少 session_id 的 dict
        (const_dir / "no_id.yaml").write_text("foo: bar\n", encoding="utf-8")
        sessions = store.load_all_const_sessions()
        assert len(sessions) == 1
        assert sessions[0]["session_id"] == "good"


# ── delete_const_session ─────────────────────────────────────


class TestDelete:
    def test_delete_existing_session_returns_true(self, const_dir: Path):
        store.save_const_session("del1", "c", {}, [])
        assert store.delete_const_session("del1") is True
        assert not (const_dir / "del1.yaml").exists()

    def test_delete_missing_session_returns_false(self, const_dir: Path):
        assert store.delete_const_session("never_existed") is False

    def test_delete_does_not_affect_other_sessions(self, const_dir: Path):
        store.save_const_session("keep", "c", {}, [])
        store.save_const_session("drop", "c", {}, [])
        assert store.delete_const_session("drop") is True
        assert (const_dir / "keep.yaml").exists()
        assert not (const_dir / "drop.yaml").exists()
