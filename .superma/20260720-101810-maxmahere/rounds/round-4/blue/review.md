# Round 4 — Blue Team Review

**Scope**: Challenge Red's Round 4 fixes for B-011 through B-015 (Mode B),
plus a Mode A scan of under-reviewed API routes and agent modules.

**Result**: 1 confirmed challenge filed — **BC-003** (B-012 fix is
incomplete against the production frontmatter parser). 0 new Mode A issues.

---

## Summary table

| ID | Type | Target | Severity | Status | Repro |
|---|---|---|---|---|---|
| BC-003 | Mode B challenge | B-012 (MEDIUM) | MEDIUM | Confirmed | `patches/repro_b012_frontmatter_injection.py` |

---

## BC-003 — Red's B-012 fix uses `yaml.safe_dump` but the PRODUCTION parser `agent.prompts._parse_frontmatter` is a naive line-by-line parser that does NOT honor YAML quoting; frontmatter injection still succeeds at runtime

- **Target**: B-012 (MEDIUM) — `api/routes/persona.py:191-206` (Red's
  `yaml.safe_dump` fix) and `agent/prompts.py:311-338` (the production
  `_parse_frontmatter` parser that Red did NOT modify).
- **Claim**: Red's B-012 fix is incomplete. Red replaced f-string
  frontmatter construction with `yaml.safe_dump`, which correctly escapes
  values for a REAL YAML parser. But the PRODUCTION code path that reads
  SOUL files — `agent.prompts.get_persona_memory_path()` at line 350 —
  calls `_parse_frontmatter()` (lines 311-338), a naive line-by-line
  parser that does NOT honor YAML quoting. When `yaml.safe_dump` serializes
  a value containing a double-quote and newline (e.g. `'x"\nmemory: persona'`),
  it produces a multi-line single-quoted scalar:

  ```
  description: 'x"

    memory: persona'
  ```

  This is valid YAML — `yaml.safe_load` correctly parses it as the single
  scalar `x"\nmemory: persona`. But the production parser splits on lines
  and processes each `key: value` line independently:

  - Line 1: `description: 'x"` → `key="description"`, `val="'x\""`. The
    parser strips leading/trailing `'` and `"` (line 336:
    `meta[key] = val.strip('"').strip("'")`), yielding
    `meta["description"] = "x"`.
  - Line 2: empty (skipped).
  - Line 3: `  memory: persona'` → `key="memory"`, `val="persona'"`. The
    leading whitespace is stripped by `key = key.strip()` / `val = val.strip()`.
    The key `memory` IS in the whitelist at line 325
    (`if key in ("name", "description", "tools", "memory")`), so the parser
    sets `meta["memory"] = "persona'"`. The trailing `'` is stripped by
    `val.strip("'")`, yielding `meta["memory"] = "persona"`.

  Result: `meta = {"description": "x", "memory": "persona"}` — the injected
  `memory: persona` key is honored by the production parser. At line 356,
  `if meta.get("memory", "").strip().lower() in ("persona", "isolated"):`
  returns `True`, and `get_persona_memory_path()` returns
  `PERSONAS_DIR / f"memory_{persona_id}.yaml"` — even though the user
  requested `memory="shared"` in the API call.

  Red's regression tests in `tests/test_persona_memory_isolation.py` pass
  because the local `_parse_frontmatter` test helper (lines 211-220) calls
  `yaml.safe_load(block)` — a real YAML parser that correctly handles
  multi-line single-quoted scalars. Red never tested against the production
  parser. This is a textbook test-vs-production divergence.

- **Evidence**:
  - **Source of bug**: `agent/prompts.py:311-338` — the production
    `_parse_frontmatter` parser. Lines 319-337 iterate lines; for each line
    with `:`, partition into `key`/`val`; if `key in ("name", "description",
    "tools", "memory")`, set `meta[key] = val.strip('"').strip("'")`. There
    is NO handling for multi-line single-quoted scalars (only `|` and `>`
    block scalars at lines 326-334). Any line matching `key: value` is
    processed independently, regardless of whether it's a continuation of
    a previous multi-line scalar.
  - **Red's fix output**: `api/routes/persona.py:191-206` builds `fm_dict`
    and calls `yaml.safe_dump(fm_dict, sort_keys=False, default_flow_style=False,
    allow_unicode=True).strip()`. For `description = 'x"\nmemory: persona'`,
    PyYAML produces the multi-line single-quoted scalar shown above (verified
    by the repro script — Step 1 prints the exact `yaml.safe_dump` output).
  - **Production code path**: `agent/prompts.py:341-359` —
    `get_persona_memory_path()` reads the active SOUL file (line 349:
    `content = _read_persona(active_file)`), parses it with the production
    parser (line 350: `meta = _parse_frontmatter(content)`), and branches on
    `meta.get("memory", "")` at line 356. This is the runtime path that
    determines which memory file a persona uses.
  - **Red's test helper divergence**: `tests/test_persona_memory_isolation.py:211-220`:
    ```python
    def _parse_frontmatter(text: str) -> dict:
        """Parse the leading YAML frontmatter block (between ``---`` lines)."""
        if not text.startswith("---"):
            return {}
        end = text.find("\n---", 3)
        if end == -1:
            return {}
        block = text[3:end]
        data = yaml.safe_load(block)
        return data if isinstance(data, dict) else {}
    ```
    This calls `yaml.safe_load` — NOT `agent.prompts._parse_frontmatter`.
    Red's `TestB012FrontmatterInjection::test_description_cannot_inject_memory_key`
    (line 145-168) asserts `"memory" not in meta` using this helper. The
    assertion passes because `yaml.safe_load` correctly parses the multi-line
    single-quoted scalar as a single value. But the production parser would
    return `{"description": "x", "memory": "persona"}` — `"memory" IS in meta`.
  - **Repro output** (exit code 1 = bug confirmed):
    ```
    STEP 1: yaml.safe_dump output (what Red writes to disk)
    ---
    description: 'x"

      memory: persona'
    ---

    STEP 2: yaml.safe_load parse (Red's TEST helper)
      parsed = {'description': 'x"\nmemory: persona'}
      'memory' in parsed? False

    STEP 3: agent.prompts._parse_frontmatter parse (PRODUCTION)
      parsed = {'description': 'x', 'memory': 'persona'}
      'memory' in parsed? True

    STEP 4: tools injection vector (memory: shared + malicious tools)
    ---
    tools: 'search

      memory: persona'
    ---
      parsed = {'tools': 'search', 'memory': 'persona'}
      'memory' in parsed? True

    STEP 5: verdict
      [BUG CONFIRMED] Production parser STILL accepts injected
      'memory: persona' key — Red's B-012 fix is incomplete.
    ```
  - **Run**: `.venv\Scripts\python.exe .superma\20260720-101810-maxmahere/rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py`
    from project root. Exit code 1 = bug confirmed.

- **Severity**: MEDIUM. The injection bypasses the memory isolation contract
  enforced by the `CreatePersonaRequest.memory` Pydantic enum. A user who
  requests `memory="shared"` (shared memory across personas) can have their
  persona silently redirected to a persona-scoped memory file
  (`memory_{persona_id}.yaml`) if their `description` or `tools` field
  contains a newline followed by `memory: persona`. Conversely, a user who
  requests `memory="persona"` could have their description inject
  `memory: shared`, falling back to the shared `memory.yaml` and leaking
  data across personas. The attack requires no privileged position — any
  client that can call `POST /api/personas` can craft the malicious
  description. The bug is silent: the API returns HTTP 200 with
  `memory_mode: "shared"` (Red's write-time normalization at line 189 reports
  the requested value), but the runtime reads `memory: persona` from the
  injected frontmatter key. Severity is MEDIUM rather than HIGH because (a)
  the injection only affects the persona's own memory file selection, not
  cross-user data, and (b) the attack requires the user to deliberately
  craft a description containing a newline + `memory: persona` — not a
  realistic accidental input.

- **Why Red's verification missed it**: Red's `review.md` states "All
  special characters (double quotes, newlines, colons) are now escaped by
  PyYAML, so a crafted `description` cannot spawn a new frontmatter key."
  This is true for a real YAML parser, but Red never verified the claim
  against the production parser. Red's regression test
  `test_description_cannot_inject_memory_key` (line 145-168) uses the local
  `_parse_frontmatter` helper that calls `yaml.safe_load`, not the
  production `agent.prompts._parse_frontmatter`. The test passes because
  `yaml.safe_load` correctly handles multi-line single-quoted scalars, but
  the production parser does not. This is a test coverage gap: the test
  verifies the wrong parser.

- **Suggested fix**: Two options (either is sufficient):

  1. **Replace the production parser with `yaml.safe_load`** (preferred —
     eliminates the root cause). In `agent/prompts.py:311-338`, replace the
     naive line-by-line parser with:
     ```python
     def _parse_frontmatter(text: str) -> dict[str, str]:
         m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
         if not m:
             return {}
         data = yaml.safe_load(m.group(1))
         return data if isinstance(data, dict) else {}
     ```
     This makes the production parser consistent with Red's test helper
     and correctly handles all YAML scalar styles (single-quoted,
     double-quoted, block, plain). Add `import yaml` at module top (already
     present? verify — if not, add it).

  2. **Keep the naive parser but add multi-line scalar awareness** (minimal
     change). In `agent/prompts.py:319-337`, before processing a line, check
     if the previous line opened an unterminated single-quoted or
     double-quoted scalar (odd number of `'` or `"` characters). If so,
     skip the line as a continuation. This is fragile and not recommended —
     option 1 is strictly better.

  Additionally, update Red's regression test to call the PRODUCTION parser,
  not the `yaml.safe_load` helper. Replace
  `tests/test_persona_memory_isolation.py:211-220` with:
  ```python
  from agent.prompts import _parse_frontmatter  # use the production parser
  ```
  and delete the local helper. This ensures the test verifies the actual
  code path that runs in production.

- **Verification**: Run
  `.venv\Scripts\python.exe .superma\20260720-101810-maxmahere/rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py`
  from project root.
  - Pre-fix: exit 1, output shows `prod_parsed = {'description': 'x', 'memory': 'persona'}` — injection succeeds.
  - Post-fix (option 1): exit 0, output shows `prod_parsed = {'description': 'x"\nmemory: persona'}` — injection blocked, and `'memory' in prod_parsed` is `False`.

- **Score claim**: +5 (confirmed challenge against B-012).

---

## Mode A scan results

I read the following under-reviewed files looking for new medium/high bugs:

- `api/routes/`: `sessions.py`, `skills.py`, `macros.py`, `chat.py`,
  `news.py`, `kb.py`, `tools.py`, `env_vars.py`, `deferred_runs.py`,
  `workflows.py`, `files.py`, `transcripts.py`, `maxma_blocker.py`,
  `event_hooks.py`, `metrics.py`, `audit_log.py`, `restart.py`,
  `sticker_favorites.py`, `stickers.py`, `mcp.py`, `path_whitelist.py`,
  `diagnostics.py`, `session_compress.py`, `autonomy.py`
- `api/`: `auth.py`, `yaml_store.py`, `interaction.py`, `health.py`,
  `session_manager.py`
- `api/middleware/`: `auth.py`
- `agent/`: `context_manager.py`, `persona_loader.py`, `memory/working_memory.py`
- `app_paths.py`

No new medium/high bug met the file:line evidence bar. The codebase has
hardened considerably over Rounds 1-3: input validation, path whitelisting,
async locking, and the MaxmaBlocker pattern are consistently applied.
Notable strong points observed:

- `api/middleware/auth.py` correctly exempts only GET/HEAD on
  `/api/stickers/{category}/{filename}` (lines 45-51) and requires auth for
  POST/PUT/DELETE and single-segment paths like `/api/stickers/favorites`.
- `api/session_manager.py:139-175` correctly cancels `_active_task` outside
  the lock (line 150-158) and propagates cancellation to deferred/workflow
  run managers.
- `api/routes/stickers.py` validates `category` and `filename` with
  `re.match(r'^[\w\u4e00-\u9fff\-]+$', category)` (line 56) and
  `re.match(r'^[\w\-]+\.webp$', filename)` (line 58), and resolves paths
  with `.startswith(str(STICKERS_DIR.resolve()))` (line 76) to prevent
  traversal.

0 new issues filed from Mode A.

---

## Score claim summary

- BC-003 (if confirmed): +5
- **Round 4 Blue total claim: +5**

Per the contest termination rule, Round 4 Blue produced 1 confirmed
challenge (medium-equivalent), so the contest does NOT terminate — it
proceeds to Round 5 Red.
