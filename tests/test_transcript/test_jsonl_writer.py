"""后台任务 JSONL Transcript Writer 测试。"""
import json
import pytest
from pathlib import Path
from langchain_core.messages import HumanMessage, AIMessage

from api.transcript.jsonl_writer import TranscriptWriter


@pytest.fixture
def transcript_path(tmp_path):
    return tmp_path / "test-run.jsonl"


def test_writer_creates_file(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="hello"))
    assert transcript_path.exists()


def test_writer_appends_jsonl_lines(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="hello"))
    writer.append_message(AIMessage(content="hi there"))

    lines = transcript_path.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2

    entry1 = json.loads(lines[0])
    assert entry1["role"] == "human"
    assert entry1["content"] == "hello"
    assert "timestamp" in entry1

    entry2 = json.loads(lines[1])
    assert entry2["role"] == "ai"


def test_writer_preserves_tool_calls(transcript_path):
    """tool_calls 被保留在 transcript 中。"""
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"name": "file_read", "args": {"path": "/tmp"}, "id": "tc1"}],
    )
    writer = TranscriptWriter(transcript_path)
    writer.append_message(ai_msg)

    entry = json.loads(transcript_path.read_text(encoding="utf-8").strip())
    assert entry["tool_calls"] == [{"name": "file_read", "args": {"path": "/tmp"}, "id": "tc1"}]


def test_writer_append_run_metadata(transcript_path):
    """写入 run 级元数据作为首行。"""
    writer = TranscriptWriter(transcript_path)
    writer.append_metadata({"run_id": "abc-123", "trigger": "autonomy", "action": "diagnose"})

    entry = json.loads(transcript_path.read_text(encoding="utf-8").strip())
    assert entry["type"] == "metadata"
    assert entry["run_id"] == "abc-123"
    assert entry["trigger"] == "autonomy"


def test_writer_close_is_idempotent(transcript_path):
    writer = TranscriptWriter(transcript_path)
    writer.append_message(HumanMessage(content="x"))
    writer.close()
    writer.close()  # 不应抛异常


def test_read_transcript_returns_messages(transcript_path):
    """read_transcript 把 JSONL 读回消息列表。"""
    writer = TranscriptWriter(transcript_path)
    writer.append_metadata({"run_id": "r1"})
    writer.append_message(HumanMessage(content="q1"))
    writer.append_message(AIMessage(content="a1"))
    writer.close()

    messages = TranscriptWriter.read_messages(transcript_path)
    assert len(messages) == 2
    assert messages[0]["content"] == "q1"
    assert messages[1]["content"] == "a1"
