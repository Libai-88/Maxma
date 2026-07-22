# Round 5 — Red Team Handoff to Blue Team

**Status**: BC-003 fixed and verified. Blue repro script exits **0** (was 1).
Full pytest suite: **1853 passed, 7 skipped, 0 failed** in 22.86s.

👉 **Read the full report**: `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\rounds\round-5\red\report.md`

---

## What changed (2 files)

| File | Change |
|---|---|
| `agent/prompts.py` | Added top-level `import yaml`. Replaced the body of `_parse_frontmatter` with a `yaml.safe_load`-based implementation. The naive line-by-line parser is gone; YAML quoting is now honored natively, closing the multi-line single-quoted scalar injection vector. A small style-detection pass preserves the old "join lines with space" behavior for `\|` and `>` block scalars (legitimate input — required by `tests/test_agent/test_prompts.py`). |
| `tests/test_persona_memory_isolation.py` | Removed the local `_parse_frontmatter` helper (the `yaml.safe_load` wrapper that diverged from production). Updated all 5 existing call sites in `TestB011IsolatedNormalization` and `TestB012FrontmatterInjection` to call `prompts._parse_frontmatter(soul)` directly. Added new `TestBC003ProductionParserInjection` class with 5 regression tests. |

No other files touched.

---

## Verification

```
.venv\Scripts\python.exe .superma\20260720-101810-maxmahere\rounds\round-4\blue\patches\repro_b012_frontmatter_injection.py
# Exit code: 0  (was 1 before the fix)
# Final verdict line: "[NO BUG] Production parser correctly rejects injection."

.venv\Scripts\python.exe -m pytest tests/ --tb=short -q
# 1853 passed, 7 skipped in 22.86s
```

The +5 test count vs. Round 4 (1848 → 1853) matches exactly the 5 new tests
in `TestBC003ProductionParserInjection`. The 7 skipped tests are unchanged
platform-specific tests.

No regressions. No commits made (per arbiter-managed commit rule).

---

## Notes for Blue Team

1. **The fix is on the READ path, not the write path.** Round 4 Red's B-012
   fix correctly hardened `create_new_persona` with `yaml.safe_dump`, but
   the production reader `agent.prompts._parse_frontmatter` was still a
   naive line-by-line parser. Round 5 replaces that reader with
   `yaml.safe_load`. The write path is unchanged.

2. **The local test helper is GONE.** Round 4's
   `tests/test_persona_memory_isolation.py` defined a local
   `_parse_frontmatter` that wrapped `yaml.safe_load`, which is why the
   tests passed despite the production bug. That helper has been removed.
   Every existing B-011/B-012 test now calls `prompts._parse_frontmatter`
   directly, so any future regression in the production parser will fail
   these tests too — not just the new BC-003 tests.

3. **The `|` / `>` block-scalar style detection is intentional, not a
   shim.** `tests/test_agent/test_prompts.py::test_parse_frontmatter_multiline_block`
   asserts that `description: |\n  line one\n  line two` parses to
   `"line one line two"` (space-joined). `yaml.safe_load` natively returns
   `"line one\nline two"` (newlines preserved) for `|` block scalars. To
   preserve the historical contract encoded in that test (which we cannot
   modify per BC-003 scope), the new `_parse_frontmatter` detects `|`/`>`
   indicators via the regex `^(\w+)\s*:\s*[|>][-+]?\s*$` and joins the
   parsed value's newlines with spaces for those keys only. All other
   scalars (plain, single-quoted, double-quoted — including multi-line
   quoted scalars with embedded newlines) preserve `yaml.safe_load`'s
   native output verbatim. This is style detection only, NOT value
   parsing — the naive parser's edge cases (comments, quoted keys,
   multi-line scalars, etc.) are gone.

4. **The injection vector is fully closed.** The Blue Team payload
   `description = 'x"\nmemory: persona'` is serialized by `yaml.safe_dump`
   to a multi-line single-quoted scalar:
   ```
   description: 'x"

     memory: persona'
   ```
   `yaml.safe_load` parses this as `{'description': 'x"\nmemory: persona'}`
   — the newline is preserved INSIDE the description value, and no
   `memory` key appears in the parsed dict. The new regression test
   `test_production_parser_rejects_description_injection` pins this
   exact behavior.

5. **End-to-end behavior verified.** The new test
   `test_get_persona_memory_path_shared_when_description_injects` writes
   the malicious SOUL file to disk, calls `prompts.get_persona_memory_path()`,
   and asserts the result is `memory.yaml` (shared) — NOT
   `memory_SOUL.yaml` (persona-scoped) — because `memory` was never
   legitimately set in the frontmatter.

6. **Malformed YAML still returns `{}` (never raises).** The new
   `test_production_parser_returns_empty_on_malformed` test covers three
   cases: unterminated single-quoted scalar, non-mapping top level (a
   list), and no frontmatter at all. All return `{}` without raising.

---

## Files touched (absolute paths)

Source:
- `d:\Maxma\MaxmaHere\agent\prompts.py`

Tests:
- `d:\Maxma\MaxmaHere\tests\test_persona_memory_isolation.py`

Report:
- `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\rounds\round-5\red\report.md`

Handoff (this file):
- `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\rounds\round-5\red\handoff.md`
