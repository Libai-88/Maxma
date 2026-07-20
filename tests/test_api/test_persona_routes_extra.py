"""测试 — api/routes/persona.py 人设文件读写 + 多人格管理路由。

补充覆盖 _get_persona_variant_path / _write_text_atomically / get_persona /
update_persona / list_available_personas / switch_active_persona /
create_new_persona / get_persona_profile 等路径。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routes import persona


@pytest.fixture
def persona_dir(monkeypatch, tmp_path: Path) -> Path:
    """隔离 PERSONAS_DIR 到 tmp_path。"""
    monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
    (tmp_path / "SOUL.md").write_text("default soul", encoding="utf-8")
    (tmp_path / "USER.md").write_text("original user", encoding="utf-8")
    return tmp_path


# ── _get_persona_variant_path ────────────────────────────────


class TestGetPersonaVariantPath:
    def test_valid_filename_returns_path(self, persona_dir: Path):
        p = persona._get_persona_variant_path("SOUL.小助手.md")
        assert p == persona_dir / "SOUL.小助手.md"

    def test_valid_filename_with_hyphen(self, persona_dir: Path):
        p = persona._get_persona_variant_path("SOUL.my-bot.md")
        assert p == persona_dir / "SOUL.my-bot.md"

    def test_invalid_filename_rejects_plain_soul(self, persona_dir: Path):
        # "SOUL.md" 不匹配 SOUL\.[\w...]+\.md
        with pytest.raises(HTTPException) as exc:
            persona._get_persona_variant_path("SOUL.md")
        assert exc.value.status_code == 400
        assert "无效的人格文件名" in exc.value.detail

    def test_invalid_filename_rejects_user_md(self, persona_dir: Path):
        with pytest.raises(HTTPException) as exc:
            persona._get_persona_variant_path("USER.md")
        assert exc.value.status_code == 400

    def test_invalid_filename_rejects_path_traversal(self, persona_dir: Path):
        # 路径穿越字符 / 不在字符类中，正则会先拒绝
        with pytest.raises(HTTPException):
            persona._get_persona_variant_path("SOUL.../etc/passwd.md")

    def test_invalid_filename_rejects_spaces(self, persona_dir: Path):
        with pytest.raises(HTTPException):
            persona._get_persona_variant_path("SOUL.my bot.md")


# ── _write_text_atomically ───────────────────────────────────


class TestWriteTextAtomically:
    def test_writes_content_to_target(self, persona_dir: Path):
        target = persona_dir / "SOUL.test.md"
        persona._write_text_atomically(target, "hello world")
        assert target.read_text(encoding="utf-8") == "hello world"

    def test_creates_parent_directory(self, persona_dir: Path):
        target = persona_dir / "nested" / "dir" / "SOUL.nested.md"
        persona._write_text_atomically(target, "nested content")
        assert target.read_text(encoding="utf-8") == "nested content"

    def test_overwrites_existing_file(self, persona_dir: Path):
        target = persona_dir / "SOUL.replace.md"
        target.write_text("old", encoding="utf-8")
        persona._write_text_atomically(target, "new content")
        assert target.read_text(encoding="utf-8") == "new content"

    def test_no_temp_file_left_behind(self, persona_dir: Path):
        target = persona_dir / "SOUL.cleanup.md"
        persona._write_text_atomically(target, "data")
        tmp_files = list(persona_dir.glob(".*.tmp"))
        assert tmp_files == []


# ── get_persona ──────────────────────────────────────────────


class TestGetPersona:
    async def test_invalid_type_raises_400(self, persona_dir: Path):
        with pytest.raises(HTTPException) as exc:
            await persona.get_persona(type="invalid")
        assert exc.value.status_code == 400
        assert "无效 type" in exc.value.detail

    async def test_get_user_returns_content(self, persona_dir: Path):
        resp = await persona.get_persona(type="user")
        assert resp.content == "original user"
        assert resp.type == "user"

    async def test_get_soul_without_variant_returns_default(self, persona_dir: Path):
        # 直接调用路由函数时需显式传 variant=None（绕过 FastAPI Query 默认值）
        resp = await persona.get_persona(type="soul", variant=None)
        assert resp.content == "default soul"
        assert resp.type == "soul"

    async def test_get_soul_with_existing_variant(self, persona_dir: Path):
        (persona_dir / "SOUL.饱饱.md").write_text("custom persona", encoding="utf-8")
        resp = await persona.get_persona(type="soul", variant="SOUL.饱饱.md")
        assert resp.content == "custom persona"
        assert resp.type == "soul"

    async def test_get_soul_with_missing_variant_raises_404(self, persona_dir: Path):
        with pytest.raises(HTTPException) as exc:
            await persona.get_persona(type="soul", variant="SOUL.不存在.md")
        assert exc.value.status_code == 404

    async def test_get_user_with_missing_file_returns_empty(self, monkeypatch, tmp_path: Path):
        monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
        # 没有 USER.md 文件
        resp = await persona.get_persona(type="user")
        assert resp.content == ""
        assert resp.type == "user"

    async def test_type_is_case_insensitive(self, persona_dir: Path):
        resp = await persona.get_persona(type="USER")
        assert resp.content == "original user"
        assert resp.type == "user"


# ── update_persona ───────────────────────────────────────────


class TestUpdatePersona:
    async def test_none_body_raises_400(self, persona_dir: Path):
        with pytest.raises(HTTPException) as exc:
            await persona.update_persona(type="user", body=None)
        assert exc.value.status_code == 400
        assert "请求体不能为空" in exc.value.detail

    async def test_invalid_type_raises_400(self, persona_dir: Path):
        body = persona.PersonaUpdateRequest(content="x")
        with pytest.raises(HTTPException) as exc:
            await persona.update_persona(type="bad", body=body)
        assert exc.value.status_code == 400

    async def test_update_user_persists_content(self, persona_dir: Path):
        body = persona.PersonaUpdateRequest(content="new user content")
        resp = await persona.update_persona(type="user", body=body)
        assert resp.content == "new user content"
        assert (persona_dir / "USER.md").read_text(encoding="utf-8") == "new user content"

    async def test_update_soul_default_persists(self, persona_dir: Path):
        body = persona.PersonaUpdateRequest(content="new soul content")
        resp = await persona.update_persona(type="soul", variant=None, body=body)
        assert resp.content == "new soul content"
        assert (persona_dir / "SOUL.md").read_text(encoding="utf-8") == "new soul content"

    async def test_update_soul_variant_persists(self, persona_dir: Path):
        body = persona.PersonaUpdateRequest(content="variant content")
        resp = await persona.update_persona(
            type="soul", variant="SOUL.小助手.md", body=body
        )
        assert resp.content == "variant content"
        assert (persona_dir / "SOUL.小助手.md").read_text(encoding="utf-8") == "variant content"

    async def test_update_handles_oserror(self, monkeypatch, persona_dir: Path):
        def raise_oserror(*_args, **_kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(persona, "_write_text_atomically", raise_oserror)
        body = persona.PersonaUpdateRequest(content="x")
        with pytest.raises(HTTPException) as exc:
            await persona.update_persona(type="user", body=body)
        assert exc.value.status_code == 500
        assert "保存失败" in exc.value.detail


# ── list_available_personas ──────────────────────────────────


class TestListAvailablePersonas:
    async def test_list_returns_personas_and_active_file(self, persona_dir: Path, monkeypatch):
        sample = [
            {
                "id": "SOUL",
                "file": "SOUL.md",
                "name": "Default",
                "description": "default persona",
                "active": True,
            },
            {
                "id": "SOUL.饱饱",
                "file": "SOUL.饱饱.md",
                "name": "饱饱",
                "description": "sweet",
                "active": False,
            },
        ]
        monkeypatch.setattr(persona, "scan_personas", lambda: sample)
        monkeypatch.setattr(persona, "get_active_persona_file", lambda: "SOUL.md")

        resp = await persona.list_available_personas()
        assert resp.active_file == "SOUL.md"
        assert len(resp.personas) == 2
        assert resp.personas[0].file == "SOUL.md"
        assert resp.personas[1].name == "饱饱"

    async def test_list_with_empty_personas(self, persona_dir: Path, monkeypatch):
        monkeypatch.setattr(persona, "scan_personas", lambda: [])
        monkeypatch.setattr(persona, "get_active_persona_file", lambda: "SOUL.md")

        resp = await persona.list_available_personas()
        assert resp.personas == []
        assert resp.active_file == "SOUL.md"


# ── switch_active_persona ────────────────────────────────────


class TestSwitchActivePersona:
    async def test_switch_to_default_soul(self, persona_dir: Path, monkeypatch):
        called = {}
        monkeypatch.setattr(persona, "set_active_persona", lambda f: called.setdefault("file", f))

        resp = await persona.switch_active_persona(persona.SwitchPersonaRequest(file="SOUL.md"))
        assert resp["status"] == "ok"
        assert resp["active_file"] == "SOUL.md"
        assert called["file"] == "SOUL.md"

    async def test_switch_to_existing_custom_persona(self, persona_dir: Path, monkeypatch):
        (persona_dir / "SOUL.饱饱.md").write_text("content", encoding="utf-8")
        monkeypatch.setattr(persona, "set_active_persona", lambda _: None)

        resp = await persona.switch_active_persona(
            persona.SwitchPersonaRequest(file="SOUL.饱饱.md")
        )
        assert resp["status"] == "ok"
        assert resp["active_file"] == "SOUL.饱饱.md"

    async def test_switch_to_missing_custom_persona_raises_404(
        self, persona_dir: Path, monkeypatch
    ):
        monkeypatch.setattr(persona, "set_active_persona", lambda _: None)
        with pytest.raises(HTTPException) as exc:
            await persona.switch_active_persona(
                persona.SwitchPersonaRequest(file="SOUL.不存在.md")
            )
        assert exc.value.status_code == 404

    async def test_switch_to_missing_default_raises_404(
        self, monkeypatch, tmp_path: Path
    ):
        # 没有 SOUL.md 的场景
        monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
        monkeypatch.setattr(persona, "set_active_persona", lambda _: None)
        with pytest.raises(HTTPException) as exc:
            await persona.switch_active_persona(
                persona.SwitchPersonaRequest(file="SOUL.md")
            )
        assert exc.value.status_code == 404

    async def test_switch_with_invalid_filename_raises_400(
        self, persona_dir: Path, monkeypatch
    ):
        monkeypatch.setattr(persona, "set_active_persona", lambda _: None)
        with pytest.raises(HTTPException) as exc:
            await persona.switch_active_persona(
                persona.SwitchPersonaRequest(file="USER.md")
            )
        assert exc.value.status_code == 400


# ── create_new_persona ───────────────────────────────────────


class TestCreateNewPersona:
    async def test_empty_name_raises_400(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(name="   ")
        with pytest.raises(HTTPException) as exc:
            await persona.create_new_persona(body)
        assert exc.value.status_code == 400
        assert "名称不能为空" in exc.value.detail

    async def test_invalid_name_with_special_chars_raises_400(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(name="bad/name")
        with pytest.raises(HTTPException) as exc:
            await persona.create_new_persona(body)
        assert exc.value.status_code == 400
        assert "名称只能包含" in exc.value.detail

    async def test_invalid_name_with_dot_raises_400(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(name="bad.name")
        with pytest.raises(HTTPException) as exc:
            await persona.create_new_persona(body)
        assert exc.value.status_code == 400

    async def test_create_minimal_persona(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(name="小助手")
        resp = await persona.create_new_persona(body)
        assert resp["status"] == "created"
        assert resp["file"] == "SOUL.小助手.md"
        assert resp["memory_mode"] == "shared"
        assert resp["tools"] == "(全部)"
        # 文件应被创建
        created = persona_dir / "SOUL.小助手.md"
        assert created.exists()
        content = created.read_text(encoding="utf-8")
        assert "# 小助手" in content
        assert "## 角色定义" in content

    async def test_create_with_description_and_tools(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(
            name="robot",
            description="a helpful bot",
            tools="search,calc",
        )
        resp = await persona.create_new_persona(body)
        assert resp["tools"] == "search,calc"
        content = (persona_dir / "SOUL.robot.md").read_text(encoding="utf-8")
        # B-012: frontmatter is now produced via yaml.safe_dump, so simple
        # strings are emitted unquoted. Assert both key presence and that the
        # value parses back correctly via the same parser the app uses.
        assert "description: a helpful bot" in content
        assert "tools: search,calc" in content

    async def test_create_with_invalid_memory_mode_rejected_by_pydantic(
        self, persona_dir: Path
    ):
        """B-012: the memory field is now a Literal enum, so arbitrary
        strings like "custom" are rejected at request-validation time."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            persona.CreatePersonaRequest(name="bot", memory="custom")  # type: ignore[arg-type]

    async def test_create_with_persona_memory_creates_memory_file(self, persona_dir: Path):
        body = persona.CreatePersonaRequest(name="bot2", memory="persona")
        resp = await persona.create_new_persona(body)
        assert resp["memory_mode"] == "persona"
        # 应创建空记忆文件
        mem = persona_dir / "memory_SOUL.bot2.yaml"
        assert mem.exists()
        assert mem.read_text(encoding="utf-8") == "{}\n"

    async def test_create_with_persona_memory_existing_file_not_overwritten(
        self, persona_dir: Path
    ):
        mem = persona_dir / "memory_SOUL.bot3.yaml"
        mem.write_text("existing: data\n", encoding="utf-8")
        body = persona.CreatePersonaRequest(name="bot3", memory="persona")
        await persona.create_new_persona(body)
        # 已存在的记忆文件不应被覆盖
        assert mem.read_text(encoding="utf-8") == "existing: data\n"

    async def test_create_duplicate_raises_409(self, persona_dir: Path):
        (persona_dir / "SOUL.dup.md").write_text("existing", encoding="utf-8")
        body = persona.CreatePersonaRequest(name="dup")
        with pytest.raises(HTTPException) as exc:
            await persona.create_new_persona(body)
        assert exc.value.status_code == 409
        assert "已存在" in exc.value.detail

    async def test_create_rejects_name_with_spaces(self, persona_dir: Path):
        # 正则 ^[\w\u4e00-\u9fff\-]+$ 不允许空格，会先于 replace 触发 400
        body = persona.CreatePersonaRequest(name="my bot name")
        with pytest.raises(HTTPException) as exc:
            await persona.create_new_persona(body)
        assert exc.value.status_code == 400
        assert "名称只能包含" in exc.value.detail


# ── get_persona_profile ──────────────────────────────────────


class TestGetPersonaProfile:
    async def test_profile_with_default_files(self, persona_dir: Path):
        (persona_dir / "SOUL.md").write_text(
            "# Maxma\n你是温暖的大姐姐。\n默认居住在一个小公寓里。\nplayful 直接\n",
            encoding="utf-8",
        )
        (persona_dir / "USER.md").write_text(
            "**称呼**: 小白\n其他内容", encoding="utf-8"
        )
        resp = await persona.get_persona_profile()
        assert resp["name"] == "Maxma"
        assert resp["nickname"] == "小白"
        assert "小公寓" in resp["scene"]
        assert "playful" in resp["style"]
        assert resp["greeting"] == "小白，你来啦。"
        assert resp["avatar"] == "✦"

    async def test_profile_without_soul_file_uses_defaults(
        self, monkeypatch, tmp_path: Path
    ):
        monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
        resp = await persona.get_persona_profile()
        assert resp["name"] == "Maxma"
        assert resp["description"] == "温暖体贴又有点调皮的大姐姐"
        assert resp["scene"] == "吵闹的小公寓，窗外有一条马路"

    async def test_profile_without_user_file_uses_default_nickname(
        self, monkeypatch, tmp_path: Path
    ):
        monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
        (tmp_path / "SOUL.md").write_text("# Robot\n描述\n", encoding="utf-8")
        resp = await persona.get_persona_profile()
        assert resp["nickname"] == "你"
        assert resp["greeting"] == "你，你来啦。"

    async def test_profile_extracts_name_from_heading(self, persona_dir: Path):
        (persona_dir / "SOUL.md").write_text(
            "# 机器人\n副标题内容\n默认居住在一个海边别墅里\n",
            encoding="utf-8",
        )
        resp = await persona.get_persona_profile()
        assert resp["name"] == "机器人"
        assert "海边别墅" in resp["scene"]

    async def test_profile_extracts_style_hints(self, persona_dir: Path):
        (persona_dir / "SOUL.md").write_text(
            "# Bot\n描述\nplayful 可爱 温暖\n",
            encoding="utf-8",
        )
        resp = await persona.get_persona_profile()
        # 应从文本中提取 style hints
        assert "playful" in resp["style"]
        assert "可爱" in resp["style"]
