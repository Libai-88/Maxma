"""测试 — api/routes/stickers.py 表情包文件服务。

覆盖路由：
- GET /stickers/random/{category}  随机返回一个表情
- GET /stickers/{category}/{filename}  返回表情文件
- GET /stickers  列出所有分类
"""

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import stickers as stickers_mod
from api.routes.stickers import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """隔离 STICKERS_DIR 与 CUSTOM_STICKERS_DIR。"""
    stickers_dir = tmp_path / "bundle" / "config" / "stickers"
    stickers_dir.mkdir(parents=True)
    custom_dir = tmp_path / "data" / "config" / "stickers" / "custom"
    custom_dir.mkdir(parents=True)
    monkeypatch.setattr(stickers_mod, "STICKERS_DIR", stickers_dir)
    monkeypatch.setattr(stickers_mod, "CUSTOM_STICKERS_DIR", custom_dir)
    app = FastAPI()
    app.include_router(router)
    return {
        "client": TestClient(app),
        "stickers_dir": stickers_dir,
        "custom_dir": custom_dir,
    }


def _make_webp(path):
    """写入最小合法 WebP 文件头（RIFF....WEBP）。"""
    path.write_bytes(b"RIFF\x00\x00\x00\x00WEBP")


class TestRandomSticker:
    def test_random_sticker_invalid_category_400(self, isolated_env):
        # 含非法字符（空格）
        resp = isolated_env["client"].get("/stickers/random/bad cat")
        assert resp.status_code == 400
        assert "非法分类名" in resp.json()["detail"]

    def test_random_sticker_category_not_dir_404(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/random/ghost")
        assert resp.status_code == 404
        assert "无表情" in resp.json()["detail"]

    def test_random_sticker_dir_empty_404(self, isolated_env):
        d = isolated_env["stickers_dir"] / "smile"
        d.mkdir()
        resp = isolated_env["client"].get("/stickers/random/smile")
        assert resp.status_code == 404
        assert "无表情" in resp.json()["detail"]

    def test_random_sticker_returns_path(self, isolated_env):
        d = isolated_env["stickers_dir"] / "smile"
        d.mkdir()
        _make_webp(d / "a.webp")
        _make_webp(d / "b.webp")
        resp = isolated_env["client"].get("/stickers/random/smile")
        assert resp.status_code == 200
        body = resp.json()
        assert body["category"] == "smile"
        assert body["path"].startswith("smile/")
        assert body["path"].endswith(".webp")

    def test_random_sticker_chinese_category_allowed(self, isolated_env):
        # 中文名应被 regex 允许（\u4e00-\u9fff）
        d = isolated_env["stickers_dir"] / "表情"
        d.mkdir()
        _make_webp(d / "x.webp")
        resp = isolated_env["client"].get("/stickers/random/表情")
        assert resp.status_code == 200
        assert resp.json()["category"] == "表情"


class TestGetSticker:
    def test_get_sticker_invalid_category_400(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/bad%2B/x.webp")
        assert resp.status_code == 400

    def test_get_sticker_invalid_filename_400(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/smile/bad.png")
        assert resp.status_code == 400
        assert "非法文件名" in resp.json()["detail"]

    def test_get_sticker_builtin_missing_404(self, isolated_env):
        d = isolated_env["stickers_dir"] / "smile"
        d.mkdir()
        resp = isolated_env["client"].get("/stickers/smile/a.webp")
        assert resp.status_code == 404
        assert "贴纸不存在" in resp.json()["detail"]

    def test_get_sticker_builtin_success(self, isolated_env):
        d = isolated_env["stickers_dir"] / "smile"
        d.mkdir()
        _make_webp(d / "a.webp")
        resp = isolated_env["client"].get("/stickers/smile/a.webp")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"
        assert "immutable" in resp.headers["cache-control"]

    def test_get_sticker_custom_success(self, isolated_env):
        custom = isolated_env["custom_dir"]
        _make_webp(custom / "my.webp")
        resp = isolated_env["client"].get("/stickers/custom/my.webp")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    def test_get_sticker_custom_missing_404(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/custom/ghost.webp")
        assert resp.status_code == 404
        assert "贴纸不存在" in resp.json()["detail"]


class TestListStickers:
    def test_list_empty(self, isolated_env):
        resp = isolated_env["client"].get("/stickers")
        assert resp.status_code == 200
        assert resp.json() == {"categories": {}}

    def test_list_includes_builtin_categories(self, isolated_env):
        sd = isolated_env["stickers_dir"]
        (sd / "smile").mkdir()
        _make_webp(sd / "smile" / "a.webp")
        _make_webp(sd / "smile" / "b.webp")
        (sd / "sad").mkdir()
        _make_webp(sd / "sad" / "c.webp")
        # 空目录应被跳过
        (sd / "empty").mkdir()
        # 非目录应被跳过
        (sd / "file.txt").write_text("x")

        resp = isolated_env["client"].get("/stickers")
        assert resp.status_code == 200
        cats = resp.json()["categories"]
        assert cats["smile"] == 2
        assert cats["sad"] == 1
        assert "empty" not in cats

    def test_list_includes_custom(self, isolated_env):
        custom = isolated_env["custom_dir"]
        _make_webp(custom / "x.webp")
        resp = isolated_env["client"].get("/stickers")
        cats = resp.json()["categories"]
        assert cats.get("custom") == 1

    def test_list_stickers_dir_not_dir(self, tmp_path, monkeypatch):
        # STICKERS_DIR 指向文件 → is_dir() False
        f = tmp_path / "file"
        f.write_text("x")
        monkeypatch.setattr(stickers_mod, "STICKERS_DIR", f)
        monkeypatch.setattr(
            stickers_mod, "CUSTOM_STICKERS_DIR", tmp_path / "nope_custom"
        )
        app = FastAPI()
        app.include_router(router)
        resp = TestClient(app).get("/stickers")
        assert resp.status_code == 200
        assert resp.json() == {"categories": {}}


class TestRegexCoverage:
    """直接验证 regex 行为以覆盖模块级 import 之外的边界。"""

    def test_category_regex_allows_word_dash_chinese(self):
        pat = re.compile(r"^[\w\u4e00-\u9fff\-]+$")
        assert pat.match("smile")
        assert pat.match("smile-2")
        assert pat.match("表情")
        assert not pat.match("bad cat")
        assert not pat.match("a/b")

    def test_filename_regex_strict(self):
        pat = re.compile(r"^[\w\-]+\.webp$")
        assert pat.match("a.webp")
        assert pat.match("a-b.webp")
        assert not pat.match("a.png")
        assert not pat.match("../a.webp")
