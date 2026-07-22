# Round 4 — Blue Team Mode Choice

**Mode**: Mixed (Mode B primary + Mode A scan)

## Reasoning

Round 4 Red fixed B-011 through B-015. Two of those (B-011, B-012) touch the
persona memory isolation contract and the frontmatter write/parse pipeline —
a security-sensitive area where fix-vs-test divergence is common. The
remaining three (B-013, B-014, B-015) are LOW-severity UX/logging issues with
narrow blast radius.

I prioritized **Mode B** against B-012 because:

1. **High-value target.** B-012 is MEDIUM severity and Red's fix touches two
   layers: (a) the Pydantic `Literal["shared","persona","isolated"]` enum on
   `CreatePersonaRequest.memory`, and (b) the switch from f-string
   interpolation to `yaml.safe_dump` for frontmatter serialization. Either
   layer can be challenged independently.

2. **Test-vs-production parser divergence is a known antipattern.** Red's
   regression tests in `tests/test_persona_memory_isolation.py` use a local
   `_parse_frontmatter` helper (line 211-220) that calls `yaml.safe_load` —
   NOT the production parser `agent.prompts._parse_frontmatter`. The
   production parser is a naive line-by-line parser that does NOT honor YAML
   quoting. Any fix that relies on `yaml.safe_dump` to escape values only
   works against real YAML parsers; the production parser will still split
   multi-line scalars into separate `key: value` lines and accept injected
   keys. This is exactly the class of bug that passes Red's tests but fails
   in production.

3. **Mode A scan was less productive.** I read `api/routes/sessions.py`,
   `skills.py`, `macros.py`, `chat.py`, `news.py`, `kb.py`, `tools.py`,
   `env_vars.py`, `deferred_runs.py`, `workflows.py`, `files.py`,
   `transcripts.py`, `maxma_blocker.py`, `event_hooks.py`, `metrics.py`,
   `audit_log.py`, `restart.py`, `sticker_favorites.py`, `stickers.py`,
   `mcp.py`, `path_whitelist.py`, `diagnostics.py`, `session_compress.py`,
   `autonomy.py`, `auth.py`, `yaml_store.py`, `interaction.py`, `health.py`,
   `session_manager.py`, `api/middleware/auth.py`, `agent/context_manager.py`,
   `agent/persona_loader.py`, `agent/memory/working_memory.py`, and
   `app_paths.py`. No new medium/high bug met the file:line evidence bar in
   these files. The codebase has hardened considerably over Rounds 1-3.

## Outcome

- **Mode B**: 1 confirmed challenge filed — **BC-003** (B-012 fix is
  incomplete; production parser still accepts injected `memory: persona`).
- **Mode A**: 0 new issues filed. No medium/high bug found in the scanned
  under-reviewed areas.

## Deliverables

- `rounds/round-4/blue/review.md` — BC-003 full write-up with evidence.
- `rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py` —
  standalone repro that simulates Red's `yaml.safe_dump` output and parses
  it with BOTH `yaml.safe_load` (Red's test helper) and the production
  `agent.prompts._parse_frontmatter`. Exit 1 = bug confirmed.
- `issues/blue-challenges.md` — BC-003 appended.

## Score claim

- BC-003 (if confirmed by arbiter): +5 (challenge against B-012).
- Total Round 4 Blue claim: **+5**.
