"""Tests for api/routes/sticker_upload.py — GIF branch, RGB static, empty filename."""

import asyncio
import io

import pytest
from fastapi import HTTPException
from PIL import Image

from api.routes import sticker_upload as mod


def _make_gif_bytes(n_frames: int = 3) -> bytes:
    """生成 n 帧的动态 GIF。"""
    frames = []
    for i in range(n_frames):
        img = Image.new("RGBA", (20, 20), (i * 60, 0, 0, 255))
        frames.append(img)
    buf = io.BytesIO()
    frames[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=100,
        loop=0,
    )
    return buf.getvalue()


def _make_rgb_jpeg_bytes() -> bytes:
    """生成 RGB 模式的 JPEG（非 RGBA/LA/P）。"""
    img = Image.new("RGB", (30, 30), (0, 128, 255))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class TestConvertGif:
    def test_convert_animated_gif_success(self, tmp_path):
        src = tmp_path / "anim.gif"
        src.write_bytes(_make_gif_bytes(3))
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()
        out = Image.open(dst)
        assert out.format == "WEBP"

    def test_convert_single_frame_gif(self, tmp_path):
        src = tmp_path / "one.gif"
        src.write_bytes(_make_gif_bytes(1))
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()


class TestConvertRgbStatic:
    def test_convert_rgb_jpeg_to_webp(self, tmp_path):
        """覆盖 line 61: img.mode 不在 ('RGBA','LA','P') 的 else 分支。"""
        src = tmp_path / "rgb.jpg"
        src.write_bytes(_make_rgb_jpeg_bytes())
        dst = tmp_path / "out.webp"
        assert mod._convert_to_webp(src, dst) is True
        assert dst.exists()
        out = Image.open(dst)
        assert out.format == "WEBP"


class TestEmptyFilenameRoute:
    """覆盖 line 78: file.filename 为空字符串时 raise 400。

    TestClient 路径下 Starlette 会先返回 422，因此直接调用 route 函数，
    传入 filename="" 的伪 UploadFile。
    """

    class _FakeUploadFile:
        def __init__(self, filename, content: bytes = b""):
            self.filename = filename
            self._content = content

        async def read(self) -> bytes:
            return self._content

    def test_empty_filename_raises_400(self):
        fake = self._FakeUploadFile(filename="", content=b"x")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(mod.upload_sticker(file=fake))
        assert exc.value.status_code == 400
        assert "缺少文件名" in exc.value.detail

    def test_none_filename_raises_400(self):
        fake = self._FakeUploadFile(filename=None, content=b"x")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(mod.upload_sticker(file=fake))
        assert exc.value.status_code == 400
