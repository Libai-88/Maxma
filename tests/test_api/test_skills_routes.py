"""测试 — api/routes/skills.py Skills 目录管理。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import skills as skills_mod
from api.routes.skills import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """隔离的 skills 测试环境。

    builtin_dir 模拟 ANTHROPIC_SKILLS_DIR（只读内置），user_dir 模拟
    SKILLS_DATA_DIR（可写）。通过 monkeypatch 替换 skills_mod 模块级常量，
    避免触碰真实磁盘。
    """
    builtin_dir = tmp_path / "builtin_skills"
    user_dir = tmp_path / "user_skills"
    builtin_dir.mkdir()
    user_dir.mkdir()
    monkeypatch.setattr(skills_mod, "ANTHROPIC_SKILLS_DIR", builtin_dir)
    monkeypatch.setattr(skills_mod, "SKILLS_DATA_DIR", user_dir)
    app = FastAPI()
    app.include_router(router)
    return {
        "app": app,
        "client": TestClient(app),
        "builtin_dir": builtin_dir,
        "user_dir": user_dir,
    }


def _write_skill(base, name: str, content: str, disabled: bool = False) -> None:
    """辅助：在 base 目录下创建 {name}/SKILL.md[.disabled]。"""
    skill_dir = base / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    fname = "SKILL.md.disabled" if disabled else "SKILL.md"
    (skill_dir / fname).write_text(content, encoding="utf-8")


# ───────────────────────── List ─────────────────────────


class TestListSkills:
    def test_list_missing_dirs(self, tmp_path, monkeypatch):
        """两个目录都不存在时返回空列表。"""
        monkeypatch.setattr(skills_mod, "ANTHROPIC_SKILLS_DIR", tmp_path / "no_builtin")
        monkeypatch.setattr(skills_mod, "SKILLS_DATA_DIR", tmp_path / "no_user")
        app = FastAPI()
        app.include_router(router)
        resp = TestClient(app).get("/skills")
        assert resp.status_code == 200
        assert resp.json() == {"skills": []}

    def test_list_builtin_and_user_merged(self, isolated_env):
        _write_skill(isolated_env["builtin_dir"], "alpha", "alpha content")
        _write_skill(isolated_env["user_dir"], "beta", "beta content")
        resp = isolated_env["client"].get("/skills")
        body = resp.json()
        names = {s["id"]: s for s in body["skills"]}
        assert set(names) == {"alpha", "beta"}
        assert names["alpha"]["source"] == "builtin"
        assert names["beta"]["source"] == "user"

    def test_list_user_overrides_builtin(self, isolated_env):
        """builtin 和 user 同名时，user 优先（去重）。"""
        _write_skill(isolated_env["builtin_dir"], "shared", "builtin")
        _write_skill(isolated_env["user_dir"], "shared", "user")
        resp = isolated_env["client"].get("/skills")
        body = resp.json()
        assert len(body["skills"]) == 1
        assert body["skills"][0]["source"] == "user"

    def test_list_enabled_and_disabled(self, isolated_env):
        _write_skill(isolated_env["user_dir"], "alpha", "alpha content")
        _write_skill(isolated_env["user_dir"], "beta", "beta content", disabled=True)
        resp = isolated_env["client"].get("/skills")
        body = resp.json()
        names = {s["name"]: s["enabled"] for s in body["skills"]}
        assert names == {"alpha": True, "beta": False}

    def test_list_empty(self, isolated_env):
        resp = isolated_env["client"].get("/skills")
        assert resp.status_code == 200
        assert resp.json() == {"skills": []}


# ───────────────────────── Get ─────────────────────────


class TestGetSkill:
    def test_get_user_priority(self, isolated_env):
        _write_skill(isolated_env["builtin_dir"], "m", "builtin")
        _write_skill(isolated_env["user_dir"], "m", "user")
        resp = isolated_env["client"].get("/skills/m")
        assert resp.status_code == 200
        assert resp.json()["source"] == "user"

    def test_get_builtin_fallback(self, isolated_env):
        _write_skill(isolated_env["builtin_dir"], "only_b", "# Builtin\nbuiltin content")
        resp = isolated_env["client"].get("/skills/only_b")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "builtin"
        assert body["content"] == "builtin content"

    def test_get_disabled(self, isolated_env):
        _write_skill(isolated_env["user_dir"], "beta", "# Beta\ndisabled content", disabled=True)
        resp = isolated_env["client"].get("/skills/beta")
        assert resp.status_code == 200
        body = resp.json()
        assert body["content"] == "disabled content"

    def test_get_not_found(self, isolated_env):
        resp = isolated_env["client"].get("/skills/ghost")
        assert resp.status_code == 404


# ───────────────────────── Toggle ─────────────────────────


class TestToggleSkill:
    def test_toggle_disables_enabled_skill(self, isolated_env):
        _write_skill(isolated_env["user_dir"], "alpha", "x")
        resp = isolated_env["client"].post("/skills/alpha/toggle")
        assert resp.status_code == 200
        assert resp.json() == {"name": "alpha", "enabled": False}
        assert not (isolated_env["user_dir"] / "alpha" / "SKILL.md").exists()
        assert (isolated_env["user_dir"] / "alpha" / "SKILL.md.disabled").exists()

    def test_toggle_enables_disabled_skill(self, isolated_env):
        _write_skill(isolated_env["user_dir"], "beta", "x", disabled=True)
        resp = isolated_env["client"].post("/skills/beta/toggle")
        assert resp.status_code == 200
        assert resp.json() == {"name": "beta", "enabled": True}
        assert (isolated_env["user_dir"] / "beta" / "SKILL.md").exists()
        assert not (isolated_env["user_dir"] / "beta" / "SKILL.md.disabled").exists()

    def test_toggle_not_found(self, isolated_env):
        resp = isolated_env["client"].post("/skills/ghost/toggle")
        assert resp.status_code == 404


# ───────────────────────── Path Traversal Security ─────────────────────────


class TestSkillPathTraversalSecurity:
    """验证 Skill 名称/ID 校验能阻止路径穿越攻击。"""

    def test_create_rejects_dotdot_name(self, isolated_env):
        """POST /skills name='..' 应 400 拒绝，防止在 user 目录上级创建文件。"""
        resp = isolated_env["client"].post(
            "/skills", json={"name": "..", "content": "evil"}
        )
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_create_rejects_slash_name(self, isolated_env):
        """POST /skills name='a/b' 应 400 拒绝，防止路径穿越。"""
        resp = isolated_env["client"].post(
            "/skills", json={"name": "a/b", "content": "evil"}
        )
        assert resp.status_code == 400

    def test_get_rejects_invalid_id(self, isolated_env):
        """GET /skills/{id} 含非法字符（如点号）应 400 拒绝。

        注：Starlette 在路由前会对 URL 中的 '..' 做归一化，因此 '..' 不会
        到达处理函数。此处改用点号 '.' 验证 _validate_skill_id 防御层生效。
        """
        resp = isolated_env["client"].get("/skills/evil.skill")
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_delete_rejects_invalid_id(self, isolated_env):
        """DELETE /skills/{id} 含非法字符应 400 拒绝，防止 rmtree 越权。"""
        resp = isolated_env["client"].delete("/skills/evil.skill")
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_put_rejects_invalid_id(self, isolated_env):
        """PUT /skills/{id} 含非法字符应 400 拒绝，防止越权写入。"""
        resp = isolated_env["client"].put(
            "/skills/evil.skill", json={"content": "evil"}
        )
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_toggle_rejects_invalid_id(self, isolated_env):
        """POST /skills/{name}/toggle 含非法字符应 400 拒绝。"""
        resp = isolated_env["client"].post("/skills/evil.skill/toggle")
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]
