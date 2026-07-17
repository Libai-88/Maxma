"""覆盖 — api/routes/upload.py 错误分支（lines 55, 72, 73, 89）。

TestClient/FastAPI 在路由前拦截部分错误（空文件名 422、自动 Content-Length），
需直接调用 upload_file 并注入 mock Request / UploadFile。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from api.routes import upload as upload_mod


def _mock_request(headers: dict | None = None) -> MagicMock:
    req = MagicMock()
    req.headers = headers or {}
    return req


class TestUploadEmptyFilename:
    async def test_empty_filename_raises_400(self, monkeypatch, tmp_path):
        """Line 55: file.filename 为空字符串 → 400。

        TestClient 发送空文件名时 FastAPI 返回 422，不会进入 handler，
        所以直接调用 upload_file。
        """
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        file = MagicMock()
        file.filename = ""
        file.read = AsyncMock(return_value=b"")
        with pytest.raises(HTTPException) as exc:
            await upload_mod.upload_file(_mock_request(), file)
        assert exc.value.status_code == 400
        assert "文件名不能为空" in exc.value.detail


class TestUploadInvalidContentLength:
    async def test_invalid_content_length_header_falls_back(
        self, monkeypatch, tmp_path
    ):
        """Lines 72-73: Content-Length 非数字 → cl_value=None，继续读取。"""
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        file = MagicMock()
        file.filename = "ok.txt"
        file.read = AsyncMock(side_effect=[b"hi", b""])
        req = _mock_request(headers={"content-length": "not-a-number"})
        resp = await upload_mod.upload_file(req, file)
        assert resp["filename"] == "ok.txt"
        assert resp["size"] == 2


class TestUploadOversizeChunkRead:
    async def test_oversize_during_chunk_read_raises_413(
        self, monkeypatch, tmp_path
    ):
        """Line 89: 分块累计超过 MAX_FILE_SIZE → 413（无 Content-Length 头）。

        TestClient 自动添加 Content-Length，导致 line 74-78 的快速拒绝先触发。
        直接调用 upload_file 并注入无 content-length 的 mock request。
        """
        monkeypatch.setattr(upload_mod, "UPLOAD_DIR", tmp_path)
        monkeypatch.setattr(upload_mod, "MAX_FILE_SIZE", 10)
        file = MagicMock()
        file.filename = "big.txt"
        # 第一次 read 返回 11 字节（>10），触发 line 89
        file.read = AsyncMock(return_value=b"x" * 11)
        req = _mock_request(headers={})  # 无 content-length
        with pytest.raises(HTTPException) as exc:
            await upload_mod.upload_file(req, file)
        assert exc.value.status_code == 413
        assert "文件过大" in exc.value.detail
