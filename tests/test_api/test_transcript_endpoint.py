"""Transcript 读取端点测试。"""
import json
import pytest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_transcripts(tmp_path, monkeypatch):
    """创建带 transcript 数据的测试 app。

    使用最小化 FastAPI app（仅挂载 transcripts 路由 + 简化 auth middleware），
    避免 create_app() 的 lifespan 初始化太重导致测试失败。
    """
    from api.routes.transcripts import router as transcripts_router
    import api.routes.transcripts as transcripts_mod
    import app_paths

    # Mock DATA_DIR 指向临时目录（同时 patch 模块级导入的引用）
    monkeypatch.setattr(app_paths, "DATA_DIR", tmp_path)
    monkeypatch.setattr(transcripts_mod, "DATA_DIR", tmp_path)

    app = FastAPI()
    app.state.auth_token = "test-token"
    app.include_router(transcripts_router, prefix="/api")

    # 简化的 auth middleware
    @app.middleware("http")
    async def mock_auth(request, call_next):
        if request.headers.get("X-Maxma-Token") != "test-token":
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        return await call_next(request)

    return app, tmp_path


def test_list_transcripts(app_with_transcripts):
    """GET /api/transcripts 返回已有的 transcript 文件列表。"""
    app, tmp_path = app_with_transcripts
    transcript_dir = tmp_path / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True)
    (transcript_dir / "autonomy-20260710-120000.jsonl").write_text(
        json.dumps({"type": "metadata", "run_id": "r1"}) + "\n", encoding="utf-8"
    )

    client = TestClient(app)
    response = client.get(
        "/api/transcripts",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "autonomy" in data["categories"]
    assert len(data["categories"]["autonomy"]) == 1


def test_list_transcripts_empty(app_with_transcripts):
    """DATA_DIR 不存在 transcripts 目录时返回空 categories。"""
    app, _ = app_with_transcripts
    client = TestClient(app)
    response = client.get(
        "/api/transcripts",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["categories"] == {}


def test_list_transcripts_skips_unknown_category(app_with_transcripts):
    """未知类别目录不返回。"""
    app, tmp_path = app_with_transcripts
    transcript_dir = tmp_path / "transcripts" / "unknown_category"
    transcript_dir.mkdir(parents=True)
    (transcript_dir / "x.jsonl").write_text(
        json.dumps({"type": "metadata"}) + "\n", encoding="utf-8"
    )

    client = TestClient(app)
    response = client.get(
        "/api/transcripts",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "unknown_category" not in data["categories"]


def test_read_transcript(app_with_transcripts):
    """GET /api/transcripts/{category}/{filename} 返回 transcript 内容。"""
    app, tmp_path = app_with_transcripts
    transcript_dir = tmp_path / "transcripts" / "autonomy"
    transcript_dir.mkdir(parents=True)
    filename = "autonomy-20260710-120000.jsonl"
    (transcript_dir / filename).write_text(
        json.dumps({"type": "metadata", "run_id": "r1"}) + "\n" +
        json.dumps({"type": "message", "role": "human", "content": "test"}) + "\n",
        encoding="utf-8",
    )

    client = TestClient(app)
    response = client.get(
        f"/api/transcripts/autonomy/{filename}",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["messages"]) == 1
    assert data["messages"][0]["content"] == "test"
    assert data["filename"] == filename
    assert data["category"] == "autonomy"


def test_read_transcript_invalid_category(app_with_transcripts):
    """无效类别返回 400。"""
    app, _ = app_with_transcripts
    client = TestClient(app)
    response = client.get(
        "/api/transcripts/invalid/test.jsonl",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 400


def test_read_transcript_not_found(app_with_transcripts):
    """文件不存在返回 404。"""
    app, tmp_path = app_with_transcripts
    # 创建类别目录但目标文件不存在
    (tmp_path / "transcripts" / "autonomy").mkdir(parents=True)

    client = TestClient(app)
    response = client.get(
        "/api/transcripts/autonomy/missing.jsonl",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code == 404


def test_read_transcript_path_traversal(app_with_transcripts):
    """路径穿越防护。"""
    app, _ = app_with_transcripts
    client = TestClient(app)
    # 包含 ".." 的 filename 被拒绝
    response = client.get(
        "/api/transcripts/autonomy/..%2F..%2Fetc%2Fpasswd",
        headers={"X-Maxma-Token": "test-token"},
    )
    assert response.status_code in (400, 404)


def test_read_transcript_path_traversal_slash(app_with_transcripts):
    """包含 / 的 filename 被拒绝（路由不匹配返回 404，或被路径检查拒绝返回 400）。"""
    app, _ = app_with_transcripts
    client = TestClient(app)
    response = client.get(
        "/api/transcripts/autonomy/..%2Fsecret.jsonl",
        headers={"X-Maxma-Token": "test-token"},
    )
    # 路由 {filename} 只匹配单个 path segment，URL 解码后包含 / 会导致路由不匹配返回 404，
    # 或者即使匹配，路径检查中的 "/" 判断也会返回 400。两者都表示路径穿越被阻止。
    assert response.status_code in (400, 404)


def test_auth_required(app_with_transcripts):
    """未携带 Token 返回 401。"""
    app, _ = app_with_transcripts
    client = TestClient(app)
    response = client.get("/api/transcripts")
    assert response.status_code == 401
