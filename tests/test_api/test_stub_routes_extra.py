"""测试 — 补充低覆盖路由模块：autonomy / maxma_blocker / memory / kb。

autonomy.py: 6 个 stub 端点返回 404
maxma_blocker.py: BlockerEntry CRUD + 标记文件管理
memory.py: 2 个 stub 端点（list/delete）
kb.py: 7 个 stub 端点返回 503
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import autonomy, kb, maxma_blocker, memory


# ── autonomy.py ──────────────────────────────────────────────


class TestAutonomyStubs:
    EXPECTED_DETAIL = "Autonomous Scout schedules are unavailable — OMP replaces autonomy"

    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(autonomy.router)
        return TestClient(app)

    def test_list_schedules_returns_404(self):
        with self._client() as c:
            resp = c.get("/autonomy/schedules")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_create_schedule_returns_404(self):
        with self._client() as c:
            resp = c.post("/autonomy/schedules")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_get_schedule_returns_404(self):
        with self._client() as c:
            resp = c.get("/autonomy/schedules/s1")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_pause_schedule_returns_404(self):
        with self._client() as c:
            resp = c.post("/autonomy/schedules/s1/pause")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_resume_schedule_returns_404(self):
        with self._client() as c:
            resp = c.post("/autonomy/schedules/s1/resume")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_delete_schedule_returns_404(self):
        with self._client() as c:
            resp = c.delete("/autonomy/schedules/s1")
        assert resp.status_code == 404
        assert resp.json()["detail"] == self.EXPECTED_DETAIL


# ── memory.py ────────────────────────────────────────────────


class TestMemoryRoutes:
    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(memory.router)
        return TestClient(app)

    def test_list_memories_returns_list(self):
        with self._client() as c:
            resp = c.get("/memory")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 3
        assert data[0]["id"] == "1"
        assert "content" in data[0]
        assert "category" in data[0]

    def test_delete_memory_returns_ok(self):
        with self._client() as c:
            resp = c.delete("/memory/m1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "deleted"
        assert body["id"] == "m1"


# ── kb.py ────────────────────────────────────────────────────


class TestKbStubs:
    EXPECTED_DETAIL = "知识库功能不可用（memory/ 包已移除）"

    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(kb.router)
        return TestClient(app)

    def test_list_documents_returns_503(self):
        with self._client() as c:
            resp = c.get("/kb/documents")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_get_document_returns_503(self):
        with self._client() as c:
            resp = c.get("/kb/documents/d1")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_delete_document_returns_503(self):
        with self._client() as c:
            resp = c.delete("/kb/documents/d1")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_upload_document_returns_503(self):
        with self._client() as c:
            resp = c.post("/kb/documents")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_index_text_returns_503(self):
        with self._client() as c:
            resp = c.post("/kb/documents/text")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_import_url_returns_503(self):
        with self._client() as c:
            resp = c.post("/kb/documents/url")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL

    def test_search_kb_returns_503(self):
        with self._client() as c:
            resp = c.post("/kb/search")
        assert resp.status_code == 503
        assert resp.json()["detail"] == self.EXPECTED_DETAIL


# ── maxma_blocker.py ─────────────────────────────────────────


@pytest.fixture
def blocker_yaml(monkeypatch, tmp_path: Path) -> Path:
    """隔离 YAML_PATH 到 tmp_path。"""
    target = tmp_path / "maxma_blocker.yaml"
    monkeypatch.setattr(maxma_blocker, "YAML_PATH", target)
    return target


class TestMaxmaBlockerLoadSave:
    def test_load_returns_empty_when_no_file(self, blocker_yaml: Path):
        assert maxma_blocker._load() == []

    def test_load_returns_entries_from_yaml(self, blocker_yaml: Path):
        blocker_yaml.parent.mkdir(parents=True, exist_ok=True)
        blocker_yaml.write_text(
            "blockers:\n  - path: /tmp\n    description: test\n",
            encoding="utf-8",
        )
        entries = maxma_blocker._load()
        assert len(entries) == 1
        assert entries[0]["path"] == "/tmp"

    def test_load_returns_empty_when_no_blockers_key(self, blocker_yaml: Path):
        blocker_yaml.parent.mkdir(parents=True, exist_ok=True)
        blocker_yaml.write_text("other: data\n", encoding="utf-8")
        assert maxma_blocker._load() == []

    def test_save_creates_file_with_entries(self, blocker_yaml: Path):
        entries = [{"path": "/foo", "description": "bar"}]
        maxma_blocker._save(entries)
        assert blocker_yaml.exists()
        loaded = maxma_blocker._load()
        assert loaded == entries

    def test_save_creates_parent_directory(self, blocker_yaml: Path):
        # blocker_yaml 在 tmp_path 下，parent 应该已存在
        maxma_blocker._save([])
        assert blocker_yaml.exists()


class TestMaxmaBlockerMarker:
    def test_create_marker_creates_file(self, tmp_path: Path):
        maxma_blocker._create_marker(str(tmp_path))
        assert (tmp_path / "MaxmaBlocker").exists()

    def test_create_marker_idempotent(self, tmp_path: Path):
        maxma_blocker._create_marker(str(tmp_path))
        maxma_blocker._create_marker(str(tmp_path))
        # 只有一个文件
        assert len(list(tmp_path.glob("MaxmaBlocker*"))) == 1

    def test_remove_marker_deletes_file(self, tmp_path: Path):
        (tmp_path / "MaxmaBlocker").write_text("", encoding="utf-8")
        maxma_blocker._remove_marker(str(tmp_path))
        assert not (tmp_path / "MaxmaBlocker").exists()

    def test_remove_marker_ignores_extension(self, tmp_path: Path):
        (tmp_path / "MaxmaBlocker.txt").write_text("", encoding="utf-8")
        maxma_blocker._remove_marker(str(tmp_path))
        assert not (tmp_path / "MaxmaBlocker.txt").exists()

    def test_remove_marker_nonexistent_dir_noop(self, tmp_path: Path):
        # 不存在的目录不报错
        maxma_blocker._remove_marker(str(tmp_path / "nonexistent"))
        # 无异常即为通过

    def test_remove_marker_no_marker_noop(self, tmp_path: Path):
        # 目录存在但无标记文件
        maxma_blocker._remove_marker(str(tmp_path))
        # 无异常即为通过


class TestMaxmaBlockerRoutes:
    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(maxma_blocker.router)
        return TestClient(app)

    def test_list_blockers_empty(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.get("/maxma-blocker")
        assert resp.status_code == 200
        assert resp.json() == {"entries": []}

    def test_add_blocker_invalid_path_400(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.post(
                "/maxma-blocker",
                json={"path": "/nonexistent/path/xyz", "description": ""},
            )
        assert resp.status_code == 400
        assert "无效目录路径" in resp.json()["detail"]

    def test_add_blocker_empty_path_400(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.post(
                "/maxma-blocker",
                json={"path": "", "description": ""},
            )
        assert resp.status_code == 400

    def test_add_blocker_success_creates_marker(self, blocker_yaml: Path, tmp_path: Path):
        with self._client() as c:
            resp = c.post(
                "/maxma-blocker",
                json={"path": str(tmp_path), "description": "test blocker"},
            )
        assert resp.status_code == 201
        body = resp.json()
        assert body["path"] == str(tmp_path)
        assert body["description"] == "test blocker"
        # 标记文件应被创建
        assert (tmp_path / "MaxmaBlocker").exists()
        # YAML 应被持久化
        assert blocker_yaml.exists()

    def test_list_after_add_returns_entry(self, blocker_yaml: Path, tmp_path: Path):
        with self._client() as c:
            c.post(
                "/maxma-blocker",
                json={"path": str(tmp_path), "description": "d1"},
            )
            resp = c.get("/maxma-blocker")
        assert resp.status_code == 200
        entries = resp.json()["entries"]
        assert len(entries) == 1
        assert entries[0]["path"] == str(tmp_path)

    def test_delete_blocker_by_index(self, blocker_yaml: Path, tmp_path: Path):
        with self._client() as c:
            c.post(
                "/maxma-blocker",
                json={"path": str(tmp_path), "description": "to delete"},
            )
            resp = c.delete("/maxma-blocker/0")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["removed"]["path"] == str(tmp_path)
        # 标记文件应被删除
        assert not (tmp_path / "MaxmaBlocker").exists()

    def test_delete_blocker_out_of_range_404(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.delete("/maxma-blocker/99")
        assert resp.status_code == 404
        assert "超出范围" in resp.json()["detail"]

    def test_delete_blocker_negative_index_404(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.delete("/maxma-blocker/-1")
        assert resp.status_code == 404
