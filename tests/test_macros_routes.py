"""测试 — api/routes/macros.py Macros 管理端点。

覆盖 5 个端点：GET /macros, GET /macros/{id}, POST /macros,
PUT /macros/{id}, DELETE /macros/{id}。

参考 tests/test_api/test_skills_routes.py 的 monkeypatch + TestClient 模式。
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import macros as macros_mod
from api.routes.macros import router


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """隔离的 macros 测试环境。

    builtin_dir 模拟 MACROS_DIR（只读内置），user_dir 模拟 MACROS_DATA_DIR（可写）。
    通过 monkeypatch 替换 macros_mod 模块级常量，避免触碰真实磁盘。
    """
    builtin_dir = tmp_path / "builtin_macros"
    user_dir = tmp_path / "user_macros"
    builtin_dir.mkdir()
    user_dir.mkdir()
    monkeypatch.setattr(macros_mod, "MACROS_DIR", builtin_dir)
    monkeypatch.setattr(macros_mod, "MACROS_DATA_DIR", user_dir)
    app = FastAPI()
    app.include_router(router)
    return {
        "app": app,
        "client": TestClient(app),
        "builtin_dir": builtin_dir,
        "user_dir": user_dir,
    }


def _write_macro(base: Path, name: str, content: str) -> None:
    """辅助：在 base 目录下创建 {name}/MACRO.md。"""
    macro_dir = base / name
    macro_dir.mkdir(parents=True, exist_ok=True)
    (macro_dir / "MACRO.md").write_text(content, encoding="utf-8")


# ───────────────────────── List ─────────────────────────


class TestListMacros:
    def test_list_empty(self, isolated_env):
        resp = isolated_env["client"].get("/macros")
        assert resp.status_code == 200
        assert resp.json() == {"macros": []}

    def test_list_missing_dirs(self, tmp_path, monkeypatch):
        """两个目录都不存在时返回空列表。"""
        monkeypatch.setattr(macros_mod, "MACROS_DIR", tmp_path / "no_builtin")
        monkeypatch.setattr(macros_mod, "MACROS_DATA_DIR", tmp_path / "no_user")
        app = FastAPI()
        app.include_router(router)
        resp = TestClient(app).get("/macros")
        assert resp.status_code == 200
        assert resp.json() == {"macros": []}

    def test_list_builtin_and_user_merged(self, isolated_env):
        _write_macro(isolated_env["builtin_dir"], "alpha", "# Alpha desc\nalpha body")
        _write_macro(isolated_env["user_dir"], "beta", "# Beta desc\nbeta body")
        resp = isolated_env["client"].get("/macros")
        body = resp.json()
        names = {m["id"]: m for m in body["macros"]}
        assert set(names) == {"alpha", "beta"}
        assert names["alpha"]["source"] == "builtin"
        assert names["beta"]["source"] == "user"
        assert names["alpha"]["description"] == "Alpha desc"
        assert names["alpha"]["name"] == "alpha"
        assert "MACRO.md" in names["alpha"]["path"]

    def test_list_user_overrides_builtin(self, isolated_env):
        """builtin 和 user 同名时，user 优先（去重）。"""
        _write_macro(isolated_env["builtin_dir"], "shared", "# Builtin shared\nb")
        _write_macro(isolated_env["user_dir"], "shared", "# User shared\nu")
        resp = isolated_env["client"].get("/macros")
        body = resp.json()
        assert len(body["macros"]) == 1
        m = body["macros"][0]
        assert m["id"] == "shared"
        assert m["source"] == "user"
        assert m["description"] == "User shared"

    def test_list_skips_non_dirs(self, isolated_env):
        """散落的文件应被跳过。"""
        (isolated_env["user_dir"] / "readme.txt").write_text("not a dir")
        _write_macro(isolated_env["user_dir"], "real", "# Real\nr")
        resp = isolated_env["client"].get("/macros")
        body = resp.json()
        assert {m["id"] for m in body["macros"]} == {"real"}

    def test_list_skips_dir_without_macro_file(self, isolated_env):
        """无 MACRO.md 的子目录应被跳过。"""
        (isolated_env["user_dir"] / "empty").mkdir()
        _write_macro(isolated_env["user_dir"], "real", "# Real\nr")
        resp = isolated_env["client"].get("/macros")
        body = resp.json()
        assert {m["id"] for m in body["macros"]} == {"real"}


# ───────────────────────── Get ─────────────────────────


class TestGetMacro:
    def test_get_user_priority(self, isolated_env):
        _write_macro(isolated_env["builtin_dir"], "m", "# Builtin\nb body")
        _write_macro(isolated_env["user_dir"], "m", "# User\nu body")
        resp = isolated_env["client"].get("/macros/m")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "user"
        assert body["description"] == "User"
        assert body["content"] == "u body"

    def test_get_builtin_fallback(self, isolated_env):
        _write_macro(isolated_env["builtin_dir"], "only_b", "# Builtin\nb body")
        resp = isolated_env["client"].get("/macros/only_b")
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "builtin"
        assert body["description"] == "Builtin"
        assert body["content"] == "b body"

    def test_get_frontmatter_format(self, isolated_env):
        """兼容 TS sidecar 创建的 frontmatter 格式。"""
        fm = '---\nname: "fm"\ndescription: "FM desc"\n---\n\nFM body'
        _write_macro(isolated_env["user_dir"], "fm", fm)
        resp = isolated_env["client"].get("/macros/fm")
        assert resp.status_code == 200
        body = resp.json()
        assert body["description"] == "FM desc"
        assert "FM body" in body["content"]

    def test_get_heading_format(self, isolated_env):
        _write_macro(isolated_env["user_dir"], "h", "# 标题\n正文")
        resp = isolated_env["client"].get("/macros/h")
        assert resp.status_code == 200
        body = resp.json()
        assert body["description"] == "标题"
        assert body["content"] == "正文"

    def test_get_not_found(self, isolated_env):
        resp = isolated_env["client"].get("/macros/ghost")
        assert resp.status_code == 404
        assert "ghost" in resp.json()["detail"]


# ───────────────────────── Create ─────────────────────────


class TestCreateMacro:
    def test_create_success(self, isolated_env):
        resp = isolated_env["client"].post(
            "/macros",
            json={"name": "new", "description": "New macro", "content": "body"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "new"
        assert body["name"] == "new"
        assert body["description"] == "New macro"
        assert body["content"] == "body"
        assert body["source"] == "user"
        # 文件确实写入磁盘
        macro_file = isolated_env["user_dir"] / "new" / "MACRO.md"
        assert macro_file.exists()
        text = macro_file.read_text("utf-8")
        assert "New macro" in text
        assert "body" in text

    def test_create_no_name(self, isolated_env):
        resp = isolated_env["client"].post("/macros", json={"content": "x"})
        assert resp.status_code == 400

    def test_create_empty_name(self, isolated_env):
        resp = isolated_env["client"].post("/macros", json={"name": "  "})
        assert resp.status_code == 400

    def test_create_already_exists_user(self, isolated_env):
        _write_macro(isolated_env["user_dir"], "exists", "# E\ne")
        resp = isolated_env["client"].post(
            "/macros", json={"name": "exists", "content": "x"}
        )
        assert resp.status_code == 409

    def test_create_shadows_builtin(self, isolated_env):
        """builtin 已有同名宏时，允许在 user 目录创建覆盖副本（与 PUT 提升一致）。"""
        _write_macro(isolated_env["builtin_dir"], "b_exists", "# B\nb")
        resp = isolated_env["client"].post(
            "/macros", json={"name": "b_exists", "content": "x"}
        )
        assert resp.status_code == 200
        assert resp.json()["source"] == "user"
        # user 目录有副本，builtin 原文件仍在
        assert (isolated_env["user_dir"] / "b_exists" / "MACRO.md").exists()
        assert (isolated_env["builtin_dir"] / "b_exists" / "MACRO.md").exists()

    def test_create_default_description(self, isolated_env):
        """未提供 description 时用 name 作为默认描述。"""
        resp = isolated_env["client"].post(
            "/macros", json={"name": "nodsc", "content": "c"}
        )
        assert resp.status_code == 200
        assert resp.json()["description"] == "nodsc"


# ───────────────────────── Update ─────────────────────────


class TestUpdateMacro:
    def test_update_user_macro(self, isolated_env):
        _write_macro(isolated_env["user_dir"], "u", "# Old\nold body")
        resp = isolated_env["client"].put(
            "/macros/u",
            json={"description": "New", "content": "new body"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "u"
        assert body["status"] == "ok"
        # 验证磁盘内容更新
        text = (isolated_env["user_dir"] / "u" / "MACRO.md").read_text("utf-8")
        assert "New" in text
        assert "new body" in text

    def test_update_builtin_promotes_to_user(self, isolated_env):
        """更新 builtin 宏时，写入 user 目录（不修改 builtin）。"""
        _write_macro(isolated_env["builtin_dir"], "b", "# Builtin\nb body")
        resp = isolated_env["client"].put(
            "/macros/b",
            json={"description": "Promoted", "content": "promoted body"},
        )
        assert resp.status_code == 200
        # user 目录应有副本
        user_file = isolated_env["user_dir"] / "b" / "MACRO.md"
        assert user_file.exists()
        text = user_file.read_text("utf-8")
        assert "Promoted" in text
        # builtin 原文件不变
        builtin_text = (isolated_env["builtin_dir"] / "b" / "MACRO.md").read_text("utf-8")
        assert "Builtin" in builtin_text

    def test_update_not_found(self, isolated_env):
        resp = isolated_env["client"].put("/macros/ghost", json={"content": "x"})
        assert resp.status_code == 404

    def test_update_partial_keeps_other_fields(self, isolated_env):
        """只更新 description，content 保持原值。"""
        _write_macro(isolated_env["user_dir"], "p", "# OldDesc\nold content")
        resp = isolated_env["client"].put(
            "/macros/p", json={"description": "NewDesc"}
        )
        assert resp.status_code == 200
        # 重新读取验证
        get_resp = isolated_env["client"].get("/macros/p")
        body = get_resp.json()
        assert body["description"] == "NewDesc"
        assert body["content"] == "old content"


# ───────────────────────── Delete ─────────────────────────


class TestDeleteMacro:
    def test_delete_user_macro(self, isolated_env):
        _write_macro(isolated_env["user_dir"], "del", "# Del\nd body")
        resp = isolated_env["client"].delete("/macros/del")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "del"
        assert body["status"] == "ok"
        # 文件已删除
        assert not (isolated_env["user_dir"] / "del" / "MACRO.md").exists()
        assert not (isolated_env["user_dir"] / "del").exists()

    def test_delete_builtin_forbidden(self, isolated_env):
        _write_macro(isolated_env["builtin_dir"], "b_del", "# B\nb")
        resp = isolated_env["client"].delete("/macros/b_del")
        assert resp.status_code == 403
        # builtin 文件仍在
        assert (isolated_env["builtin_dir"] / "b_del" / "MACRO.md").exists()

    def test_delete_not_found(self, isolated_env):
        resp = isolated_env["client"].delete("/macros/ghost")
        assert resp.status_code == 404

    def test_delete_user_after_promote(self, isolated_env):
        """builtin 宏被 PUT 提升到 user 后，DELETE 应删除 user 副本。"""
        _write_macro(isolated_env["builtin_dir"], "bp", "# B\nb")
        # 提升到 user
        isolated_env["client"].put("/macros/bp", json={"content": "u"})
        # 删除 user 副本
        resp = isolated_env["client"].delete("/macros/bp")
        assert resp.status_code == 200
        # builtin 原文件仍在
        assert (isolated_env["builtin_dir"] / "bp" / "MACRO.md").exists()
        assert not (isolated_env["user_dir"] / "bp").exists()


# ───────────────────────── Path Traversal Security ─────────────────────────


class TestMacroPathTraversalSecurity:
    """验证宏名称/ID 校验能阻止路径穿越攻击。"""

    def test_create_rejects_dotdot_name(self, isolated_env):
        """POST /macros name='..' 应 400 拒绝，防止在 user 目录上级创建文件。"""
        resp = isolated_env["client"].post(
            "/macros", json={"name": "..", "content": "evil"}
        )
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_create_rejects_slash_name(self, isolated_env):
        """POST /macros name='a/b' 应 400 拒绝，防止路径穿越。"""
        resp = isolated_env["client"].post(
            "/macros", json={"name": "a/b", "content": "evil"}
        )
        assert resp.status_code == 400

    def test_get_rejects_invalid_id(self, isolated_env):
        """GET /macros/{id} 含非法字符（如点号）应 400 拒绝。

        注：Starlette 在路由前会对 URL 中的 '..' 做归一化，因此 '..' 不会
        到达处理函数。此处改用点号 '.' 验证 _validate_macro_id 防御层生效，
        阻止含路径相关字符的 ID 进入文件系统操作。
        """
        resp = isolated_env["client"].get("/macros/evil.macro")
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_delete_rejects_invalid_id(self, isolated_env):
        """DELETE /macros/{id} 含非法字符应 400 拒绝，防止 rmtree 越权。"""
        resp = isolated_env["client"].delete("/macros/evil.macro")
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]

    def test_put_rejects_invalid_id(self, isolated_env):
        """PUT /macros/{id} 含非法字符应 400 拒绝，防止越权写入。"""
        resp = isolated_env["client"].put(
            "/macros/evil.macro", json={"content": "evil"}
        )
        assert resp.status_code == 400
        assert "字母" in resp.json()["detail"] or "连字符" in resp.json()["detail"]
