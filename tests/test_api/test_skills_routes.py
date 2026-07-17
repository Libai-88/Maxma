"""测试 — api/routes/skills.py Skills 目录管理。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import skills as skills_mod
from api.routes.skills import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    skills_dir = tmp_path / "anthropic_skills"
    skills_dir.mkdir()
    monkeypatch.setattr(skills_mod, "SKILLS_DIR", skills_dir)
    app = FastAPI()
    app.include_router(router)
    return {"app": app, "client": TestClient(app), "dir": skills_dir}


class TestListSkills:
    def test_list_skills_missing_dir(self, tmp_path, monkeypatch):
        # 指向不存在的目录
        monkeypatch.setattr(skills_mod, "SKILLS_DIR", tmp_path / "nope")
        app = FastAPI()
        app.include_router(router)
        resp = TestClient(app).get("/skills")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_skills_not_dir(self, tmp_path, monkeypatch):
        # 指向一个文件而非目录
        f = tmp_path / "file"
        f.write_text("x")
        monkeypatch.setattr(skills_mod, "SKILLS_DIR", f)
        app = FastAPI()
        app.include_router(router)
        resp = TestClient(app).get("/skills")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_skills_lists_enabled_and_disabled(self, isolated_env):
        d = isolated_env["dir"]
        (d / "alpha").mkdir()
        (d / "alpha" / "SKILL.md").write_text("alpha content")
        (d / "beta").mkdir()
        (d / "beta" / "SKILL.md.disabled").write_text("beta content")
        (d / "gamma").mkdir()  # 无 SKILL.md 也不应出现
        (d / "readme.txt").write_text("not a dir")  # 非目录应跳过

        resp = isolated_env["client"].get("/skills")
        body = resp.json()
        names = {s["name"]: s["enabled"] for s in body}
        assert names == {"alpha": True, "beta": False}

    def test_list_skills_empty_dir(self, isolated_env):
        resp = isolated_env["client"].get("/skills")
        assert resp.status_code == 200
        assert resp.json() == []


class TestGetSkill:
    def test_get_skill_enabled(self, isolated_env):
        d = isolated_env["dir"]
        (d / "alpha").mkdir()
        (d / "alpha" / "SKILL.md").write_text("# Alpha\n内容", encoding="utf-8")
        resp = isolated_env["client"].get("/skills/alpha")
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "alpha"
        assert body["enabled"] is True
        assert "Alpha" in body["content"]

    def test_get_skill_disabled(self, isolated_env):
        d = isolated_env["dir"]
        (d / "beta").mkdir()
        (d / "beta" / "SKILL.md.disabled").write_text("disabled", encoding="utf-8")
        resp = isolated_env["client"].get("/skills/beta")
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "beta"
        assert body["enabled"] is False
        assert body["content"] == "disabled"

    def test_get_skill_not_found(self, isolated_env):
        resp = isolated_env["client"].get("/skills/ghost")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


class TestToggleSkill:
    def test_toggle_disables_enabled_skill(self, isolated_env):
        d = isolated_env["dir"]
        (d / "alpha").mkdir()
        skill = d / "alpha" / "SKILL.md"
        skill.write_text("x")
        resp = isolated_env["client"].post("/skills/alpha/toggle")
        assert resp.status_code == 200
        assert resp.json() == {"name": "alpha", "enabled": False}
        assert not skill.exists()
        assert (d / "alpha" / "SKILL.md.disabled").exists()

    def test_toggle_enables_disabled_skill(self, isolated_env):
        d = isolated_env["dir"]
        (d / "beta").mkdir()
        disabled = d / "beta" / "SKILL.md.disabled"
        disabled.write_text("x")
        resp = isolated_env["client"].post("/skills/beta/toggle")
        assert resp.status_code == 200
        assert resp.json() == {"name": "beta", "enabled": True}
        assert not disabled.exists()
        assert (d / "beta" / "SKILL.md").exists()

    def test_toggle_not_found(self, isolated_env):
        resp = isolated_env["client"].post("/skills/ghost/toggle")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()
