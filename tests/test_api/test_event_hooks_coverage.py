"""覆盖 — api/routes/event_hooks.py get_history 函数体（lines 54-55）。

/event-hooks/history 路由被先注册的 /event-hooks/{hook_id} 遮蔽，
HTTP 请求永远不会路由到 get_history，需直接调用函数。
"""

from __future__ import annotations

from api.routes import event_hooks


async def test_get_history_returns_404_omp_message():
    resp = await event_hooks.get_history()
    assert resp.status_code == 404
    body = resp.body.decode("utf-8")
    assert "Event hooks are unavailable" in body
    assert "OMP replaces event hooks" in body
