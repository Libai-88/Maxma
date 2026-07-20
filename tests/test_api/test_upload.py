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
    def test_strips_spaces(self):
        # Spaces are not in \w, so they are still stripped — but Unicode
        # letters/digits are preserved (B-013 regression coverage below).
        assert _sanitize_filename("hello world.txt") == "helloworld.txt"

    def test_keeps_unicode_letters(self):
        # B-013: previously Chinese filenames were stripped to dotfiles
        # (e.g. "报告.pdf" → ".pdf"). Now Unicode word chars are kept.
        assert _sanitize_filename("报告.pdf") == "报告.pdf"
        assert _sanitize_filename("文件 名.py") == "文件名.py"

    def test_keeps_allowed_chars(self):
        assert _sanitize_filename("my-file_v1.2.txt") == "my-file_v1.2.txt"

    def test_windows_reserved_name_gets_prefix(self):
        result = _sanitize_filename("CON.txt")
        assert result.startswith("_")

    def test_strips_path_separators(self):
        # B-013: Path(name).name drops the directory component on every
        # platform (forward slash is always a separator); the remaining
        # Unicode filename is then preserved by the widened regex.
        assert _sanitize_filename("dir/报告.pdf") == "报告.pdf"
        # Backslash is a path separator on Windows; on POSIX it survives
        # Path(name).name but is explicitly stripped by the [\\/] regex pass
        # so that even cross-platform names cannot smuggle a separator.
        bs = _sanitize_filename("a\\b.pdf")
        assert "\\" not in bs and "/" not in bs

    def test_empty_after_sanitization_returns_default(self):
        # Only truly empty/punctuation-only names fall back to the default.
        assert _sanitize_filename("") == "unnamed_file"
        assert _sanitize_filename("   ") == "unnamed_file"


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
