"""Coverage push tests for agent/prompts.py.

Targets previously uncovered lines:
- Lines 145-146: except OSError on p.resolve() in _current_fingerprint (skills)
- Line 148: continue on duplicate canonical path in _current_fingerprint (skills)
- Lines 161-162: except OSError on p.resolve() in _current_fingerprint (macros)
- Line 164: continue on duplicate canonical path in _current_fingerprint (macros)
- Lines 401-402: except OSError on sk_path.resolve() in _scan_anthropic_skills
- Lines 454-455: except OSError on mp_path.resolve() in _scan_macros
- Line 457: continue on duplicate canonical path in _scan_macros
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from agent import prompts as prompts_mod
from agent.prompts import (
    _current_fingerprint,
    _scan_anthropic_skills,
    _scan_macros,
    invalidate_prompt_cache,
)


@pytest.fixture(autouse=True)
def reset_cache():
    """Invalidate the prompt cache before and after each test."""
    invalidate_prompt_cache()
    yield
    invalidate_prompt_cache()


# ── Lines 145-146: OSError on resolve in _current_fingerprint (skills) ──


def test_fingerprint_handles_resolve_oserror_skills(tmp_path, monkeypatch):
    """Lines 145-146: when Path.resolve() raises OSError for a SKILL.md file
    in _current_fingerprint, the file is skipped via continue."""
    # Create a skills dir with a SKILL.md
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    skill_file = skills_dir / "my_skill" / "SKILL.md"
    skill_file.parent.mkdir()
    skill_file.write_text("---\nname: test\ndescription: desc\n---\nbody", encoding="utf-8")

    # Patch directory constants
    monkeypatch.setattr(prompts_mod, "ANTHROPIC_SKILLS_DIR", skills_dir)
    monkeypatch.setattr(prompts_mod, "SKILLS_DATA_DIR", tmp_path / "empty_skills")
    monkeypatch.setattr(prompts_mod, "MACROS_DIR", tmp_path / "empty_macros")
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", tmp_path / "empty_macros_data")
    monkeypatch.setattr(prompts_mod, "PERSONAS_DIR", tmp_path / "personas")
    monkeypatch.setattr(prompts_mod, "ACTIVE_PERSONA_PATH", tmp_path / "active_persona.yaml")

    # Mock Path.resolve to raise OSError for SKILL.md paths
    real_resolve = Path.resolve

    def _resolve_boom(self, *args, **kwargs):
        if self.name == "SKILL.md":
            raise OSError("resolve failed")
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _resolve_boom)

    # Should not raise — OSError is caught and the file is skipped
    fp = _current_fingerprint()
    assert isinstance(fp, str)
    assert "sk:" not in fp  # skill was skipped


# ── Line 148: duplicate canonical path in _current_fingerprint (skills) ──


def test_fingerprint_dedup_skills_canonical(tmp_path, monkeypatch):
    """Line 148: when ANTHROPIC_SKILLS_DIR and SKILLS_DATA_DIR point to the
    same directory, the duplicate SKILL.md is skipped via continue."""
    skills_dir = tmp_path / "shared_skills"
    skills_dir.mkdir()
    skill_file = skills_dir / "dup_skill" / "SKILL.md"
    skill_file.parent.mkdir()
    skill_file.write_text("---\nname: dup\ndescription: d\n---\nbody", encoding="utf-8")

    # Both dirs point to the same location → duplicate canonical path
    monkeypatch.setattr(prompts_mod, "ANTHROPIC_SKILLS_DIR", skills_dir)
    monkeypatch.setattr(prompts_mod, "SKILLS_DATA_DIR", skills_dir)
    monkeypatch.setattr(prompts_mod, "MACROS_DIR", tmp_path / "empty_macros")
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", tmp_path / "empty_macros_data")
    monkeypatch.setattr(prompts_mod, "PERSONAS_DIR", tmp_path / "personas")
    monkeypatch.setattr(prompts_mod, "ACTIVE_PERSONA_PATH", tmp_path / "active_persona.yaml")

    fp = _current_fingerprint()
    assert isinstance(fp, str)
    # The skill appears only once (deduped)
    assert fp.count("sk:SKILL.md") == 1


# ── Lines 161-162: OSError on resolve in _current_fingerprint (macros) ──


def test_fingerprint_handles_resolve_oserror_macros(tmp_path, monkeypatch):
    """Lines 161-162: when Path.resolve() raises OSError for a MACRO.md file
    in _current_fingerprint, the file is skipped via continue."""
    macros_dir = tmp_path / "macros"
    macros_dir.mkdir()
    macro_file = macros_dir / "my_macro" / "MACRO.md"
    macro_file.parent.mkdir()
    macro_file.write_text("---\nname: test\ndescription: desc\n---\nbody", encoding="utf-8")

    monkeypatch.setattr(prompts_mod, "ANTHROPIC_SKILLS_DIR", tmp_path / "empty_skills")
    monkeypatch.setattr(prompts_mod, "SKILLS_DATA_DIR", tmp_path / "empty_skills2")
    monkeypatch.setattr(prompts_mod, "MACROS_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", tmp_path / "empty_macros_data")
    monkeypatch.setattr(prompts_mod, "PERSONAS_DIR", tmp_path / "personas")
    monkeypatch.setattr(prompts_mod, "ACTIVE_PERSONA_PATH", tmp_path / "active_persona.yaml")

    real_resolve = Path.resolve

    def _resolve_boom(self, *args, **kwargs):
        if self.name == "MACRO.md":
            raise OSError("resolve failed")
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _resolve_boom)

    fp = _current_fingerprint()
    assert isinstance(fp, str)
    assert "mc:" not in fp  # macro was skipped


# ── Line 164: duplicate canonical path in _current_fingerprint (macros) ──


def test_fingerprint_dedup_macros_canonical(tmp_path, monkeypatch):
    """Line 164: when MACROS_DIR and MACROS_DATA_DIR point to the same
    directory, the duplicate MACRO.md is skipped via continue."""
    macros_dir = tmp_path / "shared_macros"
    macros_dir.mkdir()
    macro_file = macros_dir / "dup_macro" / "MACRO.md"
    macro_file.parent.mkdir()
    macro_file.write_text("---\nname: dup\ndescription: d\n---\nbody", encoding="utf-8")

    monkeypatch.setattr(prompts_mod, "ANTHROPIC_SKILLS_DIR", tmp_path / "empty_skills")
    monkeypatch.setattr(prompts_mod, "SKILLS_DATA_DIR", tmp_path / "empty_skills2")
    monkeypatch.setattr(prompts_mod, "MACROS_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "PERSONAS_DIR", tmp_path / "personas")
    monkeypatch.setattr(prompts_mod, "ACTIVE_PERSONA_PATH", tmp_path / "active_persona.yaml")

    fp = _current_fingerprint()
    assert isinstance(fp, str)
    assert fp.count("mc:MACRO.md") == 1


# ── Lines 401-402: OSError on resolve in _scan_anthropic_skills ──────


def test_scan_skills_resolve_oserror(tmp_path, monkeypatch):
    """Lines 401-402: when Path.resolve() raises OSError for a SKILL.md in
    _scan_anthropic_skills, the file is skipped via continue."""
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    skill_file = skills_dir / "bad_skill" / "SKILL.md"
    skill_file.parent.mkdir()
    skill_file.write_text("---\nname: bad\ndescription: d\n---\nbody", encoding="utf-8")

    monkeypatch.setattr(prompts_mod, "ANTHROPIC_SKILLS_DIR", skills_dir)
    monkeypatch.setattr(prompts_mod, "SKILLS_DATA_DIR", tmp_path / "empty")

    real_resolve = Path.resolve

    def _resolve_boom(self, *args, **kwargs):
        if self.name == "SKILL.md":
            raise OSError("resolve failed")
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _resolve_boom)

    result = _scan_anthropic_skills()
    # The skill with resolve error was skipped — result is empty
    assert result == ""


# ── Lines 454-455, 457: OSError + dedup in _scan_macros ─────────────


def test_scan_macros_resolve_oserror_and_dedup(tmp_path, monkeypatch):
    """Lines 454-455, 457: OSError on resolve skips the file; duplicate
    canonical path between MACROS_DIR and MACROS_DATA_DIR is deduped."""
    # Create two macro dirs — one with a resolvable file, one that will
    # be the same path (dedup) plus one that raises OSError
    macros_dir = tmp_path / "macros1"
    macros_dir.mkdir()
    good_macro = macros_dir / "good" / "MACRO.md"
    good_macro.parent.mkdir()
    good_macro.write_text("---\nname: good\ndescription: good desc\n---\nbody", encoding="utf-8")

    bad_macro = macros_dir / "bad" / "MACRO.md"
    bad_macro.parent.mkdir()
    bad_macro.write_text("---\nname: bad\ndescription: bad\n---\nbody", encoding="utf-8")

    # Point both dirs to the same location → dedup (line 457)
    monkeypatch.setattr(prompts_mod, "MACROS_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", macros_dir)

    real_resolve = Path.resolve

    def _resolve_boom_for_bad(self, *args, **kwargs):
        if self.name == "MACRO.md" and "bad" in str(self):
            raise OSError("resolve failed")
        return real_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", _resolve_boom_for_bad)

    result = _scan_macros()
    # "good" macro appears once (deduped); "bad" macro was skipped (OSError)
    assert "good" in result
    assert "bad" not in result
    # Only one entry (not duplicated by the two dirs)
    assert result.count("[good]") == 1
