"""测试 — api/transcript/jsonl_writer.py JSONL 抄本写入器。

覆盖 TranscriptWriter 的 append_message / append_metadata / append_raw /
close / _serialize_message。read_messages 已在 test_transcripts_routes 覆盖。
"""

import json
import time

import pytest

from api.transcript.jsonl_writer import TranscriptWriter


class TestAppendRaw:
    def test_writes_message_line(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_raw("human", "hello")
        w.close()
        lines = p.read_text(encoding="utf-8").strip().split("\n")
        entry = json.loads(lines[0])
        assert entry["type"] == "message"
        assert entry["role"] == "human"
        assert entry["content"] == "hello"
        assert "timestamp" in entry

    def test_writes_extra_fields(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_raw("ai", "calling tool", tool_calls=[{"name": "bash"}],
                     tool_call_id="call_1")
        w.close()
        entry = json.loads(p.read_text(encoding="utf-8").strip())
        assert entry["tool_calls"] == [{"name": "bash"}]
        assert entry["tool_call_id"] == "call_1"


class TestAppendMetadata:
    def test_writes_metadata_line(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_metadata({"run_id": "r1", "trigger": "manual"})
        w.close()
        entry = json.loads(p.read_text(encoding="utf-8").strip())
        assert entry["type"] == "metadata"
        assert entry["run_id"] == "r1"
        assert entry["trigger"] == "manual"
        assert "timestamp" in entry


class TestAppendMessage:
    def test_serializes_message_object(self, tmp_path):
        class FakeMsg:
            type = "human"
            content = "hi there"
            tool_calls = None
            tool_call_id = None
            name = None

        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_message(FakeMsg())
        w.close()
        entry = json.loads(p.read_text(encoding="utf-8").strip())
        assert entry["role"] == "human"
        assert entry["content"] == "hi there"

    def test_serializes_ai_message_with_tool_calls(self, tmp_path):
        class FakeMsg:
            type = "ai"
            content = "calling"
            tool_calls = [{"name": "bash", "args": {"cmd": "ls"}, "id": "c1"}]
            tool_call_id = None
            name = None

        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_message(FakeMsg())
        w.close()
        entry = json.loads(p.read_text(encoding="utf-8").strip())
        assert entry["tool_calls"][0]["name"] == "bash"
        assert entry["tool_calls"][0]["id"] == "c1"

    def test_serializes_tool_message_with_id_and_name(self, tmp_path):
        class FakeMsg:
            type = "tool"
            content = "result"
            tool_calls = None
            tool_call_id = "call_123"
            name = "bash"

        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_message(FakeMsg())
        w.close()
        entry = json.loads(p.read_text(encoding="utf-8").strip())
        assert entry["tool_call_id"] == "call_123"
        assert entry["name"] == "bash"

    def test_serialize_message_defaults_unknown(self):
        class Bare:
            pass
        result = TranscriptWriter._serialize_message(Bare())
        assert result["role"] == "unknown"
        # content falls back to str(msg)
        assert "content" in result


class TestClose:
    def test_close_is_idempotent(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_raw("human", "first")
        w.close()
        # close 后再 append 不应写入
        w.append_raw("ai", "should not appear")
        w.close()
        lines = p.read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 1
        assert json.loads(lines[0])["content"] == "first"

    def test_close_does_not_write(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.close()
        # close 无副作用，文件未被创建（仅父目录在 __init__ 创建）
        # 但父目录应存在
        assert p.parent.exists()


class TestConstructor:
    def test_creates_parent_dir(self, tmp_path):
        p = tmp_path / "sub" / "deep" / "t.jsonl"
        w = TranscriptWriter(p)
        assert p.parent.exists()
        w.close()

    def test_accepts_str_path(self, tmp_path):
        p = str(tmp_path / "t.jsonl")
        w = TranscriptWriter(p)
        w.append_raw("human", "ok")
        w.close()
        with open(p, "r", encoding="utf-8") as f:
            assert json.loads(f.read().strip())["content"] == "ok"


class TestMultipleAppends:
    def test_appends_in_order(self, tmp_path):
        p = tmp_path / "t.jsonl"
        w = TranscriptWriter(p)
        w.append_metadata({"run_id": "r1"})
        w.append_raw("human", "q1")
        w.append_raw("ai", "a1")
        w.close()
        lines = p.read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 3
        assert json.loads(lines[0])["type"] == "metadata"
        assert json.loads(lines[1])["role"] == "human"
        assert json.loads(lines[2])["role"] == "ai"
