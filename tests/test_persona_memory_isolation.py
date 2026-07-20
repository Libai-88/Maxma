"""Round 4 Red regression tests for B-011 and B-012.

B-011 — `memory: "isolated"` must not silently fall back to shared
``memory.yaml``. We assert (a) write-time normalization in
``create_new_persona`` so the SOUL frontmatter stores the canonical
``memory: persona`` value, the persona-scoped memory file is created,
and the response reports ``persona``; (b) read-time defense in
``get_persona_memory_path`` so a legacy SOUL file that still carries
``memory: isolated`` is also routed to the persona-scoped file.

B-012 — frontmatter injection via ``description``/``tools``/``memory``.
The Pydantic ``Literal`` enum on ``CreatePersonaRequest.memory`` rejects
arbitrary strings, and ``yaml.safe_dump`` escapes quotes/newlines so an
attacker cannot inject a ``memory:`` key through ``description``.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

import agent.prompts as prompts
from api.routes import persona


# ── Shared fixtures ─────────────────────────────────────────────


@pytest.fixture
def persona_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Isolate PERSONAS_DIR in persona route to a tmp_path."""
    monkeypatch.setattr(persona, "PERSONAS_DIR", tmp_path)
    (tmp_path / "SOUL.md").write_text("default soul", encoding="utf-8")
    (tmp_path / "USER.md").write_text("original user", encoding="utf-8")
    return tmp_path


@pytest.fixture
def prompts_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Isolate agent.prompts path constants to a tmp_path."""
    personas_dir = tmp_path / "personas"
    personas_dir.mkdir()
    (personas_dir / "SOUL.md").write_text("# 默认人设\nbody\n", encoding="utf-8")
    (personas_dir / "memory.yaml").write_text("version: 1\n", encoding="utf-8")
    (personas_dir / "active_persona.yaml").write_text("file: SOUL.md\n", encoding="utf-8")
    monkeypatch.setattr(prompts, "PERSONAS_DIR", personas_dir)
    monkeypatch.setattr(prompts, "ACTIVE_PERSONA_PATH", personas_dir / "active_persona.yaml")
    prompts.invalidate_prompt_cache()
    return personas_dir


# ── B-011: isolated → persona normalization ─────────────────────


class TestB011IsolatedNormalization:
    async def test_isolated_creates_persona_scoped_memory_file(
        self, persona_dir: Path
    ) -> None:
        body = persona.CreatePersonaRequest(name="iso1", memory="isolated")
        resp = await persona.create_new_persona(body)

        # Response reports the canonical "persona" mode (not "isolated").
        assert resp["memory_mode"] == "persona"
        # The persona-scoped memory file is created alongside the SOUL file.
        mem = persona_dir / "memory_SOUL.iso1.yaml"
        assert mem.exists()
        assert mem.read_text(encoding="utf-8") == "{}\n"
        # No stray shared memory.yaml is created.
        assert not (persona_dir / "memory.yaml").exists()

    async def test_isolated_writes_canonical_persona_in_frontmatter(
        self, persona_dir: Path
    ) -> None:
        body = persona.CreatePersonaRequest(name="iso2", memory="isolated")
        await persona.create_new_persona(body)

        soul = (persona_dir / "SOUL.iso2.md").read_text(encoding="utf-8")
        # The stored frontmatter value is the canonical "persona" — not
        # "isolated". This is what makes the read-time check consistent.
        meta = prompts._parse_frontmatter(soul)
        assert meta.get("memory") == "persona"
        assert "isolated" not in soul  # no leftover alias anywhere

    def test_get_persona_memory_path_accepts_isolated_legacy(
        self, prompts_env: Path
    ) -> None:
        """A SOUL file written before the write-time normalization fix
        still carries ``memory: isolated``; the reader must route it to the
        persona-scoped memory file rather than silently falling back to
        shared ``memory.yaml``.
        """
        (prompts_env / "SOUL.md").write_text(
            "---\nmemory: isolated\n---\n# legacy\nbody\n", encoding="utf-8"
        )
        path = prompts.get_persona_memory_path()
        assert path.name == "memory_SOUL.yaml"
        assert path.parent == prompts_env

    def test_get_persona_memory_path_persona_still_works(self, prompts_env: Path) -> None:
        (prompts_env / "SOUL.md").write_text(
            "---\nmemory: persona\n---\n# 人设\nbody\n", encoding="utf-8"
        )
        path = prompts.get_persona_memory_path()
        assert path.name == "memory_SOUL.yaml"

    def test_get_persona_memory_path_shared_when_no_frontmatter(
        self, prompts_env: Path
    ) -> None:
        # No frontmatter at all → shared memory.yaml.
        path = prompts.get_persona_memory_path()
        assert path.name == "memory.yaml"

    def test_get_persona_memory_path_shared_for_unknown_mode(
        self, prompts_env: Path
    ) -> None:
        (prompts_env / "SOUL.md").write_text(
            "---\nmemory: shared\n---\nbody\n", encoding="utf-8"
        )
        path = prompts.get_persona_memory_path()
        assert path.name == "memory.yaml"


# ── B-012: Pydantic enum + frontmatter injection ─────────────────


class TestB012PydanticEnum:
    def test_memory_custom_rejected(self) -> None:
        with pytest.raises(ValidationError):
            persona.CreatePersonaRequest(name="bot", memory="custom")  # type: ignore[arg-type]

    def test_memory_arbitrary_string_rejected(self) -> None:
        with pytest.raises(ValidationError):
            persona.CreatePersonaRequest(name="bot", memory="shared\nmemory: persona")  # type: ignore[arg-type]

    def test_memory_valid_literals_accepted(self) -> None:
        for mode in ("shared", "persona", "isolated"):
            body = persona.CreatePersonaRequest(name="x", memory=mode)
            assert body.memory == mode


class TestB012FrontmatterInjection:
    async def test_description_cannot_inject_memory_key(
        self, persona_dir: Path
    ) -> None:
        """A description containing a quoted newline + `memory: persona`
        must be escaped by yaml.safe_dump so it stays a single scalar
        value rather than spawning a new frontmatter key.
        """
        malicious = 'x"\nmemory: persona'
        body = persona.CreatePersonaRequest(
            name="inject1", description=malicious, memory="shared"
        )
        resp = await persona.create_new_persona(body)
        assert resp["memory_mode"] == "shared"

        soul = (persona_dir / "SOUL.inject1.md").read_text(encoding="utf-8")
        meta = prompts._parse_frontmatter(soul)
        # The legitimate `memory` key is NOT present (we requested "shared"),
        # so the injected `memory: persona` line MUST NOT be honored as a key.
        assert "memory" not in meta, (
            "frontmatter injection succeeded: 'memory' key leaked from description"
        )
        # The description value is preserved verbatim (round-trips through
        # yaml.safe_dump / safe_load).
        assert meta["description"] == malicious

    async def test_tools_cannot_inject_memory_key(self, persona_dir: Path) -> None:
        malicious = "search\nmemory: persona"
        body = persona.CreatePersonaRequest(
            name="inject2", tools=malicious, memory="shared"
        )
        await persona.create_new_persona(body)

        soul = (persona_dir / "SOUL.inject2.md").read_text(encoding="utf-8")
        meta = prompts._parse_frontmatter(soul)
        assert "memory" not in meta
        assert meta["tools"] == malicious

    async def test_description_with_double_quotes_is_escaped(
        self, persona_dir: Path
    ) -> None:
        """Plain double-quotes in the description must not break the
        YAML structure or escape the surrounding scalar quoting.
        """
        body = persona.CreatePersonaRequest(
            name="quote1", description='he said "hi"'
        )
        await persona.create_new_persona(body)

        soul = (persona_dir / "SOUL.quote1.md").read_text(encoding="utf-8")
        # Round-trip through yaml to assert the value parses correctly.
        meta = prompts._parse_frontmatter(soul)
        assert meta["description"] == 'he said "hi"'

    async def test_unicode_description_preserved(self, persona_dir: Path) -> None:
        body = persona.CreatePersonaRequest(
            name="uc1", description="温暖体贴的大姐姐"
        )
        await persona.create_new_persona(body)
        soul = (persona_dir / "SOUL.uc1.md").read_text(encoding="utf-8")
        meta = prompts._parse_frontmatter(soul)
        assert meta["description"] == "温暖体贴的大姐姐"


# ── BC-003: production parser must honor YAML quoting ───────────


class TestBC003ProductionParserInjection:
    """Regression for BC-003: the production ``agent.prompts._parse_frontmatter``
    must honor YAML quoting so a multi-line single-quoted scalar in
    ``description`` cannot inject a ``memory:`` key.

    Round 4 Red's B-012 fix used ``yaml.safe_dump`` to serialize frontmatter
    (which correctly escapes values for a real YAML parser), but the production
    reader was still a naive line-by-line parser. ``yaml.safe_dump`` emits
    ``description = 'x"\\nmemory: persona'`` as a multi-line single-quoted
    scalar::

        description: 'x"

          memory: persona'

    The naive parser scanned each line independently, so it extracted both
    ``description='x'`` and ``memory='persona'`` — bypassing the memory
    isolation contract via ``get_persona_memory_path``. These tests pin the
    new ``yaml.safe_load``-based production parser so the divergence between
    test helper and production parser can never recur.
    """

    def test_production_parser_rejects_description_injection(self) -> None:
        """Exact Blue Team payload: ``description = 'x"\\nmemory: persona'``.

        After ``yaml.safe_dump`` → ``yaml.safe_load`` round-trip, the value
        stays a single scalar; no ``memory`` key leaks into the parsed dict.
        """
        malicious = 'x"\nmemory: persona'
        fm_dict = {"description": malicious}
        fm_yaml = yaml.safe_dump(
            fm_dict,
            sort_keys=False,
            default_flow_style=False,
            allow_unicode=True,
        ).strip()
        soul = f"---\n{fm_yaml}\n---\n\n# title\nbody\n"

        meta = prompts._parse_frontmatter(soul)
        assert "memory" not in meta, (
            f"frontmatter injection succeeded: 'memory' key leaked from "
            f"description; meta = {meta!r}"
        )
        # The description value is preserved verbatim, newline included.
        assert meta == {"description": malicious}

    def test_production_parser_rejects_tools_injection(self) -> None:
        """The tools injection vector from Blue's repro script."""
        malicious = "search\nmemory: persona"
        fm_dict = {"tools": malicious}
        fm_yaml = yaml.safe_dump(
            fm_dict,
            sort_keys=False,
            default_flow_style=False,
            allow_unicode=True,
        ).strip()
        soul = f"---\n{fm_yaml}\n---\n\n# title\nbody\n"

        meta = prompts._parse_frontmatter(soul)
        assert "memory" not in meta
        assert meta == {"tools": malicious}

    def test_get_persona_memory_path_shared_when_description_injects(
        self, prompts_env: Path
    ) -> None:
        """End-to-end: a SOUL file whose ``description`` contains the
        injected ``memory: persona`` payload must still route to the SHARED
        ``memory.yaml`` — because ``memory`` is NOT in the parsed
        frontmatter, ``get_persona_memory_path`` falls back to shared mode.
        """
        malicious = 'x"\nmemory: persona'
        fm_dict = {"description": malicious}
        fm_yaml = yaml.safe_dump(
            fm_dict,
            sort_keys=False,
            default_flow_style=False,
            allow_unicode=True,
        ).strip()
        soul = f"---\n{fm_yaml}\n---\n\n# title\nbody\n"
        (prompts_env / "SOUL.md").write_text(soul, encoding="utf-8")

        path = prompts.get_persona_memory_path()
        # Shared memory.yaml — NOT memory_SOUL.yaml — because `memory`
        # was never legitimately set in the frontmatter.
        assert path.name == "memory.yaml"
        assert path.parent == prompts_env

    def test_production_parser_preserves_multiline_block_scalar(self) -> None:
        """Sanity check: legitimate ``|`` and ``>`` block scalars still
        parse (lines joined with space, matching the historical contract
        encoded in ``tests/test_agent/test_prompts.py``).
        """
        text = "---\nname: Skill\ndescription: |\n  line one\n  line two\n---\nbody"
        meta = prompts._parse_frontmatter(text)
        assert meta["description"] == "line one line two"

        text = "---\nname: Skill\ndescription: >\n  folded\n  text\n---\nbody"
        meta = prompts._parse_frontmatter(text)
        assert meta["description"] == "folded text"

    def test_production_parser_returns_empty_on_malformed(self) -> None:
        """Malformed YAML must not raise — return ``{}`` instead."""
        # Unterminated single-quoted scalar.
        text = "---\ndescription: 'unterminated\n---\nbody"
        assert prompts._parse_frontmatter(text) == {}
        # Frontmatter that isn't a mapping at top level.
        text = "---\n- just\n- a\n- list\n---\nbody"
        assert prompts._parse_frontmatter(text) == {}
        # No frontmatter at all.
        assert prompts._parse_frontmatter("just body\nno frontmatter") == {}
