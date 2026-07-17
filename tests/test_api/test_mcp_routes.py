"""Tests for api/routes/mcp.py — MCP server config CRUD + reload endpoints."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import mcp as mcp_mod
from api.routes.mcp import router


@pytest.fixture
def app_client(monkeypatch, tmp_path):
    yaml_path = tmp_path / "mcp_servers.yaml"
    monkeypatch.setattr(mcp_mod, "MCP_YAML_PATH", yaml_path)
    app = FastAPI()
    app.state.mcp_tools = []
    app.include_router(router)
    return TestClient(app)


class TestListAndGetServers:
    def test_list_empty(self, app_client):
        resp = app_client.get("/mcp/servers")
        assert resp.status_code == 200
        assert resp.json() == {"servers": [], "tool_count": 0}

    def test_list_counts_mcp_tools(self, app_client):
        app_client.app.state.mcp_tools = ["t1", "t2"]
        resp = app_client.get("/mcp/servers")
        assert resp.json()["tool_count"] == 2

    def test_get_server_not_found(self, app_client):
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404

    def test_get_server_found(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        resp = app_client.get("/mcp/servers/s1")
        assert resp.status_code == 200
        assert resp.json()["server_id"] == "s1"


class TestListServerTools:
    def test_server_not_found(self, app_client):
        resp = app_client.get("/mcp/servers/ghost/tools")
        assert resp.status_code == 404

    def test_returns_empty_tools(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        resp = app_client.get("/mcp/servers/s1/tools")
        assert resp.status_code == 200
        assert resp.json() == {"server_id": "s1", "tools": []}


class TestCreateServer:
    def test_create_stdio_success(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s1",
                "transport": "stdio",
                "command": "echo",
                "args": ["hi"],
                "env": {"K": "V"},
                "cwd": "/tmp",
                "allowed_tools": ["t1"],
                "blocked_tools": ["t2"],
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "created"
        assert body["server"] == {
            "server_id": "s1",
            "transport": "stdio",
            "enabled": True,
            "description": "",
            "allowed_tools": ["t1"],
            "blocked_tools": ["t2"],
            "command": "echo",
            "args": ["hi"],
            "env": {"K": "V"},
            "cwd": "/tmp",
        }
        assert body["tool_count"] == 0

    def test_create_stdio_missing_command_400(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio"},
        )
        assert resp.status_code == 400
        assert "command" in resp.json()["detail"]

    def test_create_sse_success(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s2",
                "transport": "sse",
                "url": "http://x",
                "headers": {"h": "v"},
                "timeout": 10.0,
                "sse_read_timeout": 5.0,
            },
        )
        assert resp.status_code == 200
        srv = resp.json()["server"]
        assert srv["url"] == "http://x"
        assert srv["tls_verify"] is True
        assert srv["headers"] == {"h": "v"}
        assert srv["timeout"] == 10.0
        assert srv["sse_read_timeout"] == 5.0

    def test_create_streamable_http_success(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s3",
                "transport": "streamable_http",
                "url": "http://x",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["server"]["tls_verify"] is True

    def test_create_websocket_missing_url_400(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={"server_id": "s4", "transport": "websocket"},
        )
        assert resp.status_code == 400

    def test_create_unsupported_transport_400(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={"server_id": "s5", "transport": "ftp"},
        )
        assert resp.status_code == 400
        assert "ftp" in resp.json()["detail"]

    def test_create_duplicate_409(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        resp = app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        assert resp.status_code == 409

    def test_create_tls_verify_false(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s6",
                "transport": "sse",
                "url": "http://x",
                "tls_verify": False,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["server"]["tls_verify"] is False

    def test_create_disabled_flag(self, app_client):
        resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s7",
                "transport": "stdio",
                "command": "echo",
                "enabled": False,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["server"]["enabled"] is False


class TestUpdateServer:
    def test_update_not_found(self, app_client):
        resp = app_client.put("/mcp/servers/ghost", json={"enabled": False})
        assert resp.status_code == 404

    def test_update_partial_fields(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        resp = app_client.put(
            "/mcp/servers/s1",
            json={"enabled": False, "description": "updated", "command": "cat"},
        )
        assert resp.status_code == 200
        srv = resp.json()["server"]
        assert srv["enabled"] is False
        assert srv["description"] == "updated"
        assert srv["command"] == "cat"
        assert srv["transport"] == "stdio"  # unchanged
        assert resp.json()["status"] == "updated"

    def test_update_unset_fields_ignored(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        # Only enabled provided; other fields keep their values
        resp = app_client.put("/mcp/servers/s1", json={"enabled": False})
        srv = resp.json()["server"]
        assert srv["command"] == "echo"


class TestDeleteServer:
    def test_delete_not_found(self, app_client):
        resp = app_client.delete("/mcp/servers/ghost")
        assert resp.status_code == 404

    def test_delete_success(self, app_client):
        app_client.post(
            "/mcp/servers",
            json={"server_id": "s1", "transport": "stdio", "command": "echo"},
        )
        resp = app_client.delete("/mcp/servers/s1")
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"
        assert resp.json()["removed"] == "s1"
        # confirm gone
        assert app_client.get("/mcp/servers/s1").status_code == 404


class TestDiscoveredAndReload:
    def test_discovered_returns_list(self, app_client):
        resp = app_client.get("/mcp/discovered")
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.json()]
        assert "amap" in ids
        assert "filesystem" in ids

    def test_reload_returns_ok(self, app_client):
        resp = app_client.post("/mcp/reload")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["tool_count"] == 0


class TestLoadRawCorrupted:
    def test_load_raw_non_dict_yaml_returns_empty(self, app_client, tmp_path):
        # write a YAML that is a list (non-dict) -> _load_raw returns []
        (tmp_path / "mcp_servers.yaml").write_text("- item\n", encoding="utf-8")
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404  # no servers loaded

    def test_load_raw_missing_file_returns_empty(self, app_client, tmp_path):
        # delete the yaml file
        (tmp_path / "mcp_servers.yaml").unlink(missing_ok=True)
        resp = app_client.get("/mcp/servers/ghost")
        assert resp.status_code == 404
