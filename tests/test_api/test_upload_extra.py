"""补充测试 — api/routes/upload.py 的 list/delete 与错误路径。

已有 test_upload.py 覆盖 _sanitize_filename 和单文件上传 happy path；
本文件覆盖 /uploads GET 列表、/uploads/{file_id} DELETE、以及各类错误分支。
"""

import io
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import upload as upload_mod
from api.routes.upload import router


@pytest.fixture
def app_and_client(tmp_path, monkeypatch):
    """将 UPLOAD_DIR 指向临时目录，避免污染真实 uploads 目录。"""
    monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
    app = FastAPI()
    app.include_router(router)
    return app, TestClient(app)


def _write_meta(tmp_path: Path, file_id: str, original_name: str, size: int = 5, ts: float = 1.0) -> Path:
    """写入一个 .meta + 对应数据文件，返回数据文件路径。"""
    data_path = tmp_path / f"{file_id}_{original_name}"
    data_path.write_bytes(b"x" * size)
    meta_path = tmp_path / f"{file_id}.meta"
    meta_path.write_text(
        f"original_name={original_name}\nsize={size}\nuploaded_at={ts}\n",
        encoding="utf-8",
    )
    return data_path


class TestListUploads:
    def test_list_uploads_empty(self, app_and_client):
        _, client = app_and_client
        resp = client.get("/uploads")
        assert resp.status_code == 200
        assert resp.json() == {"files": [], "count": 0}

    def test_list_uploads_with_files(self, app_and_client):
        (_, client) = app_and_client
        upload_dir = upload_mod.UPLOAD_DIR
        _write_meta(upload_dir, "abc12345", "file1.txt", size=11, ts=100.0)
        _write_meta(upload_dir, "def67890", "file2.md", size=22, ts=200.0)

        resp = client.get("/uploads")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 2
        names = {f["filename"] for f in body["files"]}
        assert names == {"file1.txt", "file2.md"}
        # 验证字段完整
        for f in body["files"]:
            assert "file_id" in f
            assert "size" in f
            assert "uploaded_at" in f
            assert f["path"].startswith("local:")

    def test_list_uploads_skips_orphan_meta(self, app_and_client):
        """meta 存在但实际数据文件不存在 → 不应出现在列表。"""
        (app, client) = app_and_client
        upload_dir = upload_mod.UPLOAD_DIR
        # 只写 meta，不写数据文件
        (upload_dir / "orphan.meta").write_text(
            "original_name=ghost.txt\nsize=5\nuploaded_at=1.0\n", encoding="utf-8"
        )
        resp = client.get("/uploads")
        assert resp.status_code == 200
        assert resp.json()["count"] == 0


class TestDeleteUpload:
    def test_delete_upload_by_meta(self, app_and_client):
        (app, client) = app_and_client
        upload_dir = upload_mod.UPLOAD_DIR
        data_path = _write_meta(upload_dir, "abc12345", "to_delete.txt")
        meta_path = upload_dir / "abc12345.meta"
        assert data_path.exists() and meta_path.exists()

        resp = client.delete("/uploads/abc12345")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True, "file_id": "abc12345"}
        assert not data_path.exists()
        assert not meta_path.exists()

    def test_delete_upload_glob_fallback(self, app_and_client):
        """没有 .meta 时，应通过 glob {file_id}_* 删除。"""
        (app, client) = app_and_client
        upload_dir = upload_mod.UPLOAD_DIR
        # 只写数据文件，无 meta
        data_path = upload_dir / "noMetaID_realfile.txt"
        data_path.write_bytes(b"hello")

        resp = client.delete("/uploads/noMetaID")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        assert not data_path.exists()

    def test_delete_upload_not_found(self, app_and_client):
        (_, client) = app_and_client
        resp = client.delete("/uploads/doesnotexist")
        assert resp.status_code == 404
        assert "不存在" in resp.json()["detail"]


class TestUploadErrorPaths:
    def test_upload_rejects_empty_filename(self, app_and_client):
        (_, client) = app_and_client
        # 空文件名时 FastAPI/Starlette 在路由前就以 422 拒绝（UploadFile 必填）
        resp = client.post(
            "/upload",
            files={"file": ("", io.BytesIO(b"hi"), "text/plain")},
        )
        assert resp.status_code == 422

    def test_upload_rejects_disallowed_extension(self, app_and_client):
        (_, client) = app_and_client
        resp = client.post(
            "/upload",
            files={"file": ("evil.exe", io.BytesIO(b"x"), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "不支持的文件类型" in resp.json()["detail"]

    def test_upload_rejects_oversize_content_length(self, app_and_client, monkeypatch):
        """Content-Length 头超过 MAX_FILE_SIZE → 413。"""
        (_, client) = app_and_client
        # 把阈值调小到 10 字节，便于测试
        monkeypatch.setattr(upload_mod, "MAX_FILE_SIZE", 10)
        resp = client.post(
            "/upload",
            files={"file": ("big.txt", io.BytesIO(b"x" * 100), "text/plain")},
            headers={"content-length": "100"},
        )
        assert resp.status_code == 413
        assert "文件过大" in resp.json()["detail"]

    def test_upload_rejects_oversize_body(self, app_and_client, monkeypatch):
        """实际 body 超过 MAX_FILE_SIZE（Content-Length 缺失/伪造）→ 413。"""
        (_, client) = app_and_client
        monkeypatch.setattr(upload_mod, "MAX_FILE_SIZE", 10)
        # 不传 content-length 头，让分块读取触发限制
        resp = client.post(
            "/upload",
            files={"file": ("big.txt", io.BytesIO(b"x" * 100), "text/plain")},
        )
        assert resp.status_code == 413

    def test_upload_writes_meta_file(self, app_and_client):
        (app, client) = app_and_client
        resp = client.post(
            "/upload",
            files={"file": ("meta_check.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert resp.status_code == 200
        file_id = resp.json()["file_id"]
        upload_dir = upload_mod.UPLOAD_DIR
        meta_path = upload_dir / f"{file_id}.meta"
        assert meta_path.exists()
        content = meta_path.read_text(encoding="utf-8")
        assert "original_name=meta_check.txt" in content
        assert "size=5" in content
        assert "uploaded_at=" in content
