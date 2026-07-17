"""覆盖 — api/routes/sticker_favorites.py 时间分支与推荐逻辑。

覆盖 lines 87, 89, 92, 102, 224, 228, 230, 234：
- _get_time_period 的 late_night/morning/evening 返回分支
- _select_sticker 目录存在但无 .webp 时返回 None
- get_recommendations 的 emotion 分支和各时间段分支
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

from api.routes import sticker_favorites as sf


def _patch_datetime_now(monkeypatch, hour: int) -> None:
    """Replace sys.modules['datetime'] so datetime.datetime.now().hour == hour.

    datetime.datetime is a C immutable type, so we swap the whole module.
    _get_time_period does a local `import datetime`, which picks up our fake.
    """
    fake_now = MagicMock()
    fake_now.hour = hour
    fake_dt_cls = MagicMock()
    fake_dt_cls.now.return_value = fake_now
    fake_module = types.ModuleType("datetime")
    fake_module.datetime = fake_dt_cls
    monkeypatch.setitem(sys.modules, "datetime", fake_module)


class TestGetTimePeriodBranches:
    @pytest.mark.parametrize("hour,expected", [
        (2, "late_night"),   # line 87
        (8, "morning"),      # line 89
        (20, "evening"),     # line 92
    ])
    def test_time_period_branches(self, monkeypatch, hour, expected):
        _patch_datetime_now(monkeypatch, hour)
        assert sf._get_time_period() == expected


class TestSelectStickerEmptyDir:
    def test_returns_none_when_no_webp(self, tmp_path, monkeypatch):
        """Line 102: 分类目录存在但无 .webp 文件 → None。"""
        stickers = tmp_path / "stickers"
        (stickers / "空").mkdir(parents=True)
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        assert sf._select_sticker("空") is None


class TestRecommendationsEmotionBranch:
    async def test_emotion_detected_appends_category(self, tmp_path, monkeypatch):
        """Line 224: _detect_emotion_from_text 返回非 None → append category。"""
        stickers = tmp_path / "stickers"
        cat = stickers / "爱心"
        cat.mkdir(parents=True)
        (cat / "a.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)

        emotion = MagicMock()
        emotion.category = "爱心"
        monkeypatch.setattr(sf, "_detect_emotion_from_text", lambda _t: emotion)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "work")

        resp = await sf.get_recommendations(text="happy", limit=4)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "爱心" in cats


class TestRecommendationsTimeBranches:
    async def test_late_night_branch(self, tmp_path, monkeypatch):
        """Line 228: late_night → extend 爱心/委屈/日常。"""
        stickers = tmp_path / "stickers"
        for c in ["爱心", "委屈", "日常"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "late_night")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "委屈" in cats

    async def test_morning_branch(self, tmp_path, monkeypatch):
        """Line 230: morning → extend 日常/开心。"""
        stickers = tmp_path / "stickers"
        for c in ["日常", "开心"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "morning")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "日常" in cats

    async def test_evening_branch(self, tmp_path, monkeypatch):
        """Line 234: evening → extend 开心/爱心/日常。"""
        stickers = tmp_path / "stickers"
        for c in ["开心", "爱心", "日常"]:
            d = stickers / c
            d.mkdir(parents=True)
            (d / "x.webp").write_bytes(b"x")
        monkeypatch.setattr(sf, "STICKERS_DIR", stickers)
        monkeypatch.setattr(sf, "DATA_DIR", tmp_path)
        monkeypatch.setattr("app_paths.DATA_DIR", tmp_path)
        monkeypatch.setattr(sf, "_get_time_period", lambda: "evening")
        resp = await sf.get_recommendations(text="", limit=12)
        cats = {item["category"] for item in resp["recommendations"]}
        assert "开心" in cats
