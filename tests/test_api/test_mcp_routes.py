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

    def test_list_and_get_redact_nested_sensitive_values(self, app_client):
        secret = "mcp-list-get-secret"
        mcp_mod._save_raw([
            {
                "server_id": "secure",
                "transport": "sse",
                "url": "https://example.test",
                "env": {
                    "API_KEY": secret,
                    "nested": {"Token": secret},
                },
                "headers": {
                    "Authorization": secret,
                    "nested": {"api-key": secret},
                },
            },
        ])

        list_resp = app_client.get("/mcp/servers")
        assert list_resp.status_code == 200
        assert secret not in list_resp.text
        listed = list_resp.json()["servers"][0]
        assert listed["env"]["API_KEY"] == "[REDACTED]"
        assert listed["env"]["nested"]["Token"] == "[REDACTED]"
        assert listed["headers"]["Authorization"] == "[REDACTED]"
        assert listed["headers"]["nested"]["api-key"] == "[REDACTED]"

        get_resp = app_client.get("/mcp/servers/secure")
        assert get_resp.status_code == 200
        assert secret not in get_resp.text
        assert get_resp.json()["headers"]["Authorization"] == "[REDACTED]"
        assert mcp_mod._load_raw()[0]["env"]["API_KEY"] == secret


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
        assert resp.json() == {
            "server_id": "s1",
            "tools": [],
            "note": "工具由 OMP sidecar 动态管理，请在对话中让 AI 列出或调用它们",
        }


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
            "env": {"K": "[REDACTED]"},
            "cwd": "/tmp",
        }
        assert body["tool_count"] == 0
        assert mcp_mod._load_raw()[0]["env"] == {"K": "V"}

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
        assert srv["headers"] == {"h": "[REDACTED]"}
        assert srv["timeout"] == 10.0
        assert srv["sse_read_timeout"] == 5.0
        assert mcp_mod._load_raw()[0]["headers"] == {"h": "v"}

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

    def test_update_redacts_sensitive_values_and_preserves_unset_secret(self, app_client):
        secret = "mcp-update-secret"
        create_resp = app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s1",
                "transport": "stdio",
                "command": "echo",
                "env": {"TOKEN": secret},
            },
        )
        assert secret not in create_resp.text

        resp = app_client.put("/mcp/servers/s1", json={"enabled": False})
        assert resp.status_code == 200
        assert secret not in resp.text
        assert resp.json()["server"]["env"]["TOKEN"] == "[REDACTED]"
        assert mcp_mod._load_raw()[0]["env"]["TOKEN"] == secret

    def test_update_redacted_placeholder_preserves_existing_secret(self, app_client):
        secret = "mcp-existing-secret"
        app_client.post(
            "/mcp/servers",
            json={
                "server_id": "s1",
                "transport": "stdio",
                "command": "echo",
                "env": {"TOKEN": secret},
            },
        )

        resp = app_client.put(
            "/mcp/servers/s1",
            json={"env": {"TOKEN": "[REDACTED]"}},
        )
        assert resp.status_code == 200
        assert resp.json()["server"]["env"]["TOKEN"] == "[REDACTED]"
        assert secret not in resp.text
        assert mcp_mod._load_raw()[0]["env"]["TOKEN"] == secret

    def test_update_redacted_nested_mapping_merges_existing_values(self, app_client):
        secret = "mcp-nested-secret"
        mcp_mod._save_raw([
            {
                "server_id": "s1",
                "transport": "stdio",
                "command": "echo",
                "env": {
                    "TOKEN": secret,
                    "nested": {"API_KEY": secret, "KEEP": "old"},
                },
            },
        ])

        resp = app_client.put(
            "/mcp/servers/s1",
            json={
                "env": {
                    "TOKEN": "[REDACTED]",
                    "nested": {"API_KEY": "[REDACTED]", "NEW": "new"},
                },
            },
        )
        assert resp.status_code == 200
        stored = mcp_mod._load_raw()[0]
        assert stored["env"]["TOKEN"] == secret
        assert stored["env"]["nested"] == {
            "API_KEY": secret,
            "KEEP": "old",
            "NEW": "new",
        }


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

    def test_reload_requires_session_rebuild(self, app_client):
        resp = app_client.post("/mcp/reload")
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "mcp_reload_unsupported"
        assert "重建会话" in resp.json()["detail"]["message"]

    def test_reload_does_not_expose_sensitive_values(self, app_client):
        secret = "mcp-reload-secret"
        mcp_mod._save_raw([
            {
                "server_id": "secure",
                "transport": "stdio",
                "command": "echo",
                "env": {"TOKEN": secret},
                "headers": {"Authorization": secret},
            },
        ])

        resp = app_client.post("/mcp/reload")
        assert resp.status_code == 409
        assert secret not in resp.text


def test_build_omp_mcp_servers_normalizes_only_sdk_fields():
    entries = [
        {
            "server_id": "stdio-server",
            "transport": "stdio",
            "enabled": True,
            "command": "node",
            "args": ["server.js"],
            "env": {"TOKEN": "secret", "MODE": "test"},
            "cwd": "/tmp/mcp",
            "allow": ["read"],
            "block": ["write"],
        },
        {
            "server_id": "sse-server",
            "transport": "sse",
            "url": "https://example.test/sse",
            "headers": {"Authorization": "secret", "X-Test": "yes"},
            "timeout": 12,
            "sse_read_timeout": 4,
        },
        {
            "server_id": "http-server",
            "transport": "streamable_http",
            "url": "https://example.test/mcp",
            "headers": {"X-Test": "yes"},
            "tls_verify": False,
        },
        {
            "server_id": "websocket-server",
            "transport": "websocket",
            "url": "wss://example.test/mcp",
        },
    ]

    result = mcp_mod.build_omp_mcp_servers(entries)

    assert result["mcpServers"]["stdio-server"] == {
        "type": "stdio",
        "command": "node",
        "args": ["server.js"],
        "env": {"TOKEN": "secret", "MODE": "test"},
        "cwd": "/tmp/mcp",
        "enabled": True,
    }
    assert result["allowBlock"]["stdio-server"] == {
        "allow": ["read"],
        "block": ["write"],
    }
    assert result["mcpServers"]["sse-server"]["type"] == "sse"
    assert result["mcpServers"]["sse-server"]["headers"]["Authorization"] == "secret"
    assert result["mcpServers"]["http-server"]["type"] == "http"
    assert "tls_verify" not in result["mcpServers"]["http-server"]
    assert "websocket-server" not in result["mcpServers"]
    assert result["unsupported"] == {
        "websocket-server": "OMP SDK does not support websocket MCP transport",
        "http-server": "OMP SDK does not expose tls_verify for MCP transports",
        "sse-server": "OMP SDK does not expose sse_read_timeout",
    }


def test_build_omp_mcp_servers_omits_disabled_servers():
    result = mcp_mod.build_omp_mcp_servers([
        {"server_id": "disabled", "transport": "stdio", "enabled": False, "command": "echo"},
    ])
    assert result == {"mcpServers": {}, "allowBlock": {}, "unsupported": {}}


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
