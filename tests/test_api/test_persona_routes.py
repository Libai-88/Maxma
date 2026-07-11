"""Regression tests for user-profile and persona editor persistence."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from api.routes import persona


@pytest.fixture
def persona_dir(monkeypatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
    (tmp_path / "SOUL.md").write_text("default soul", encoding="utf-8")
    (tmp_path / "USER.md").write_text("original user", encoding="utf-8")
    return tmp_path


async def test_user_update_is_readable_after_atomic_persist(persona_dir: Path):
    body = persona.PersonaUpdateRequest(content="updated user profile")

    updated = await persona.update_persona(type="user", body=body)
    loaded = await persona.get_persona(type="user")

    assert updated.content == "updated user profile"
    assert loaded.content == "updated user profile"
    assert (persona_dir / "USER.md").read_text(encoding="utf-8") == "updated user profile"


async def test_custom_persona_update_uses_its_own_file(persona_dir: Path):
    custom = persona_dir / "SOUL.小助手.md"
    custom.write_text("old persona", encoding="utf-8")

    await persona.update_persona(
        type="soul",
        variant=custom.name,
        body=persona.PersonaUpdateRequest(content="new persona"),
    )

    assert (await persona.get_persona(type="soul", variant=custom.name)).content == "new persona"
    assert (persona_dir / "SOUL.md").read_text(encoding="utf-8") == "default soul"


async def test_switch_rejects_non_persona_file(monkeypatch, persona_dir: Path):
    monkeypatch.setattr(persona, "set_active_persona", lambda _: None)

    with pytest.raises(HTTPException, match="无效的人格文件名"):
        await persona.switch_active_persona(persona.SwitchPersonaRequest(file="USER.md"))

