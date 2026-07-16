"""Integration tests for the upload route — catches the missing `import re` regression."""

import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.upload import router, _sanitize_filename


app = FastAPI()
app.include_router(router)
client = TestClient(app)


class TestSanitizeFilename:
    def test_strips_unicode_and_spaces(self):
        assert _sanitize_filename("hello world.txt") == "helloworld.txt"

    def test_strips_chinese_chars(self):
        assert _sanitize_filename("文件 名.py") == ".py"

    def test_keeps_allowed_chars(self):
        assert _sanitize_filename("my-file_v1.2.txt") == "my-file_v1.2.txt"

    def test_windows_reserved_name_gets_prefix(self):
        result = _sanitize_filename("CON.txt")
        assert result.startswith("_")

    def test_empty_after_sanitization_returns_default(self):
        assert _sanitize_filename("中文") == "unnamed_file"


class TestUploadRoute:
    def test_upload_txt_file_succeeds(self, tmp_path, monkeypatch):
        """Upload route must not crash with NameError on `re.sub`."""
        from api.routes import upload as upload_mod
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)

        response = client.post(
            "/upload",
            files={"file": ("test file.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "testfile.txt"
        assert data["size"] == 5
