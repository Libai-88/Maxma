"""测试 — api/routes/path_whitelist.py 路径白名单 CRUD。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import path_whitelist as pw_mod
from api.routes.path_whitelist import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    wl_path = tmp_path / "path_whitelist.yaml"
    monkeypatch.setattr(pw_mod, "WHITELIST_PATH", wl_path)
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "path": wl_path}


class TestLoad:
    def test_load_missing_file_returns_empty(self, isolated_env):
        assert pw_mod._load() == []

    def test_load_with_entries(self, isolated_env):
        import yaml

        isolated_env["path"].write_text(
            yaml.dump({"whitelist": [
                {"path": "/a", "description": "A", "recursive": True},
                {"path": "/b"},  # missing recursive → default True
            ]}),
            encoding="utf-8",
        )
        entries = pw_mod._load()
        assert len(entries) == 2
        assert entries[0]["path"] == "/a"
        assert entries[1]["recursive"] is True  # defaulted


class TestListWhitelist:
    def test_empty(self, isolated_env):
        resp = isolated_env["client"].get("/path-whitelist")
        assert resp.status_code == 200
        assert resp.json() == {"entries": []}

    def test_with_entries(self, isolated_env):
        pw_mod._save([
            {"path": "/a", "description": "A", "recursive": True},
        ])
        resp = isolated_env["client"].get("/path-whitelist")
        body = resp.json()
        assert len(body["entries"]) == 1
        assert body["entries"][0]["path"] == "/a"


class TestAddWhitelist:
    def test_add_success(self, isolated_env):
        resp = isolated_env["client"].post(
            "/path-whitelist",
            json={"path": "/home/user", "description": "Home", "recursive": True},
        )
        assert resp.status_code == 200
        body = resp.json()
        # path 被 normpath
        assert body["path"] == "\\home\\user" or body["path"] == "/home/user"
        assert body["description"] == "Home"

    def test_add_default_recursive(self, isolated_env):
        resp = isolated_env["client"].post(
            "/path-whitelist",
            json={"path": "/data"},
        )
        assert resp.status_code == 200
        assert resp.json()["recursive"] is True


class TestUpdateWhitelist:
    def test_update_success(self, isolated_env):
        pw_mod._save([{"path": "/old", "recursive": True}])
        resp = isolated_env["client"].put(
            "/path-whitelist/0",
            json={"path": "/new", "description": "Updated"},
        )
        assert resp.status_code == 200
        assert "new" in resp.json()["path"]

    def test_update_index_out_of_range_404(self, isolated_env):
        resp = isolated_env["client"].put(
            "/path-whitelist/99",
            json={"path": "/x"},
        )
        assert resp.status_code == 404
        assert "超出范围" in resp.json()["detail"]

    def test_update_negative_index_404(self, isolated_env):
        resp = isolated_env["client"].put(
            "/path-whitelist/-1",
            json={"path": "/x"},
        )
        assert resp.status_code == 404


class TestDeleteWhitelist:
    def test_delete_success(self, isolated_env):
        pw_mod._save([
            {"path": "/a", "recursive": True},
            {"path": "/b", "recursive": True},
        ])
        resp = isolated_env["client"].delete("/path-whitelist/0")
        assert resp.status_code == 200
        assert resp.json()["removed"]["path"] == "/a"
        # 验证只剩一个
        remaining = pw_mod._load()
        assert len(remaining) == 1

    def test_delete_out_of_range_404(self, isolated_env):
        resp = isolated_env["client"].delete("/path-whitelist/5")
        assert resp.status_code == 404


class TestCheckPathBlocked:
    def test_check_path_not_blocked(self, isolated_env, monkeypatch):
        # mock check_path_access 返回 None（未被白名单阻挡）
        monkeypatch.setattr(
            "api.pi_bridge.security_adapter.check_path_access",
            lambda p: None,
        )
        monkeypatch.setattr(
            "api.pi_bridge.security_adapter._find_blocker_path",
            lambda p: None,
        )
        resp = isolated_env["client"].get(
            "/check-path-blocked", params={"path": "/safe"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["blocked"] is False

    def test_check_path_blocked_by_whitelist(self, isolated_env, monkeypatch):
        monkeypatch.setattr(
            "api.pi_bridge.security_adapter.check_path_access",
            lambda p: "路径不在白名单中",
        )
        resp = isolated_env["client"].get(
            "/check-path-blocked", params={"path": "/evil"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["blocked"] is True
        assert "白名单" in body["reason"]
        assert body["blocker_path"] is None

    def test_check_path_blocked_by_blocker(self, isolated_env, monkeypatch):
        monkeypatch.setattr(
            "api.pi_bridge.security_adapter.check_path_access",
            lambda p: None,
        )
        monkeypatch.setattr(
            "api.pi_bridge.security_adapter._find_blocker_path",
            lambda p: "/blocked/dir",
        )
        resp = isolated_env["client"].get(
            "/check-path-blocked", params={"path": "/blocked/dir/secret"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["blocked"] is True
        assert "MaxmaBlocker" in body["reason"]
        assert body["blocker_path"] == "/blocked/dir"
