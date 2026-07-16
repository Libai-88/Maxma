"""Integration tests for GET /check-path-blocked endpoint — was a stub returning always False."""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.path_whitelist import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


class TestCheckPathBlocked:
    def test_clean_path_not_blocked(self, tmp_path):
        """Path with no blocker and in whitelist should not be blocked."""
        target = tmp_path / "clean"
        target.mkdir()
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is False

    def test_blocker_path_blocked(self, tmp_path):
        """Path with .maxma_blocker should be blocked."""
        target = tmp_path / "blocked"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is True
        assert data["reason"] is not None

    def test_non_whitelisted_path_blocked(self, tmp_path):
        """Path not in whitelist should be blocked."""
        allowed = tmp_path / "allowed"
        other = tmp_path / "other"
        allowed.mkdir()
        other.mkdir()
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(allowed), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(other)})
        assert response.status_code == 200
        data = response.json()
        assert data["blocked"] is True

    def test_blocker_path_returned_when_blocker_present(self, tmp_path):
        """blocker_path should contain the blocker directory."""
        target = tmp_path / "blocked_dir"
        target.mkdir()
        (target / ".maxma_blocker").write_text("", encoding="utf-8")
        with patch(
            "api.pi_bridge.security_adapter._load_whitelist",
            return_value=[(str(target), True)],
        ):
            response = client.get("/check-path-blocked", params={"path": str(target)})
        data = response.json()
        assert data["blocked"] is True
        assert data["blocker_path"] is not None
