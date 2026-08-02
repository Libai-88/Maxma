"""Coverage push tests for agent/prompts.py.

Targets previously uncovered lines (macros only — skills have been migrated
to OMP native `.omp/skills/`):
- Lines 161-162: except OSError on p.resolve() in _current_fingerprint (macros)
- Line 164: continue on duplicate canonical path in _current_fingerprint (macros)
- Lines 454-455: except OSError on mp_path.resolve() in _scan_macros
- Line 457: continue on duplicate canonical path in _scan_macros
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agent import prompts as prompts_mod
from agent.prompts import (
    _current_fingerprint,
    _scan_macros,
    invalidate_prompt_cache,
)


@pytest.fixture(autouse=True)
def reset_cache():
    """Invalidate the prompt cache before and after each test."""
    invalidate_prompt_cache()
    yield
    invalidate_prompt_cache()


# ── Lines 161-162: OSError on resolve in _current_fingerprint (macros) ──


def test_fingerprint_handles_resolve_oserror_macros(tmp_path, monkeypatch):
    """Lines 161-162: when Path.resolve() raises OSError for a MACRO.md file
    in _current_fingerprint, the file is skipped via continue."""
    macros_dir = tmp_path / "macros"
    macros_dir.mkdir()
    macro_file = macros_dir / "my_macro" / "MACRO.md"
    macro_file.parent.mkdir()
    macro_file.write_text("---\nname: test\ndescription: desc\n---\nbody", encoding="utf-8")

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

    monkeypatch.setattr(prompts_mod, "MACROS_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "MACROS_DATA_DIR", macros_dir)
    monkeypatch.setattr(prompts_mod, "PERSONAS_DIR", tmp_path / "personas")
    monkeypatch.setattr(prompts_mod, "ACTIVE_PERSONA_PATH", tmp_path / "active_persona.yaml")

    fp = _current_fingerprint()
    assert isinstance(fp, str)
    assert fp.count("mc:MACRO.md") == 1


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