"""测试 — 补充低覆盖路由模块：autonomy / maxma_blocker / memory / kb。

autonomy.py: 6 个 stub 端点返回 404
maxma_blocker.py: BlockerEntry CRUD + 标记文件管理
memory.py: 持久化 /memory 端点与 /memories* 兼容端点
kb.py: 7 个 stub 端点返回 503
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
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
    def _client(self, memory_path: Path | None = None) -> TestClient:
        app = FastAPI()
        if memory_path is not None:
            app.state.memory_path = memory_path
        app.include_router(memory.router)
        return TestClient(app)

    def test_list_memories_reads_persisted_long_term_facts(self, tmp_path: Path):
        memory_path = tmp_path / "memory.yaml"
        memory_path.write_text(
            yaml.safe_dump(
                {
                    "fact-1": {
                        "description": "用户主要使用 Python 和 TypeScript",
                        "theme": "preference",
                        "latest_update_time": "2026-07-10 12:30:00",
                        "expires_at": None,
                    },
                    "expired": {
                        "description": "过期事实",
                        "theme": "other",
                        "latest_update_time": "2026-07-01 12:30:00",
                        "expires_at": "2026-07-02 12:30:00",
                    },
                    "_maxma_ltm_projection_operations": {"op-1": {"action": "delete"}},
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        with self._client(memory_path) as c:
            resp = c.get("/memory")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data == [
            {
                "id": "fact-1",
                "content": "用户主要使用 Python 和 TypeScript",
                "category": "preference",
                "confidence": 1.0,
                "updatedAt": "2026-07-10 12:30:00",
            }
        ]

    def test_list_memories_returns_empty_when_persistence_is_missing(self, tmp_path: Path):
        with self._client(tmp_path / "missing.yaml") as c:
            resp = c.get("/memory")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_delete_memory_removes_persisted_fact(self, tmp_path: Path):
        memory_path = tmp_path / "memory.yaml"
        memory_path.write_text(
            yaml.safe_dump(
                {
                    "fact-1": {
                        "description": "用户主要使用 Python",
                        "theme": "skill",
                        "latest_update_time": "2026-07-10 12:30:00",
                    },
                    "_maxma_ltm_projection_operations": {"op-1": {"action": "delete"}},
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        with self._client(memory_path) as c:
            resp = c.delete("/memory/fact-1")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "deleted"
        assert body["id"] == "fact-1"

        persisted = yaml.safe_load(memory_path.read_text(encoding="utf-8"))
        assert "fact-1" not in persisted
        assert "_maxma_ltm_projection_operations" in persisted

        with self._client(memory_path) as c:
            assert c.get("/memory").json() == []

    def test_delete_memory_returns_not_found_for_unknown_fact(self, tmp_path: Path):
        memory_path = tmp_path / "memory.yaml"
        memory_path.write_text("{}\n", encoding="utf-8")

        with self._client(memory_path) as c:
            resp = c.delete("/memory/missing")
        assert resp.status_code == 404

    def test_delete_memory_returns_503_when_store_unreadable(self, tmp_path: Path):
        """Corrupt YAML must surface as 503, not 500."""
        memory_path = tmp_path / "memory.yaml"
        memory_path.write_text("not: [valid: yaml: {{{{", encoding="utf-8")

        with self._client(memory_path) as c:
            resp = c.delete("/memory/whatever")
        assert resp.status_code == 503


class TestMemoryStubs:
    """The 13 /memories* + /narrative + /moment stubs must return 503.

    These back compatibility routes whose memory/ implementation was removed;
    OMP owns recall/reflect/retain now. Tests lock in the 503 contract so
    accidental re-wiring is caught.
    """

    _DETAIL = "记忆功能不可用（memory/ 包已移除）"
    _EPISODIC = "情景记忆功能不可用（memory/ 包已移除）"
    _SEMANTIC = "语义记忆功能不可用（memory/ 包已移除）"

    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(memory.router)
        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path", "detail"),
        [
            ("GET", "/narrative", _DETAIL),
            ("GET", "/memories", _DETAIL),
            ("GET", "/memories/expired", _DETAIL),
            ("PUT", "/memories/m1", _DETAIL),
            ("POST", "/memories/purge", _DETAIL),
            ("GET", "/moment", _DETAIL),
            ("GET", "/memories/episodic", _EPISODIC),
            ("POST", "/memories/episodic", _EPISODIC),
            ("DELETE", "/memories/episodic/ep1", _EPISODIC),
            ("GET", "/memories/semantic", _SEMANTIC),
            ("POST", "/memories/semantic", _SEMANTIC),
            ("DELETE", "/memories/semantic/f1", _SEMANTIC),
            ("POST", "/memories/search", _DETAIL),
        ],
    )
    def test_stub_returns_503(self, method, path, detail):
        with self._client() as c:
            if method == "GET":
                resp = c.get(path)
            elif method == "POST":
                resp = c.post(path)
            elif method == "PUT":
                resp = c.put(path)
            else:
                resp = c.delete(path)
        assert resp.status_code == 503
        assert resp.json()["detail"] == detail


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
        assert (tmp_path / ".maxma_blocker").exists()

    def test_create_marker_idempotent(self, tmp_path: Path):
        maxma_blocker._create_marker(str(tmp_path))
        maxma_blocker._create_marker(str(tmp_path))
        # 只有一个文件
        assert len(list(tmp_path.glob(".maxma_blocker*"))) == 1

    def test_remove_marker_deletes_current_and_legacy_files(self, tmp_path: Path):
        (tmp_path / ".maxma_blocker").write_text("", encoding="utf-8")
        (tmp_path / "MaxmaBlocker").write_text("", encoding="utf-8")
        maxma_blocker._remove_marker(str(tmp_path))
        assert not (tmp_path / ".maxma_blocker").exists()
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
        assert (tmp_path / ".maxma_blocker").exists()
        assert not (tmp_path / "MaxmaBlocker").exists()
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
        assert not (tmp_path / ".maxma_blocker").exists()

    def test_delete_blocker_out_of_range_404(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.delete("/maxma-blocker/99")
        assert resp.status_code == 404
        assert "超出范围" in resp.json()["detail"]

    def test_delete_blocker_negative_index_404(self, blocker_yaml: Path):
        with self._client() as c:
            resp = c.delete("/maxma-blocker/-1")
        assert resp.status_code == 404
