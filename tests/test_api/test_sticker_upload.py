"""测试 — api/routes/sticker_upload.py 自定义表情上传/列表/删除。

通过 monkeypatch CUSTOM_STICKERS_DIR 指向临时目录；上传成功路径用
monkeypatch _convert_to_webp 避免 PIL 依赖，另单独测试真实 PIL 转换。
"""

import io
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import sticker_upload as sticker_up_mod
from api.routes.sticker_upload import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """隔离的自定义表情目录。"""
    custom_dir = tmp_path / "custom"
    custom_dir.mkdir()
    monkeypatch.setattr(sticker_up_mod, "CUSTOM_STICKERS_DIR", custom_dir)
    app = FastAPI()
    app.include_router(router)
    return {"app": app, "client": TestClient(app), "custom_dir": custom_dir}


def _make_png_bytes() -> bytes:
    """用 PIL 生成一张 10x10 的 PNG。"""
    from PIL import Image

    img = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestUploadRoute:
    def test_upload_rejects_missing_filename(self, isolated_env, monkeypatch):
        # 空文件名 → 400（路由内显式检查）；为绕过 Starlette 422，传一个空 Bytes
        # 但 Starlette 对空 filename 仍可能 422。这里直接断言非 200。
        monkeypatch.setattr(sticker_up_mod, "_convert_to_webp", lambda s, d: True)
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("", io.BytesIO(b"x"), "image/png")},
        )
        # 空文件名：Starlette 可能 422，路由可能 400；接受两者
        assert resp.status_code in (400, 422)

    def test_upload_rejects_bad_extension(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("file.exe", io.BytesIO(b"x"), "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "不支持" in resp.json()["detail"]

    def test_upload_rejects_oversize(self, isolated_env, monkeypatch):
        monkeypatch.setattr(sticker_up_mod, "MAX_FILE_SIZE", 5)
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("big.png", io.BytesIO(b"x" * 100), "image/png")},
        )
        assert resp.status_code == 400
        assert "文件过大" in resp.json()["detail"]

    def test_upload_existing_hash_returns_duplicate(self, isolated_env, monkeypatch):
        custom_dir = isolated_env["custom_dir"]
        # 预创建目标文件（hash 对应 custom_<md5[:16]>.webp）
        import hashlib

        content = b"hello"
        h = hashlib.md5(content).hexdigest()[:16]
        (custom_dir / f"custom_{h}.webp").write_bytes(b"x")

        monkeypatch.setattr(sticker_up_mod, "_convert_to_webp", lambda s, d: True)
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("dup.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert "重复" in body["message"]
        assert body["path"] == f"custom/custom_{h}.webp"

    def test_upload_convert_failure_returns_500(self, isolated_env, monkeypatch):
        monkeypatch.setattr(sticker_up_mod, "_convert_to_webp", lambda s, d: False)
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("bad.png", io.BytesIO(b"not an image"), "image/png")},
        )
        assert resp.status_code == 500
        assert "转换失败" in resp.json()["detail"]
        # 失败时 dst 应被清理
        assert not list(isolated_env["custom_dir"].glob("custom_*.webp"))

    def test_upload_success_path(self, isolated_env, monkeypatch):
        converted = {}

        def fake_convert(src: Path, dst: Path) -> bool:
            converted["src"] = src
            converted["dst"] = dst
            dst.write_bytes(b"webp-bytes")
            return True

        monkeypatch.setattr(sticker_up_mod, "_convert_to_webp", fake_convert)
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("new.png", io.BytesIO(b"pngdata"), "image/png")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["filename"].startswith("custom_")
        assert body["filename"].endswith(".webp")
        assert body["path"] == f"custom/{body['filename']}"
        # 临时文件应被清理
        assert "src" in converted
        assert not converted["src"].exists()
        # 目标文件存在
        assert (isolated_env["custom_dir"] / body["filename"]).exists()

    def test_upload_success_jpg_extension(self, isolated_env, monkeypatch):
        monkeypatch.setattr(
            sticker_up_mod, "_convert_to_webp", lambda s, d: (d.write_bytes(b"x"), True)[1]
        )
        resp = isolated_env["client"].post(
            "/stickers/upload",
            files={"file": ("pic.jpg", io.BytesIO(b"data"), "image/jpeg")},
        )
        assert resp.status_code == 200


class TestListCustomStickers:
    def test_list_empty(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/custom")
        assert resp.status_code == 200
        assert resp.json() == {"stickers": []}

    def test_list_with_files(self, isolated_env):
        d = isolated_env["custom_dir"]
        (d / "custom_aaa.webp").write_bytes(b"x")
        (d / "custom_bbb.webp").write_bytes(b"y")
        (d / "not_webp.txt").write_bytes(b"z")  # 应被忽略
        resp = isolated_env["client"].get("/stickers/custom")
        body = resp.json()["stickers"]
        names = [s["filename"] for s in body]
        assert "custom_aaa.webp" in names
        assert "custom_bbb.webp" in names
        assert "not_webp.txt" not in names
        for s in body:
            assert s["category"] == "custom"
            assert s["path"].startswith("custom/")


class TestDeleteCustomSticker:
    def test_delete_invalid_name_400(self, isolated_env):
        # 含非法字符 @ → regex ^custom_[\w]+\.webp$ 不匹配 → 400
        resp = isolated_env["client"].delete("/stickers/custom/custom_evil@.webp")
        assert resp.status_code == 400
        assert "非法文件名" in resp.json()["detail"]

    def test_delete_invalid_name_no_prefix_400(self, isolated_env):
        # 缺少 custom_ 前缀
        resp = isolated_env["client"].delete("/stickers/custom/random.webp")
        assert resp.status_code == 400

    def test_delete_missing_404(self, isolated_env):
        resp = isolated_env["client"].delete("/stickers/custom/custom_missing.webp")
        assert resp.status_code == 404
        assert "不存在" in resp.json()["detail"]

    def test_delete_success(self, isolated_env):
        d = isolated_env["custom_dir"]
        target = d / "custom_target.webp"
        target.write_bytes(b"x")
        resp = isolated_env["client"].delete("/stickers/custom/custom_target.webp")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert not target.exists()


class TestConvertToWebp:
    def test_convert_static_png_success(self, tmp_path):
        png = tmp_path / "in.png"
        png.write_bytes(_make_png_bytes())
        dst = tmp_path / "out.webp"
        assert sticker_up_mod._convert_to_webp(png, dst) is True
        assert dst.exists()
        # 输出应是合法 webp
        from PIL import Image

        img = Image.open(dst)
        assert img.format == "WEBP"

    def test_convert_invalid_input_returns_false(self, tmp_path):
        src = tmp_path / "bad.png"
        src.write_bytes(b"definitely not an image")
        dst = tmp_path / "out.webp"
        assert sticker_up_mod._convert_to_webp(src, dst) is False
        assert not dst.exists()
