"""Tests for api/routes/upload.py — 文件上传 API。"""

import io
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from fastapi import FastAPI

from api.routes.upload import router, UPLOAD_DIR, MAX_FILE_SIZE, ALLOWED_EXTENSIONS


@pytest.fixture
def app():
    """创建测试 FastAPI 应用。"""
    app = FastAPI()
    app.include_router(router)
    return app


@pytest.fixture
def client(app):
    """创建测试客户端。"""
    return TestClient(app)


@pytest.fixture
def cleanup_uploads():
    """测试后清理上传文件。"""
    yield
    # 清理测试文件
    for meta_file in UPLOAD_DIR.glob("*.meta"):
        meta_file.unlink()
        # 找到对应的实际文件
        file_id = meta_file.stem
        for f in UPLOAD_DIR.glob(f"{file_id}_*"):
            f.unlink()


class TestUploadFile:
    """POST /upload 端点测试。"""

    def test_upload_txt_file_success(self, client, cleanup_uploads):
        """上传 .txt 文件成功。"""
        content = b"Hello, World!"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert "file_id" in data
        assert data["filename"] == "test.txt"
        assert data["size"] == len(content)
        assert "path" in data
        assert data["path"].startswith("local:")

    def test_upload_py_file_success(self, client, cleanup_uploads):
        """上传 .py 文件成功。"""
        content = b"print('hello')"
        files = {"file": ("test.py", io.BytesIO(content), "text/x-python")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "test.py"

    def test_upload_png_file_success(self, client, cleanup_uploads):
        """上传 .png 文件成功。"""
        # 最小的 PNG 文件头
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        files = {"file": ("test.png", io.BytesIO(content), "image/png")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "test.png"

    def test_upload_disallowed_extension_fails(self, client):
        """上传不支持的扩展名失败。"""
        content = b"test content"
        files = {"file": ("test.exe", io.BytesIO(content), "application/octet-stream")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 400
        assert "不支持的文件类型" in response.json()["detail"]

    def test_upload_empty_filename_fails(self, client):
        """上传空文件名失败。"""
        content = b"test content"
        files = {"file": ("", io.BytesIO(content), "text/plain")}
        
        response = client.post("/upload", files=files)
        
        # FastAPI 返回 422 验证错误
        assert response.status_code in (400, 422)

    def test_upload_file_too_large_fails(self, client):
        """上传超大文件失败。"""
        # 创建超过 MAX_FILE_SIZE 的内容
        content = b"x" * (MAX_FILE_SIZE + 1)
        files = {"file": ("large.txt", io.BytesIO(content), "text/plain")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 413
        assert "文件过大" in response.json()["detail"]

    def test_upload_creates_meta_file(self, client, cleanup_uploads):
        """上传创建元数据文件。"""
        content = b"test content"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        file_id = response.json()["file_id"]
        meta_path = UPLOAD_DIR / f"{file_id}.meta"
        assert meta_path.exists()
        
        # 验证元数据内容
        meta_content = meta_path.read_text(encoding="utf-8")
        assert "original_name=test.txt" in meta_content
        assert f"size={len(content)}" in meta_content

    def test_upload_creates_actual_file(self, client, cleanup_uploads):
        """上传创建实际文件。"""
        content = b"test content"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        
        response = client.post("/upload", files=files)
        
        assert response.status_code == 200
        data = response.json()
        file_path = data["path"].replace("local:", "")
        assert Path(file_path).exists()
        assert Path(file_path).read_bytes() == content


class TestListUploads:
    """GET /uploads 端点测试。"""

    def test_list_uploads_empty(self, client):
        """无上传文件时返回空列表。"""
        response = client.get("/uploads")
        
        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert "count" in data
        assert isinstance(data["files"], list)

    def test_list_uploads_returns_uploaded_files(self, client, cleanup_uploads):
        """返回已上传的文件列表。"""
        # 上传两个文件
        for name in ["file1.txt", "file2.txt"]:
            content = b"test content"
            files = {"file": (name, io.BytesIO(content), "text/plain")}
            client.post("/upload", files=files)
        
        response = client.get("/uploads")
        
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 2
        
        filenames = [f["filename"] for f in data["files"]]
        assert "file1.txt" in filenames
        assert "file2.txt" in filenames

    def test_list_uploads_includes_metadata(self, client, cleanup_uploads):
        """返回的文件包含元数据。"""
        content = b"test content"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        client.post("/upload", files=files)
        
        response = client.get("/uploads")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["files"]) > 0
        
        file_info = data["files"][0]
        assert "file_id" in file_info
        assert "filename" in file_info
        assert "size" in file_info
        assert "uploaded_at" in file_info
        assert "path" in file_info


class TestDeleteUpload:
    """DELETE /uploads/{file_id} 端点测试。"""

    def test_delete_existing_file(self, client, cleanup_uploads):
        """删除已上传的文件成功。"""
        # 先上传文件
        content = b"test content"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        upload_response = client.post("/upload", files=files)
        file_id = upload_response.json()["file_id"]
        
        # 删除文件
        response = client.delete(f"/uploads/{file_id}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] is True
        assert data["file_id"] == file_id
        
        # 验证文件已删除
        meta_path = UPLOAD_DIR / f"{file_id}.meta"
        assert not meta_path.exists()

    def test_delete_nonexistent_file_fails(self, client):
        """删除不存在的文件失败。"""
        response = client.delete("/uploads/nonexistent-id")
        
        assert response.status_code == 404
        assert "不存在" in response.json()["detail"]

    def test_delete_removes_both_meta_and_file(self, client, cleanup_uploads):
        """删除同时移除元数据和实际文件。"""
        # 上传文件
        content = b"test content"
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        upload_response = client.post("/upload", files=files)
        upload_data = upload_response.json()
        file_id = upload_data["file_id"]
        file_path = upload_data["path"].replace("local:", "")
        
        # 删除
        client.delete(f"/uploads/{file_id}")
        
        # 验证两者都已删除
        meta_path = UPLOAD_DIR / f"{file_id}.meta"
        assert not meta_path.exists()
        assert not Path(file_path).exists()


class TestAllowedExtensions:
    """ALLOWED_EXTENSIONS 常量测试。"""

    def test_common_text_formats_allowed(self):
        """常见文本格式被允许。"""
        assert ".txt" in ALLOWED_EXTENSIONS
        assert ".md" in ALLOWED_EXTENSIONS
        assert ".csv" in ALLOWED_EXTENSIONS
        assert ".json" in ALLOWED_EXTENSIONS

    def test_code_formats_allowed(self):
        """代码文件格式被允许。"""
        assert ".py" in ALLOWED_EXTENSIONS
        assert ".js" in ALLOWED_EXTENSIONS
        assert ".ts" in ALLOWED_EXTENSIONS
        assert ".java" in ALLOWED_EXTENSIONS

    def test_image_formats_allowed(self):
        """图片格式被允许。"""
        assert ".png" in ALLOWED_EXTENSIONS
        assert ".jpg" in ALLOWED_EXTENSIONS
        assert ".jpeg" in ALLOWED_EXTENSIONS
        assert ".gif" in ALLOWED_EXTENSIONS

    def test_document_formats_allowed(self):
        """文档格式被允许。"""
        assert ".pdf" in ALLOWED_EXTENSIONS
        assert ".docx" in ALLOWED_EXTENSIONS
        assert ".xlsx" in ALLOWED_EXTENSIONS
