"""Tests for api/routes/tools.py — GET /tools."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.tools import _BUILTIN_TOOLS, _CUSTOM_TOOLS, router


def test_list_tools_returns_builtin_plus_custom():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/tools")
    assert resp.status_code == 200
    tools = resp.json()
    assert isinstance(tools, list)
    assert len(tools) == len(_BUILTIN_TOOLS) + len(_CUSTOM_TOOLS)
    # builtin 工具在前
    names = [t["name"] for t in tools]
    assert names[: len(_BUILTIN_TOOLS)] == [t["name"] for t in _BUILTIN_TOOLS]
    assert names[len(_BUILTIN_TOOLS):] == [t["name"] for t in _CUSTOM_TOOLS]


def test_list_tools_schema_fields():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    for tool in client.get("/tools").json():
        assert {"name", "label", "description", "category", "builtin"} <= set(tool.keys())
        assert isinstance(tool["builtin"], bool)


def test_list_tools_has_known_categories():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    cats = {t["category"] for t in client.get("/tools").json()}
    # 已知核心类别
    assert {"file", "code", "web", "memory", "config"} <= cats
