"""Tests for ``agent.prompts`` — system-prompt assembly, persona management,
frontmatter parsing, skills/macros scanning, and prompt builders.

All filesystem access is isolated: module-level path constants in
``agent.prompts`` are monkeypatched to ``tmp_path``-based dirs so no real
config files are touched.  Persona *templates* (``agent/persona/*_default.md``)
remain real via ``agent.persona_loader.PERSONA_DIR``.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

import agent.prompts as prompts


# ── isolated filesystem fixture ────────────────────────────────


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect all prompts.py path constants to tmp_path and seed minimal files.

    Returns the tmp personas dir.
    """
    personas_dir = tmp_path / "personas"
    personas_dir.mkdir()
    skills_dir = tmp_path / "skills"
    skills_dir.mkdir()
    macros_dir = tmp_path / "macros"
    macros_dir.mkdir()

    # seed minimal persona files
    (personas_dir / "SOUL.md").write_text(
        "# 默认人设\n你是 {{USER_NAME}} 的助手。\n", encoding="utf-8"
    )
    (personas_dir / "AGENTS.md").write_text("## 行为规则\n- 礼貌\n", encoding="utf-8")
    (personas_dir / "USER.example.md").write_text(
        "**称呼**：（请填写你的称呼）\n", encoding="utf-8"
    )
    (personas_dir / "USER.md").write_text("**称呼**：小明\n一些自述\n", encoding="utf-8")
    (personas_dir / "memory.yaml").write_text("version: 1\n", encoding="utf-8")
    (personas_dir / "active_persona.yaml").write_text("file: SOUL.md\n", encoding="utf-8")

    monkeypatch.setattr(prompts, "PERSONAS_DIR", personas_dir)
    monkeypatch.setattr(prompts, "ACTIVE_PERSONA_PATH", personas_dir / "active_persona.yaml")
    monkeypatch.setattr(prompts, "ANTHROPIC_SKILLS_DIR", skills_dir)
    monkeypatch.setattr(prompts, "SKILLS_DATA_DIR", tmp_path / "user_skills")
    monkeypatch.setattr(prompts, "MACROS_DIR", macros_dir)
    monkeypatch.setattr(prompts, "MACROS_DATA_DIR", tmp_path / "user_macros")

    prompts.invalidate_prompt_cache()
    return personas_dir


# ── get_active_persona_file ────────────────────────────────────


def test_get_active_persona_file_missing_returns_default(isolated_env: Path) -> None:
    # remove active_persona.yaml
    (isolated_env / "active_persona.yaml").unlink()
    assert prompts.get_active_persona_file() == "SOUL.md"


def test_get_active_persona_file_reads_yaml(isolated_env: Path) -> None:
    (isolated_env / "active_persona.yaml").write_text("file: SOUL.foo.md\n", encoding="utf-8")
    assert prompts.get_active_persona_file() == "SOUL.foo.md"


def test_get_active_persona_file_corrupt_yaml_falls_back(isolated_env: Path) -> None:
    (isolated_env / "active_persona.yaml").write_text(": : not valid yaml :::", encoding="utf-8")
    # corrupt yaml -> default + warning logged
    assert prompts.get_active_persona_file() == "SOUL.md"


# ── _persona_name_from_soul ────────────────────────────────────


@pytest.mark.parametrize(
    ("soul_file", "expected"),
    [
        ("SOUL.md", "default"),
        ("SOUL.饱饱.md", "饱饱"),
        ("SOUL.foo.md", "foo"),
        ("OTHER.md", "OTHER"),
    ],
)
def test_persona_name_from_soul(soul_file: str, expected: str) -> None:
    assert prompts._persona_name_from_soul(soul_file) == expected


# ── set_active_persona ─────────────────────────────────────────


def test_set_active_persona_writes_and_invalidates(isolated_env: Path) -> None:
    # build cache first with default persona
    first = prompts.build_system_prompt()
    assert "小明" in first  # USER.md 称呼 substituted into SOUL

    # add a new SOUL file and switch to it
    (isolated_env / "SOUL.alt.md").write_text("# 备用人设\n你是 {{USER_NAME}} 的副手。\n", encoding="utf-8")
    prompts.set_active_persona("SOUL.alt.md")

    # active file now reflects new persona
    assert prompts.get_active_persona_file() == "SOUL.alt.md"
    second = prompts.build_system_prompt()
    # cache was invalidated -> rebuild picks up the new SOUL content
    assert "副手" in second
    assert second != first


# ── list_personas ──────────────────────────────────────────────


def test_list_personas_scans_and_skips_example(isolated_env: Path) -> None:
    (isolated_env / "SOUL.example.md").write_text("# example\nshould be skipped\n", encoding="utf-8")
    (isolated_env / "SOUL.alpha.md").write_text("# Alpha\nalpha desc line\n", encoding="utf-8")
    personas = prompts.list_personas()
    files = {p["file"] for p in personas}
    assert "SOUL.md" in files
    assert "SOUL.alpha.md" in files
    assert "SOUL.example.md" not in files


def test_list_personas_display_name_and_description(isolated_env: Path) -> None:
    (isolated_env / "SOUL.beta.md").write_text(
        "# Beta Persona\nfirst description line\nmore content\n", encoding="utf-8"
    )
    personas = {p["file"]: p for p in prompts.list_personas()}
    beta = personas["SOUL.beta.md"]
    assert beta["name"] == "Beta Persona"
    assert beta["description"] == "first description line"
    assert beta["id"] == "SOUL.beta"


def test_list_personas_description_truncation(isolated_env: Path) -> None:
    long_desc = "x" * 100
    (isolated_env / "SOUL.long.md").write_text(f"# Long\n{long_desc}\n", encoding="utf-8")
    personas = {p["file"]: p for p in prompts.list_personas()}
    long_p = personas["SOUL.long.md"]
    # > 80 chars -> truncated to 77 + "..."
    assert long_p["description"].endswith("...")
    assert len(long_p["description"]) == 80


def test_list_personas_active_flag(isolated_env: Path) -> None:
    personas = {p["file"]: p for p in prompts.list_personas()}
    assert personas["SOUL.md"]["active"] is True


def test_list_personas_fallback_display_name_to_stem(isolated_env: Path) -> None:
    # SOUL.md content has no "# " heading -> display_name falls back to stem
    (isolated_env / "SOUL.md").write_text("no heading here\n", encoding="utf-8")
    personas = {p["file"]: p for p in prompts.list_personas()}
    assert personas["SOUL.md"]["name"] == "SOUL"


# ── _file_hash ─────────────────────────────────────────────────


def test_file_hash_returns_hex(isolated_env: Path) -> None:
    p = isolated_env / "SOUL.md"
    h = prompts._file_hash(p)
    assert isinstance(h, str)
    assert len(h) == 16
    # deterministic
    assert prompts._file_hash(p) == h


def test_file_hash_oserror_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "nope.md"
    # file does not exist -> OSError -> ""
    assert prompts._file_hash(p) == ""


# ── _current_fingerprint ───────────────────────────────────────


def test_current_fingerprint_deterministic(isolated_env: Path) -> None:
    fp1 = prompts._current_fingerprint()
    fp2 = prompts._current_fingerprint()
    assert fp1 == fp2
    assert "AGENTS.md:" in fp1
    assert "active:" in fp1
    assert "persona:identity:" in fp1


def test_current_fingerprint_changes_on_active_persona(isolated_env: Path) -> None:
    fp1 = prompts._current_fingerprint()
    (isolated_env / "active_persona.yaml").write_text("file: SOUL.md\n# changed\n", encoding="utf-8")
    fp2 = prompts._current_fingerprint()
    assert fp1 != fp2


def test_current_fingerprint_includes_skills_and_macros(isolated_env: Path) -> None:
    # add a SKILL.md and MACRO.md in the scanned dirs
    sk = prompts.ANTHROPIC_SKILLS_DIR / "my_skill" / "SKILL.md"
    sk.parent.mkdir(parents=True, exist_ok=True)
    sk.write_text("---\nname: My Skill\ndescription: does things\n---\nbody\n", encoding="utf-8")
    mc = prompts.MACROS_DIR / "my_macro" / "MACRO.md"
    mc.parent.mkdir(parents=True, exist_ok=True)
    mc.write_text("---\nname: My Macro\ndescription: a macro\n---\nbody\n", encoding="utf-8")
    fp = prompts._current_fingerprint()
    assert "sk:" in fp
    assert "mc:" in fp


# ── _ensure_user_md ────────────────────────────────────────────


def test_ensure_user_md_copies_from_template(isolated_env: Path) -> None:
    user_md = isolated_env / "USER.md"
    user_md.unlink()  # remove the seeded one
    assert not user_md.exists()
    prompts._ensure_user_md()
    assert user_md.exists()
    assert "称呼" in user_md.read_text(encoding="utf-8")


def test_ensure_user_md_noop_when_exists(isolated_env: Path) -> None:
    user_md = isolated_env / "USER.md"
    original = user_md.read_text(encoding="utf-8")
    prompts._ensure_user_md()
    # unchanged
    assert user_md.read_text(encoding="utf-8") == original


# ── build_system_prompt / get_system_prompt_parts / cache ──────


def test_build_system_prompt_returns_content(isolated_env: Path) -> None:
    p = prompts.build_system_prompt()
    assert isinstance(p, str)
    assert p  # non-empty
    # persona layer (from real templates), behavior rules, personality, user self-report
    assert "## 行为规则" in p
    assert "## 性格设定" in p
    assert "## 用户自述" in p
    # {{USER_NAME}} replaced with the configured user name
    assert "小明" in p
    assert "{{USER_NAME}}" not in p


def test_build_system_prompt_replaces_placeholder_when_no_username(isolated_env: Path) -> None:
    # USER.md with placeholder-only -> _parse_user_name returns "" -> replaced with "你"
    (isolated_env / "USER.md").write_text("**称呼**：（请填写）\n", encoding="utf-8")
    prompts.invalidate_prompt_cache()
    p = prompts.build_system_prompt()
    assert "你" in p
    assert "{{USER_NAME}}" not in p


def test_get_system_prompt_parts_structure(isolated_env: Path) -> None:
    parts = prompts.get_system_prompt_parts()
    assert isinstance(parts, list)
    assert parts  # non-empty
    keys = {part["key"] for part in parts}
    labels = {part["label"] for part in parts}
    assert "persona" in keys
    assert "behavior_rules" in keys
    assert "personality" in keys
    assert "skills" in keys
    assert "macros" in keys
    for part in parts:
        assert "content" in part and isinstance(part["content"], str)


def test_build_system_prompt_uses_cache(isolated_env: Path) -> None:
    first = prompts.build_system_prompt()
    with patch.object(prompts, "_current_fingerprint", wraps=prompts._current_fingerprint) as spy:
        second = prompts.build_system_prompt()
        # fingerprint checked but cache hit -> no rebuild needed
        assert spy.called
    assert first == second


def test_invalidate_prompt_cache_forces_rebuild(isolated_env: Path) -> None:
    first = prompts.build_system_prompt()
    prompts.invalidate_prompt_cache()
    # change SOUL content
    (isolated_env / "SOUL.md").write_text("# 新人设\n全新内容 {{USER_NAME}}\n", encoding="utf-8")
    second = prompts.build_system_prompt()
    assert "全新内容" in second
    assert first != second


# ── _read_persona / _read_if_exists ────────────────────────────


def test_read_persona_existing(isolated_env: Path) -> None:
    assert "行为规则" in prompts._read_persona("AGENTS.md")


def test_read_persona_missing_returns_empty(isolated_env: Path) -> None:
    assert prompts._read_persona("NONEXISTENT.md") == ""


def test_read_if_exists_strips_content(isolated_env: Path) -> None:
    # _read_if_exists returns stripped content
    result = prompts._read_if_exists("AGENTS.md")
    assert result == result.strip()
    assert "行为规则" in result


def test_read_if_exists_missing_returns_empty(isolated_env: Path) -> None:
    assert prompts._read_if_exists("NONEXISTENT.md") == ""


# ── _parse_user_name ───────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("**称呼**：小明\n", "小明"),
        ("**称呼**: 小红\n", "小红"),
        ("**称呼**：（请填写）\n", ""),
        ("**称呼**: (placeholder)\n", ""),
        ("nothing here", ""),
        ("", ""),
    ],
)
def test_parse_user_name(text: str, expected: str) -> None:
    assert prompts._parse_user_name(text) == expected


# ── _parse_frontmatter ─────────────────────────────────────────


def test_parse_frontmatter_no_frontmatter() -> None:
    assert prompts._parse_frontmatter("just body\nno frontmatter") == {}


def test_parse_frontmatter_simple() -> None:
    text = "---\nname: My Skill\ndescription: \"does things\"\ntools: 'a, b'\nmemory: shared\nother: ignored\n---\nbody"
    meta = prompts._parse_frontmatter(text)
    assert meta["name"] == "My Skill"
    assert meta["description"] == "does things"
    assert meta["tools"] == "a, b"
    assert meta["memory"] == "shared"
    assert "other" not in meta  # only name/description/tools/memory kept


def test_parse_frontmatter_multiline_block() -> None:
    text = "---\nname: Skill\ndescription: |\n  line one\n  line two\n---\nbody"
    meta = prompts._parse_frontmatter(text)
    assert meta["description"] == "line one line two"


def test_parse_frontmatter_multiline_folded() -> None:
    text = "---\nname: Skill\ndescription: >\n  folded\n  text\n---\nbody"
    meta = prompts._parse_frontmatter(text)
    assert meta["description"] == "folded text"


# ── get_persona_memory_path ────────────────────────────────────


def test_get_persona_memory_path_shared(isolated_env: Path) -> None:
    # SOUL.md has no memory: persona frontmatter -> shared memory.yaml
    path = prompts.get_persona_memory_path()
    assert path.name == "memory.yaml"


def test_get_persona_memory_path_persona_scoped(isolated_env: Path) -> None:
    (isolated_env / "SOUL.md").write_text(
        "---\nmemory: persona\n---\n# 人设\nbody\n", encoding="utf-8"
    )
    path = prompts.get_persona_memory_path()
    assert path.name == "memory_SOUL.yaml"


# ── get_persona_allowed_tools ──────────────────────────────────


def test_get_persona_allowed_tools_none_when_unset(isolated_env: Path) -> None:
    assert prompts.get_persona_allowed_tools() is None


def test_get_persona_allowed_tools_parsed(isolated_env: Path) -> None:
    (isolated_env / "SOUL.md").write_text(
        "---\ntools: file_read, file_write, run_python\n---\n# 人设\n", encoding="utf-8"
    )
    tools = prompts.get_persona_allowed_tools()
    assert tools == {"file_read", "file_write", "run_python"}


def test_get_persona_allowed_tools_empty_returns_none(isolated_env: Path) -> None:
    (isolated_env / "SOUL.md").write_text("---\ntools: \n---\n# 人设\n", encoding="utf-8")
    assert prompts.get_persona_allowed_tools() is None


# ── _scan_anthropic_skills ─────────────────────────────────────


def test_scan_anthropic_skills_empty(isolated_env: Path) -> None:
    assert prompts._scan_anthropic_skills() == ""


def test_scan_anthropic_skills_with_frontmatter(isolated_env: Path) -> None:
    sk = prompts.ANTHROPIC_SKILLS_DIR / "research" / "SKILL.md"
    sk.parent.mkdir(parents=True, exist_ok=True)
    sk.write_text(
        "---\nname: Research\ndescription: deep research\n---\nbody\n", encoding="utf-8"
    )
    out = prompts._scan_anthropic_skills()
    assert "## 可用 Anthropic Skills" in out
    assert "Research" in out
    assert "deep research" in out
    assert str(sk).replace("\\", "/") in out


def test_scan_anthropic_skills_without_description(isolated_env: Path) -> None:
    sk = prompts.ANTHROPIC_SKILLS_DIR / "bare" / "SKILL.md"
    sk.parent.mkdir(parents=True, exist_ok=True)
    sk.write_text("---\nname: Bare\n---\nbody\n", encoding="utf-8")
    out = prompts._scan_anthropic_skills()
    assert "Bare" in out
    # no description -> no colon after the entry's path on same line
    assert "deep research" not in out


def test_scan_anthropic_skills_skips_corrupt_file(isolated_env: Path) -> None:
    good = prompts.ANTHROPIC_SKILLS_DIR / "good" / "SKILL.md"
    good.parent.mkdir(parents=True, exist_ok=True)
    good.write_text("---\nname: Good\ndescription: ok\n---\nbody\n", encoding="utf-8")
    bad = prompts.ANTHROPIC_SKILLS_DIR / "bad" / "SKILL.md"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_bytes(b"\xff\xfe\x00invalid utf8")
    out = prompts._scan_anthropic_skills()
    assert "Good" in out
    # corrupt file skipped, no crash
    assert "bad" not in out.lower() or "Bad" not in out


def test_scan_anthropic_skills_dedup_when_same_canonical_path(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # point SKILLS_DATA_DIR at the same dir as ANTHROPIC_SKILLS_DIR -> dedup
    sk = prompts.ANTHROPIC_SKILLS_DIR / "dup" / "SKILL.md"
    sk.parent.mkdir(parents=True, exist_ok=True)
    sk.write_text("---\nname: Dup\ndescription: d\n---\nbody\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "SKILLS_DATA_DIR", prompts.ANTHROPIC_SKILLS_DIR)
    out = prompts._scan_anthropic_skills()
    # entry appears exactly once
    assert out.count("Dup") == 1


# ── _scan_macros ───────────────────────────────────────────────


def test_scan_macros_empty(isolated_env: Path) -> None:
    assert prompts._scan_macros() == ""


def test_scan_macros_with_frontmatter(isolated_env: Path) -> None:
    mc = prompts.MACROS_DIR / "snippet" / "MACRO.md"
    mc.parent.mkdir(parents=True, exist_ok=True)
    mc.write_text("---\nname: Snippet\ndescription: reusable\n---\nbody\n", encoding="utf-8")
    out = prompts._scan_macros()
    assert "## 可用宏" in out
    assert "Snippet" in out
    assert "reusable" in out


def test_scan_macros_skips_corrupt_file(isolated_env: Path) -> None:
    good = prompts.MACROS_DIR / "good" / "MACRO.md"
    good.parent.mkdir(parents=True, exist_ok=True)
    good.write_text("---\nname: GoodM\ndescription: ok\n---\nbody\n", encoding="utf-8")
    bad = prompts.MACROS_DIR / "bad" / "MACRO.md"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_bytes(b"\xff\xfe\x00invalid")
    out = prompts._scan_macros()
    assert "GoodM" in out


class _BrokenDir:
    """Stub Path-like whose rglob raises OSError — exercises scan error isolation."""

    def __init__(self, target: str):
        self._target = target

    def is_dir(self) -> bool:
        return True

    def rglob(self, pattern: str):
        raise OSError("simulated scan failure")


def test_scan_anthropic_skills_isolates_rglob_oserror(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ANTHROPIC_SKILLS_DIR's rglob raises -> warning logged, SKILLS_DATA_DIR still scanned
    user_skills = prompts.SKILLS_DATA_DIR
    user_skills.mkdir(parents=True, exist_ok=True)
    sk = user_skills / "ok" / "SKILL.md"
    sk.parent.mkdir(parents=True, exist_ok=True)
    sk.write_text("---\nname: OK\n---\nbody\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "ANTHROPIC_SKILLS_DIR", _BrokenDir("SKILL.md"))
    out = prompts._scan_anthropic_skills()
    assert "OK" in out  # the broken dir did not abort the whole scan


def test_scan_macros_isolates_rglob_oserror(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    user_macros = prompts.MACROS_DATA_DIR
    user_macros.mkdir(parents=True, exist_ok=True)
    mc = user_macros / "ok" / "MACRO.md"
    mc.parent.mkdir(parents=True, exist_ok=True)
    mc.write_text("---\nname: OKM\n---\nbody\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "MACROS_DIR", _BrokenDir("MACRO.md"))
    out = prompts._scan_macros()
    assert "OKM" in out


def test_current_fingerprint_isolates_scan_oserror(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # _current_fingerprint scans skills/macros dirs; broken dirs must not crash it
    monkeypatch.setattr(prompts, "ANTHROPIC_SKILLS_DIR", _BrokenDir("SKILL.md"))
    monkeypatch.setattr(prompts, "MACROS_DIR", _BrokenDir("MACRO.md"))
    fp = prompts._current_fingerprint()
    assert "AGENTS.md:" in fp  # persona files still hashed
    # no sk:/mc: entries because both scan dirs raised
    assert "sk:" not in fp
    assert "mc:" not in fp


# ── prompt builders (pure) ───────────────────────────────────────────────────


def test_build_coordinator_prompt_without_persona_context() -> None:
    p = prompts.build_coordinator_prompt()
    assert "Coordinator" in p
    assert '"target"' in p or 'target' in p
    assert "direct" in p and "specialist" in p and "main" in p
    # no persona context -> no persona clause
    assert "当前人设上下文" not in p


def test_build_coordinator_prompt_with_persona_context() -> None:
    p = prompts.build_coordinator_prompt(persona_context="当前是饱饱人设")
    assert "当前人设上下文：当前是饱饱人设" in p


def test_build_verifier_prompt() -> None:
    p = prompts.build_verifier_prompt()
    assert "Verifier" in p
    assert "sufficient" in p and "insufficient" in p
    assert "gaps" in p


def test_build_rag_grader_prompt() -> None:
    p = prompts.build_rag_grader_prompt()
    assert "RAG" in p
    assert "relevant" in p
    assert "true" in p and "false" in p
