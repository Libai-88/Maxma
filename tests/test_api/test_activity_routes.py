"""测试 — api/routes/activity.py Activity Hub REST + SSE。

覆盖：
- GET /activity/recent 空/有记录/按 category 过滤
- GET /activity/stats
- DELETE /activity 清空
- GET /activity/stream SSE 流（headers + 事件推送 + 断连退出）
"""

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.activity_hub import ActivityRecord, activity_hub
from api.routes import activity as activity_mod
from api.routes.activity import router


@pytest.fixture
def app_client(monkeypatch):
    # 每个测试前清空 activity_hub 单例缓冲
    activity_hub.clear()
    # 加速 SSE 测试：sleep 立即返回
    async def _no_sleep(*a, **k):
        return None

    monkeypatch.setattr(activity_mod.asyncio, "sleep", _no_sleep)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestRecent:
    def test_recent_empty(self, app_client):
        resp = app_client.get("/activity/recent")
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"records": [], "total": 0}

    def test_recent_returns_records(self, app_client):
        activity_hub.add("turn", "turn_start", session_id="s1", message="hello")
        activity_hub.add("tool", "tool_end", tool_name="bash")
        resp = app_client.get("/activity/recent")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert body["records"][0]["category"] == "turn"
        assert body["records"][1]["category"] == "tool"
        # 验证 to_dict 完整字段
        r0 = body["records"][0]
        assert r0["session_id"] == "s1"
        assert r0["message"] == "hello"
        assert r0["level"] == "info"
        assert isinstance(r0["timestamp"], float)

    def test_recent_limit_param(self, app_client):
        for i in range(5):
            activity_hub.add("turn", f"t{i}")
        resp = app_client.get("/activity/recent", params={"limit": 2})
        body = resp.json()
        assert body["total"] == 2
        # 返回最后 2 条
        assert body["records"][0]["event_type"] == "t3"
        assert body["records"][1]["event_type"] == "t4"

    def test_recent_category_filter(self, app_client):
        activity_hub.add("turn", "t1")
        activity_hub.add("tool", "tool1")
        resp = app_client.get("/activity/recent", params={"category": "tool"})
        body = resp.json()
        assert body["total"] == 1
        assert body["records"][0]["category"] == "tool"


class TestStats:
    def test_stats_empty(self, app_client):
        resp = app_client.get("/activity/stats")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 0
        assert body["by_category"] == {}
        assert isinstance(body["started_at"], float)
        assert body["uptime_seconds"] >= 0

    def test_stats_with_records(self, app_client):
        activity_hub.add("turn", "t1")
        activity_hub.add("turn", "t2")
        activity_hub.add("tool", "tool1")
        resp = app_client.get("/activity/stats")
        body = resp.json()
        assert body["total"] == 3
        assert body["by_category"]["turn"] == 2
        assert body["by_category"]["tool"] == 1


class TestClear:
    def test_clear_empty_returns_zero(self, app_client):
        resp = app_client.delete("/activity")
        assert resp.status_code == 200
        assert resp.json() == {"cleared": 0}

    def test_clear_returns_count_and_empties(self, app_client):
        activity_hub.add("turn", "t1")
        activity_hub.add("tool", "t2")
        resp = app_client.delete("/activity")
        assert resp.status_code == 200
        assert resp.json() == {"cleared": 2}
        # 验证已清空
        stats = app_client.get("/activity/stats").json()
        assert stats["total"] == 0


class TestStream:
    def test_stream_yields_new_records_and_headers(self, app_client):
        """直接调用 route 函数 + FakeRequest，避免 TestClient 阻塞在无限 generator。"""
        import asyncio

        # 注入一条 timestamp 在未来的记录，确保 > last_ts（generator 启动时刻）
        future = ActivityRecord(
            timestamp=time.time() + 1000,
            category="turn",
            event_type="future_event",
            message="from-future",
        )
        activity_hub._buffer.append(future)

        class FakeRequest:
            """第二次 is_disconnected 检查返回 True 以终止 generator。"""

            def __init__(self):
                self._n = 0

            async def is_disconnected(self) -> bool:
                self._n += 1
                return self._n > 1

        async def _run():
            resp = await activity_mod.stream_activity(FakeRequest())
            # 验证 StreamingResponse 的 headers 和 media_type
            assert resp.media_type == "text/event-stream"
            assert resp.headers["Cache-Control"] == "no-cache"
            assert resp.headers["Connection"] == "keep-alive"
            assert resp.headers["X-Accel-Buffering"] == "no"
            chunks = []
            async for chunk in resp.body_iterator:
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(_run())
        # 应该至少有一个 chunk（包含 future_event）
        assert len(chunks) >= 1
        # 合并所有 chunk 并解析
        full = "".join(chunks)
        assert "event: activity" in full
        assert "future_event" in full
        assert "from-future" in full

    def test_stream_no_new_records_disconnects_cleanly(self, app_client):
        """无新记录时，is_disconnected 返回 True 后 generator 正常退出。"""
        import asyncio

        class FakeRequest:
            def __init__(self):
                self._n = 0

            async def is_disconnected(self) -> bool:
                self._n += 1
                return self._n > 1

        async def _run():
            resp = await activity_mod.stream_activity(FakeRequest())
            chunks = []
            async for chunk in resp.body_iterator:
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(_run())
        # 无新记录 → 无 chunk
        assert chunks == []
