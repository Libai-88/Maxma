"""USER_NAME-TOKEN-001 回归测试：native 模式 build_append_prompt 必须替换
SOUL.md 中的 {{USER_NAME}} 占位符（与 _rebuild 行为一致）。"""

from __future__ import annotations

from pathlib import Path

import pytest

import agent.prompts as prompts


@pytest.fixture
def prompts_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Isolate agent.prompts path constants to a tmp_path."""
    personas_dir = tmp_path / "personas"
    personas_dir.mkdir()
    (personas_dir / "SOUL.md").write_text(
        "你是{{USER_NAME}}的助手\n", encoding="utf-8"
    )
    (personas_dir / "USER.md").write_text(
        "**称呼**：小墨\n", encoding="utf-8"
    )
    (personas_dir / "memory.yaml").write_text("version: 1\n", encoding="utf-8")
    (personas_dir / "active_persona.yaml").write_text("file: SOUL.md\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "PERSONAS_DIR", personas_dir)
    monkeypatch.setattr(prompts, "ACTIVE_PERSONA_PATH", personas_dir / "active_persona.yaml")
    prompts.invalidate_prompt_cache()
    return personas_dir


class TestUserNameToken:
    def test_append_prompt_replaces_user_name_placeholder(
        self, prompts_env: Path
    ) -> None:
        prompt = prompts.build_append_prompt()
        assert "{{USER_NAME}}" not in prompt
        assert "你是小墨的助手" in prompt

    def test_append_prompt_falls_back_to_seeded_name_when_no_user_md(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        personas_dir = tmp_path / "personas2"
        personas_dir.mkdir()
        (personas_dir / "SOUL.md").write_text(
            "你是{{USER_NAME}}的助手\n", encoding="utf-8"
        )
        # 无 USER.md：_ensure_user_md 会生成 seed（默认称呼来自活跃人格名）
        (personas_dir / "memory.yaml").write_text("version: 1\n", encoding="utf-8")
        (personas_dir / "active_persona.yaml").write_text("file: SOUL.md\n", encoding="utf-8")
        monkeypatch.setattr(prompts, "PERSONAS_DIR", personas_dir)
        monkeypatch.setattr(prompts, "ACTIVE_PERSONA_PATH", personas_dir / "active_persona.yaml")
        prompts.invalidate_prompt_cache()
        prompt = prompts.build_append_prompt()
        # 关键断言：占位符必须被替换（无论替换成 seed 称呼还是兜底"你"）
        assert "{{USER_NAME}}" not in prompt
