"""测试 — api/routes/diagnostics.py 诊断与错误日志路由。"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import diagnostics as diag_mod
from api.diagnostics import error_collector
from api.routes import diagnostics as routes_diag
from api.routes.diagnostics import router


@pytest.fixture(autouse=True)
def reset_collector():
    error_collector.clear()
    yield
    error_collector.clear()


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    # 路由模块与 collector 模块都引用 LOGS_DIR，需同步 patch
    monkeypatch.setattr(routes_diag, "LOGS_DIR", logs_dir)
    monkeypatch.setattr(diag_mod, "LOGS_DIR", logs_dir)
    app = FastAPI()
    app.include_router(router)
    return {"client": TestClient(app), "logs_dir": logs_dir}


class TestErrorLogRoutes:
    def test_export_error_log_json(self, isolated_env):
        error_collector.add_error("ERROR", "agent", "route err")
        resp = isolated_env["client"].get("/diagnostics/error-log")
        assert resp.status_code == 200
        body = resp.json()
        assert "errors" in body
        assert "system_info" in body
        assert "stats" in body
        messages = [e["message"] for e in body["errors"]]
        assert "route err" in messages

    def test_export_error_log_text(self, isolated_env):
        error_collector.add_error("ERROR", "agent", "text route err")
        resp = isolated_env["client"].get("/diagnostics/error-log/text")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/plain")
        assert "attachment" in resp.headers["content-disposition"]
        assert "maxma-error-report.txt" in resp.headers["content-disposition"]
        assert "text route err" in resp.text
        assert "MaxmaHere 错误报告" in resp.text

    def test_clear_error_log(self, isolated_env):
        error_collector.add_error("ERROR", "agent", "to clear")
        resp = isolated_env["client"].delete("/diagnostics/error-log")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["deleted"] == 1
        assert error_collector.get_all() == []

    def test_clear_error_log_empty(self, isolated_env):
        resp = isolated_env["client"].delete("/diagnostics/error-log")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 0


class TestLogsRoutes:
    def test_list_log_files(self, isolated_env):
        d = isolated_env["logs_dir"]
        (d / "maxma.log").write_bytes(b"a" * 1024)
        (d / "tauri.log").write_bytes(b"b" * 2048)
        (d / "ignore.txt").write_bytes(b"c")
        resp = isolated_env["client"].get("/diagnostics/logs")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["count"] == 2
        assert body["total_bytes"] == 1024 + 2048
        # total_mb 是数值
        assert isinstance(body["total_mb"], float)
        names = {f["name"] for f in body["files"]}
        assert "maxma.log" in names
        assert "tauri.log" in names
        assert "ignore.txt" not in names

    def test_list_log_files_empty_dir(self, isolated_env):
        resp = isolated_env["client"].get("/diagnostics/logs")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 0
        assert body["total_bytes"] == 0

    def test_cleanup_removes_rotation_files(self, isolated_env):
        d = isolated_env["logs_dir"]
        active_maxma = d / "maxma.log"
        active_tauri = d / "tauri.log"
        rot1 = d / "maxma.log.1"
        rot2 = d / "maxma.log.2"
        rot3 = d / "tauri.log.1"
        old = d / "app.log.old"
        other = d / "random.log"  # 不匹配轮转规则，应保留
        for p in (active_maxma, active_tauri, rot1, rot2, rot3, old, other):
            p.write_bytes(b"x" * 10)

        resp = isolated_env["client"].delete("/diagnostics/logs")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        # 删除了 rot1, rot2, rot3, old（4 个）
        assert body["deleted_count"] == 4
        assert body["freed_bytes"] == 40
        deleted_names = {f["name"] for f in body["deleted_files"]}
        assert deleted_names == {"maxma.log.1", "maxma.log.2", "tauri.log.1", "app.log.old"}
        # 活跃日志保留
        assert active_maxma.exists()
        assert active_tauri.exists()
        # 不匹配的 random.log 保留
        assert other.exists()

    def test_cleanup_missing_logs_dir(self, tmp_path, monkeypatch):
        # 指向不存在的目录
        missing = tmp_path / "nope"
        monkeypatch.setattr(routes_diag, "LOGS_DIR", missing)
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        resp = client.delete("/diagnostics/logs")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["deleted_count"] == 0
        assert "日志目录不存在" in body["message"]

    def test_cleanup_keeps_only_active(self, isolated_env):
        """确保 maxma.log / tauri.log（大小写敏感性 + 精确名）保留。"""
        d = isolated_env["logs_dir"]
        (d / "maxma.log").write_bytes(b"active")
        (d / "maxma.log.5").write_bytes(b"rot")
        resp = isolated_env["client"].delete("/diagnostics/logs")
        assert resp.status_code == 200
        assert (d / "maxma.log").exists()
        assert not (d / "maxma.log.5").exists()
