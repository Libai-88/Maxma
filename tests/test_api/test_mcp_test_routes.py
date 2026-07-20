"""Tests for api/routes/mcp_test.py — test-connection endpoint with mocked subprocess."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.mcp_test import router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _mock_proc(returncode=None, stderr_data=b"", wait_side_effect=None):
    """Build a fake subprocess proc.

    wait_side_effect: when provided, proc.wait() raises/returns those values per call
    (used to simulate asyncio.wait_for timeouts via the inner coroutine raising).
    """
    proc = MagicMock()
    proc.returncode = returncode
    if wait_side_effect is not None:
        proc.wait = AsyncMock(side_effect=wait_side_effect)
    else:
        proc.wait = AsyncMock(return_value=None)
    proc.stderr = MagicMock()
    proc.stderr.read = AsyncMock(return_value=stderr_data)
    proc.terminate = MagicMock()
    proc.kill = MagicMock()
    return proc


class TestTestConnection:
    def test_command_not_found(self, client):
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            side_effect=FileNotFoundError("no such file"),
        ):
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx"}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "命令不存在" in body["error"]
        assert body["resolved_command"] == "npx"

    def test_startup_failure(self, client):
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            side_effect=OSError("boom"),
        ):
            resp = client.post("/api/mcp/test-connection", json={"command": "npx"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "启动失败" in body["error"]

    def test_success_zero_exit_code(self, client):
        proc = _mock_proc(returncode=0)
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ) as mock_exec:
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx", "args": ["hi"]}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["error"] is None
        assert body["resolved_command"] == "npx"
        mock_exec.assert_called_once()

    def test_non_zero_exit_code(self, client):
        proc = _mock_proc(returncode=2, stderr_data=b"some error")
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ):
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx"}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is False
        assert "进程退出码 2" in body["error"]
        assert "some error" in body["error"]

    def test_non_zero_exit_code_truncates_stderr(self, client):
        long_err = b"x" * 1000
        proc = _mock_proc(returncode=1, stderr_data=long_err)
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ):
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx"}
            )
        assert resp.status_code == 200
        body = resp.json()
        # stderr message stripped and truncated to 500 chars
        assert len(body["error"]) <= 500 + len("进程退出码 1: ")

    def test_timeout_means_success(self, client):
        # First wait() raises TimeoutError -> wait_for propagates -> caught by outer except.
        # Second wait() (after terminate) returns None -> completes.
        proc = _mock_proc(wait_side_effect=[asyncio.TimeoutError(), None])
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ):
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx"}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["error"] is None
        proc.terminate.assert_called_once()
        proc.kill.assert_not_called()

    def test_timeout_then_kill(self, client):
        # Both wait() calls raise TimeoutError -> terminate + kill both invoked.
        proc = _mock_proc(
            wait_side_effect=[asyncio.TimeoutError(), asyncio.TimeoutError()]
        )
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ):
            resp = client.post(
                "/api/mcp/test-connection", json={"command": "npx"}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        proc.terminate.assert_called_once()
        proc.kill.assert_called_once()

    def test_env_merged_with_os_environ(self, client):
        proc = _mock_proc(returncode=0)
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ) as mock_exec:
            resp = client.post(
                "/api/mcp/test-connection",
                json={"command": "npx", "env": {"CUSTOM": "1"}},
            )
        assert resp.status_code == 200
        _, kwargs = mock_exec.call_args
        assert kwargs["env"]["CUSTOM"] == "1"

    def test_args_passed_to_subprocess(self, client):
        proc = _mock_proc(returncode=0)
        with patch(
            "api.routes.mcp_test.asyncio.create_subprocess_exec",
            return_value=proc,
        ) as mock_exec:
            resp = client.post(
                "/api/mcp/test-connection",
                json={"command": "npx", "args": ["a", "b"]},
            )
        assert resp.status_code == 200
        args, _ = mock_exec.call_args
        # first positional arg is resolved command, then *args
        assert args[0] == "npx"
        assert args[1:] == ("a", "b")
