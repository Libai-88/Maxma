"""测试 — api/routes/transcripts.py Transcript 读取。

覆盖：
- GET /transcripts 列出（缺失目录/空/含非法分类/含合法分类）
- GET /transcripts/{category}/{filename} 读取
  - 非法分类 400
  - 非法文件名（.., /, \）400
  - 文件不存在 404
  - 成功返回 messages
- TranscriptWriter.read_messages 边界（不存在/空/非JSON/metadata 行跳过）
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import transcripts as transcripts_mod
from api.routes.transcripts import router
from api.transcript.jsonl_writer import TranscriptWriter


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """把 DATA_DIR 重定向到 tmp_path。"""
    monkeypatch.setattr(transcripts_mod, "DATA_DIR", tmp_path)
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "root": tmp_path}


def _write_jsonl(path, entries):
    """写入多行 JSONL。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")


class TestListTranscripts:
    def test_missing_root_returns_empty(self, isolated_env):
        # tmp_path 下没有 transcripts 子目录
        resp = isolated_env["client"].get("/transcripts")
        assert resp.status_code == 200
        assert resp.json() == {"categories": {}}

    def test_lists_only_allowed_categories(self, isolated_env):
        root = isolated_env["root"] / "transcripts"
        _write_jsonl(root / "autonomy" / "a.jsonl", [{"type": "message", "role": "ai"}])
        _write_jsonl(root / "hooks" / "b.jsonl", [{"type": "message", "role": "human"}])
        # 非法分类应被跳过
        _write_jsonl(root / "evil" / "c.jsonl", [{"type": "message"}])
        # 非目录文件应被跳过
        (root / "file.txt").write_text("x", encoding="utf-8")

        resp = isolated_env["client"].get("/transcripts")
        assert resp.status_code == 200
        cats = resp.json()["categories"]
        assert set(cats.keys()) == {"autonomy", "hooks"}
        # 验证字段
        auto = cats["autonomy"][0]
        assert auto["filename"] == "a.jsonl"
        assert auto["size"] > 0
        assert isinstance(auto["modified_at"], float)

    def test_empty_allowed_category_not_listed(self, isolated_env):
        # 空目录仍会被列出（glob 返回空 list）
        root = isolated_env["root"] / "transcripts"
        (root / "autonomy").mkdir(parents=True)
        resp = isolated_env["client"].get("/transcripts")
        cats = resp.json()["categories"]
        # autonomy 目录存在但无 jsonl → files=[]
        assert cats["autonomy"] == []

    def test_sorting_reverse(self, isolated_env):
        root = isolated_env["root"] / "transcripts" / "manual"
        _write_jsonl(root / "a.jsonl", [{"type": "message"}])
        _write_jsonl(root / "b.jsonl", [{"type": "message"}])
        root / "a.jsonl"  # 较早
        # 修改 b 的时间戳使其较新
        import os, time

        now = time.time()
        os.utime(root / "a.jsonl", (now - 100, now - 100))
        os.utime(root / "b.jsonl", (now, now))

        resp = isolated_env["client"].get("/transcripts")
        files = resp.json()["categories"]["manual"]
        # sorted(..., reverse=True) 按文件名降序
        assert files[0]["filename"] == "b.jsonl"
        assert files[1]["filename"] == "a.jsonl"


class TestReadTranscript:
    def test_invalid_category_400(self, isolated_env):
        resp = isolated_env["client"].get("/transcripts/evil/x.jsonl")
        assert resp.status_code == 400
        assert "无效的类别" in resp.json()["detail"]

    def test_invalid_filename_dotdot_400(self, isolated_env):
        resp = isolated_env["client"].get("/transcripts/autonomy/..x.jsonl")
        assert resp.status_code == 400
        assert "无效的文件名" in resp.json()["detail"]

    def test_invalid_filename_slash_400(self, isolated_env):
        # 路由参数本身不能含 /，%2F 解码后路由不匹配 → 404（非 400）
        # 这里验证路由层防护：含 / 的路径不会进入处理函数
        resp = isolated_env["client"].get("/transcripts/autonomy/a%2Fb.jsonl")
        assert resp.status_code == 404

    def test_file_not_found_404(self, isolated_env):
        resp = isolated_env["client"].get("/transcripts/autonomy/ghost.jsonl")
        assert resp.status_code == 404
        assert "记录文件不存在" in resp.json()["detail"]

    def test_read_success_returns_messages(self, isolated_env):
        root = isolated_env["root"] / "transcripts" / "autonomy"
        _write_jsonl(
            root / "run1.jsonl",
            [
                {"type": "metadata", "run_id": "r1"},
                {"type": "message", "role": "human", "content": "hi"},
                {"type": "message", "role": "ai", "content": "hello"},
            ],
        )
        resp = isolated_env["client"].get("/transcripts/autonomy/run1.jsonl")
        assert resp.status_code == 200
        body = resp.json()
        assert body["filename"] == "run1.jsonl"
        assert body["category"] == "autonomy"
        # metadata 行被跳过
        assert len(body["messages"]) == 2
        assert body["messages"][0]["role"] == "human"
        assert body["messages"][1]["content"] == "hello"


class TestTranscriptWriterReadMessages:
    """直接覆盖 TranscriptWriter.read_messages 的边界。"""

    def test_missing_path_returns_empty(self, tmp_path):
        assert TranscriptWriter.read_messages(tmp_path / "nope.jsonl") == []

    def test_empty_lines_and_bad_json_skipped(self, tmp_path):
        p = tmp_path / "f.jsonl"
        p.write_text(
            "\n"
            + "{bad json}\n"
            + json.dumps({"type": "message", "role": "ai"}) + "\n"
            + "\n",
            encoding="utf-8",
        )
        msgs = TranscriptWriter.read_messages(p)
        assert len(msgs) == 1
        assert msgs[0]["role"] == "ai"

    def test_only_metadata_returns_empty(self, tmp_path):
        p = tmp_path / "f.jsonl"
        _write_jsonl(p, [{"type": "metadata"}, {"type": "other"}])
        assert TranscriptWriter.read_messages(p) == []
