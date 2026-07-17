"""测试 — api/routes/news.py 系统更新动态。"""

import yaml
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import news as news_mod
from api.routes.news import router


@pytest.fixture
def client(monkeypatch, tmp_path):
    news_path = tmp_path / "news.yaml"
    monkeypatch.setattr(news_mod, "NEWS_PATH", news_path)
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "path": news_path}


def _write_news(path, items):
    path.write_text(yaml.dump({"news": items}, allow_unicode=True), encoding="utf-8")


class TestNewsRoute:
    def test_list_news_missing_file_returns_empty(self, client):
        resp = client["client"].get("/news")
        assert resp.status_code == 200
        assert resp.json() == {"news": []}

    def test_list_news_sorted_descending_by_date(self, client):
        _write_news(
            client["path"],
            [
                {
                    "id": "a",
                    "title": "旧",
                    "description": "d1",
                    "type": "fix",
                    "date": "2026-01-01",
                    "version": "1.0.0",
                },
                {
                    "id": "b",
                    "title": "新",
                    "description": "d2",
                    "type": "feat",
                    "date": "2026-07-01",
                    "version": "2.0.0",
                    "tags": ["ui"],
                    "pr_number": 42,
                },
            ],
        )
        resp = client["client"].get("/news")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["news"]) == 2
        # 最新在前
        assert body["news"][0]["id"] == "b"
        assert body["news"][1]["id"] == "a"
        # 验证字段透传
        new_item = body["news"][0]
        assert new_item["title"] == "新"
        assert new_item["tags"] == ["ui"]
        assert new_item["pr_number"] == 42
        assert new_item["en_title"] is None

    def test_load_news_empty_file(self, client):
        client["path"].write_text("", encoding="utf-8")
        entries = news_mod._load_news()
        assert entries == []

    def test_load_news_missing_returns_empty(self, tmp_path):
        # 直接调用 _load_news，未 monkeypatch 时 NEWS_PATH 指向模块原始路径
        # 这里用一个不存在的临时路径验证逻辑
        import api.routes.news as nm
        old = nm.NEWS_PATH
        try:
            nm.NEWS_PATH = tmp_path / "nope.yaml"
            assert nm._load_news() == []
        finally:
            nm.NEWS_PATH = old
