"""测试 — api/routes/sticker_favorites.py 表情收藏/最近/推荐/索引。

通过 monkeypatch 把 STICKERS_DIR / FAVORITES_PATH / RECENT_PATH / DATA_DIR
全部指向临时目录，实现完全隔离。
"""

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from api.routes import sticker_favorites as sticker_fav_mod
from api.routes.sticker_favorites import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """隔离的表情环境：tmp STICKERS_DIR + tmp DATA_DIR + tmp 收藏/最近 YAML。"""
    stickers_dir = tmp_path / "stickers"
    stickers_dir.mkdir()
    cat_dir = stickers_dir / "开心"
    cat_dir.mkdir()
    (cat_dir / "test1.webp").write_bytes(b"fake")
    (cat_dir / "test2.webp").write_bytes(b"fake")
    # 另一个分类，用于测试 _select_sticker 缺失
    other_dir = stickers_dir / "悲伤"
    other_dir.mkdir()
    (other_dir / "sad.webp").write_bytes(b"fake")

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    favorites_path = data_dir / "sticker_favorites.yaml"
    recent_path = data_dir / "sticker_recent.yaml"

    monkeypatch.setattr(sticker_fav_mod, "STICKERS_DIR", stickers_dir)
    monkeypatch.setattr(sticker_fav_mod, "FAVORITES_PATH", favorites_path)
    monkeypatch.setattr(sticker_fav_mod, "RECENT_PATH", recent_path)
    monkeypatch.setattr(sticker_fav_mod, "DATA_DIR", data_dir)
    # get_sticker_index 内部 `from app_paths import DATA_DIR` 用到
    monkeypatch.setattr("app_paths.DATA_DIR", data_dir)

    app = FastAPI()
    app.include_router(router)
    return {
        "app": app,
        "client": TestClient(app),
        "stickers_dir": stickers_dir,
        "data_dir": data_dir,
        "favorites_path": favorites_path,
        "recent_path": recent_path,
    }


# ── 纯函数 / 辅助函数 ──────────────────────────────


class TestHelpers:
    def test_validate_sticker_ref_accepts_valid(self):
        # 不抛异常即通过
        sticker_fav_mod._validate_sticker_ref("开心", "test1.webp")

    def test_validate_sticker_ref_rejects_bad_category(self):
        with pytest.raises(Exception) as exc:
            sticker_fav_mod._validate_sticker_ref("../etc", "test1.webp")
        assert "非法分类名" in str(exc.value.detail)

    def test_validate_sticker_ref_rejects_bad_filename(self):
        with pytest.raises(Exception) as exc:
            sticker_fav_mod._validate_sticker_ref("开心", "../../etc/passwd")
        assert "非法文件名" in str(exc.value.detail)

    def test_load_yaml_safe_creates_default_favorites(self, tmp_path):
        path = tmp_path / "favorites.yaml"
        data = sticker_fav_mod._load_yaml_safe(path)
        assert data == {"favorites": []}
        assert path.exists()
        # 第二次读应返回刚写入的默认
        assert sticker_fav_mod._load_yaml_safe(path) == {"favorites": []}

    def test_load_yaml_safe_creates_default_recent(self, tmp_path):
        # 'favorite' 不在路径名中 → 走 recent 默认
        path = tmp_path / "recent.yaml"
        data = sticker_fav_mod._load_yaml_safe(path)
        assert data == {"recent": []}

    def test_load_yaml_safe_returns_existing(self, tmp_path):
        path = tmp_path / "favorites.yaml"
        path.write_text("favorites:\n  - filename: x.webp\n    category: c\n", encoding="utf-8")
        data = sticker_fav_mod._load_yaml_safe(path)
        assert data["favorites"][0]["filename"] == "x.webp"

    def test_load_yaml_safe_invalid_yaml_returns_empty(self, tmp_path):
        path = tmp_path / "favorites.yaml"
        path.write_text(": : : invalid yaml :::", encoding="utf-8")
        # 无效 YAML → 异常被捕获返回 {}
        data = sticker_fav_mod._load_yaml_safe(path)
        assert data == {}

    def test_save_yaml_safe_writes_file(self, tmp_path):
        path = tmp_path / "sub" / "out.yaml"
        sticker_fav_mod._save_yaml_safe(path, {"favorites": [1, 2]})
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        assert loaded == {"favorites": [1, 2]}

    def test_get_time_period_returns_known_value(self):
        assert sticker_fav_mod._get_time_period() in {"late_night", "morning", "work", "evening"}

    def test_select_sticker_returns_first_webp(self, isolated_env):
        result = sticker_fav_mod._select_sticker("开心")
        assert result is not None
        assert result.startswith("开心/")
        assert result.endswith(".webp")

    def test_select_sticker_missing_category_returns_none(self, isolated_env):
        assert sticker_fav_mod._select_sticker("不存在的分类") is None

    def test_sticker_exists_builtin_present(self, isolated_env):
        assert sticker_fav_mod._sticker_exists("开心", "test1.webp") is True

    def test_sticker_exists_builtin_missing(self, isolated_env):
        assert sticker_fav_mod._sticker_exists("开心", "nope.webp") is False

    def test_sticker_exists_custom_present(self, isolated_env):
        custom_dir = isolated_env["data_dir"] / "config" / "stickers" / "custom"
        custom_dir.mkdir(parents=True)
        (custom_dir / "my.webp").write_bytes(b"x")
        assert sticker_fav_mod._sticker_exists("custom", "my.webp") is True

    def test_sticker_exists_custom_missing(self, isolated_env):
        assert sticker_fav_mod._sticker_exists("custom", "nope.webp") is False

    def test_detect_emotion_returns_none(self):
        # 内联 stub，始终返回 None
        assert sticker_fav_mod._detect_emotion_from_text("anything") is None


# ── 路由：收藏 ──────────────────────────────────────


class TestFavoritesRoutes:
    def test_get_favorites_empty(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/favorites")
        assert resp.status_code == 200
        assert resp.json() == {"favorites": []}

    def test_add_favorite_success(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/favorites", json={"category": "开心", "filename": "test1.webp"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        # 验证已写入 YAML
        data = yaml.safe_load(isolated_env["favorites_path"].read_text(encoding="utf-8"))
        assert len(data["favorites"]) == 1
        assert data["favorites"][0]["filename"] == "test1.webp"

    def test_add_favorite_duplicate(self, isolated_env):
        client = isolated_env["client"]
        client.post("/stickers/favorites", json={"category": "开心", "filename": "test1.webp"})
        # 第二次添加同一个 → success=False
        resp = client.post(
            "/stickers/favorites", json={"category": "开心", "filename": "test1.webp"}
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert "已在收藏" in resp.json()["message"]

    def test_add_favorite_missing_sticker_404(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/favorites", json={"category": "开心", "filename": "nope.webp"}
        )
        assert resp.status_code == 404
        assert "表情不存在" in resp.json()["detail"]

    def test_get_favorites_with_items_includes_path(self, isolated_env):
        client = isolated_env["client"]
        client.post("/stickers/favorites", json={"category": "开心", "filename": "test1.webp"})
        resp = client.get("/stickers/favorites")
        body = resp.json()
        assert len(body["favorites"]) == 1
        item = body["favorites"][0]
        assert item["path"] == "开心/test1.webp"
        assert item["usage_count"] == 0

    def test_remove_favorite_found(self, isolated_env):
        client = isolated_env["client"]
        client.post("/stickers/favorites", json={"category": "开心", "filename": "test1.webp"})
        resp = client.delete(
            "/stickers/favorites", params={"filename": "test1.webp", "category": "开心"}
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        # 再查应为空
        assert client.get("/stickers/favorites").json()["favorites"] == []

    def test_remove_favorite_not_found(self, isolated_env):
        resp = isolated_env["client"].delete(
            "/stickers/favorites", params={"filename": "x.webp", "category": "开心"}
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert "未找到" in resp.json()["message"]


# ── 路由：usage / skip ──────────────────────────────


class TestUsageSkipRoutes:
    def test_record_sticker_usage_success(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/usage", json={"category": "开心", "filename": "test1.webp"}
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_record_sticker_usage_missing_404(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/usage", json={"category": "开心", "filename": "nope.webp"}
        )
        assert resp.status_code == 404

    def test_record_sticker_skip_success(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/skip", json={"category": "开心", "filename": "test1.webp"}
        )
        assert resp.status_code == 200
        assert "已减少推荐" in resp.json()["message"]

    def test_record_sticker_skip_missing_404(self, isolated_env):
        resp = isolated_env["client"].post(
            "/stickers/skip", json={"category": "开心", "filename": "nope.webp"}
        )
        assert resp.status_code == 404


# ── 路由：recent ────────────────────────────────────


class TestRecentRoute:
    def test_get_recent_empty(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/recent")
        assert resp.status_code == 200
        assert resp.json() == {"recent": []}

    def test_get_recent_dedup_and_limit(self, isolated_env):
        # 直接写 recent YAML
        recent_path = isolated_env["recent_path"]
        recent_path.write_text(
            yaml.dump(
                {
                    "recent": [
                        {"category": "开心", "filename": "test1.webp"},
                        {"category": "悲伤", "filename": "sad.webp"},
                        {"category": "开心", "filename": "test1.webp"},  # 重复 path
                        {"category": "开心", "filename": "test2.webp"},
                    ]
                },
                allow_unicode=True,
            ),
            encoding="utf-8",
        )
        resp = isolated_env["client"].get("/stickers/recent", params={"limit": 2})
        body = resp.json()["recent"]
        # 反序 + 去重：test2, test1 (重复的第二条 test1 被去重), sad
        # limit=2 → 取前 2 条
        assert len(body) == 2
        # 第一条应是最后写入的（反序）
        assert body[0]["filename"] == "test2.webp"
        # 每条都有 path 字段
        for item in body:
            assert "path" in item


# ── 路由：recommendations ───────────────────────────


class TestRecommendationsRoute:
    def test_get_recommendations_returns_items(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/recommendations", params={"text": "", "limit": 4})
        assert resp.status_code == 200
        body = resp.json()
        assert "recommendations" in body
        assert isinstance(body["recommendations"], list)
        # 至少能推荐出临时目录里的某个表情
        assert len(body["recommendations"]) >= 1
        for item in body["recommendations"]:
            assert "category" in item
            assert "filename" in item
            assert "path" in item

    def test_get_recommendations_limit_clamped(self, isolated_env):
        # limit=1
        resp = isolated_env["client"].get("/stickers/recommendations", params={"limit": 1})
        assert resp.status_code == 200
        assert len(resp.json()["recommendations"]) <= 1

    def test_get_recommendations_invalid_limit_422(self, isolated_env):
        # limit=0 违反 ge=1
        resp = isolated_env["client"].get("/stickers/recommendations", params={"limit": 0})
        assert resp.status_code == 422
        # limit=13 违反 le=12
        resp2 = isolated_env["client"].get("/stickers/recommendations", params={"limit": 13})
        assert resp2.status_code == 422


# ── 路由：index ─────────────────────────────────────


class TestIndexRoute:
    def test_get_sticker_index_includes_builtin(self, isolated_env):
        resp = isolated_env["client"].get("/stickers/index")
        assert resp.status_code == 200
        index = resp.json()["index"]
        # 临时 STICKERS_DIR 有 开心/test1.webp, test2.webp, 悲伤/sad.webp
        assert "开心/test1.webp" in index
        assert "开心/test2.webp" in index
        assert "悲伤/sad.webp" in index
        assert index["开心/test1.webp"]["category"] == "开心"

    def test_get_sticker_index_includes_custom(self, isolated_env):
        # 在 tmp DATA_DIR 下创建自定义表情
        custom_dir = isolated_env["data_dir"] / "config" / "stickers" / "custom"
        custom_dir.mkdir(parents=True)
        (custom_dir / "mine.webp").write_bytes(b"x")
        resp = isolated_env["client"].get("/stickers/index")
        index = resp.json()["index"]
        assert "custom/mine.webp" in index
        assert index["custom/mine.webp"]["category"] == "custom"
