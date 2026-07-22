# Round 4 — Red Team Handoff to Blue Team

**Status**: All 5 open Blue issues (B-011 → B-015) are fixed and verified.
Full pytest suite: **1848 passed, 7 skipped, 0 failed** in 24.78s.

👉 **Read the full report**: `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\rounds\round-4\red\report.md`

---

## What changed

### Source fixes (4 files)

| File | Issue | Change |
|---|---|---|
| `api/routes/persona.py` | B-011 + B-012 | Added `from typing import Literal` and `import yaml`; changed `CreatePersonaRequest.memory` to `Literal["shared","persona","isolated"]`; normalized `isolated`→`persona` at write time; replaced f-string frontmatter with `yaml.safe_dump` for safe escaping. |
| `agent/prompts.py` | B-011 | `get_persona_memory_path` now accepts both `"persona"` and `"isolated"` at read time (defense in depth for legacy SOUL files). |
| `api/routes/upload.py` | B-013 | `_sanitize_filename` regex widened from `[^a-zA-Z0-9._-]` to `[^\w.\-]` with `re.UNICODE`, preserving CJK/Unicode filenames. Explicit `[\\/]` strip pass for defense in depth. |
| `web/src/composables/useChat.ts` | B-014 | Corrected misleading LRU comment to FIFO (no behavior change — simpler of two allowed fixes). |
| `api/routes/sticker_upload.py` | B-015 | Added `import logging; logger = logging.getLogger(__name__)`; replaced `print(f"[sticker_upload] 转换失败: {e}")` with `logger.exception("转换失败")`. |

### Tests added/updated

- **NEW** `tests/test_persona_memory_isolation.py` — 13 regression tests for B-011 + B-012.
  - `TestB011IsolatedNormalization` (6 tests): write-time normalization, frontmatter canonicalization, read-time legacy `isolated` handling, shared-mode fallthrough.
  - `TestB012PydanticEnum` (3 tests): `memory="custom"` and arbitrary strings rejected; valid literals accepted.
  - `TestB012FrontmatterInjection` (4 tests): the exact Blue Team payload `'x"\nmemory: persona'` cannot inject a `memory:` key; double-quotes and Unicode descriptions round-trip correctly.

- **UPDATED** `tests/test_api/test_persona_routes_extra.py`:
  - `test_create_with_description_and_tools` — assertions updated for new unquoted YAML format.
  - `test_create_with_custom_memory_not_persona` → `test_create_with_invalid_memory_mode_rejected_by_pydantic` (the old test asserted the now-invalid `memory="custom"` was accepted).

- **UPDATED** `tests/test_api/test_upload.py::TestSanitizeFilename`:
  - `test_strips_unicode_and_spaces` → `test_strips_spaces` (only spaces stripped; Unicode preserved).
  - `test_strips_chinese_chars` → `test_keeps_unicode_letters` (now asserts `_sanitize_filename("报告.pdf") == "报告.pdf"`).
  - Added `test_strips_path_separators`.
  - Tightened `test_empty_after_sanitization_returns_default` to only assert default for truly empty/whitespace names.

---

## Verification

```
.venv\Scripts\python.exe -m pytest tests/ --tb=short -q
1848 passed, 7 skipped in 24.78s
```

No regressions. No commits made (per arbiter-managed commit rule).

---

## Notes for Blue Team

1. **B-011 was fixed at BOTH write and read time** — the write-time normalization in `create_new_persona` makes the stored frontmatter always carry the canonical `"persona"` value, and the read-time check in `get_persona_memory_path` also accepts `"isolated"` as a legacy alias. This is intentional defense in depth: any SOUL file written before this fix (with `memory: isolated` in its frontmatter) will still resolve to the persona-scoped memory file rather than silently falling back to shared `memory.yaml`.

2. **B-012 changed the wire format for the `description` field** — simple strings like `"a helpful bot"` are now emitted by `yaml.safe_dump` as `description: a helpful bot` (unquoted), not `description: "a helpful bot"`. The existing test was updated accordingly. If any frontend code parses the SOUL frontmatter and expects double quotes, it should switch to a YAML parser (`yaml.safe_load`).

3. **B-012's Pydantic enum will reject any `memory` value other than `"shared"`, `"persona"`, or `"isolated"`** with a 422 Validation Error. If the frontend currently sends any other value, it must be updated. (Per the bug report, the frontend `PersonaMemoryMode` type is already restricted to `'shared' | 'isolated'`, so this should be a no-op for legitimate callers.)

4. **B-013's `_sanitize_filename` now preserves Unicode letters** — `报告.pdf` stays `报告.pdf`. The Windows reserved-name guard is unchanged. Path separators are explicitly stripped in a separate regex pass before the Unicode-aware strip, so traversal attempts like `a/b\c.pdf` cannot survive as `abc.pdf`.

5. **B-014 chose the simpler fix** (comment correction) per the task's "pick the simpler fix" instruction. If you want true LRU later, the right place to add an access-timestamp map is next to `turnsCache` in `useChat.ts`, and the eviction site at line 80-90 — but this is out of scope for the bug.

6. **B-015's `logger.exception("转换失败")`** auto-attaches the full traceback at ERROR level. No need to interpolate `e` manually — `logger.exception` does it.

---

## Files touched (absolute paths)

Source:
- `d:\Maxma\MaxmaHere\api\routes\persona.py`
- `d:\Maxma\MaxmaHere\agent\prompts.py`
- `d:\Maxma\MaxmaHere\api\routes\upload.py`
- `d:\Maxma\MaxmaHere\web\src\composables\useChat.ts`
- `d:\Maxma\MaxmaHere\api\routes\sticker_upload.py`

Tests:
- `d:\Maxma\MaxmaHere\tests\test_persona_memory_isolation.py` (NEW)
- `d:\Maxma\MaxmaHere\tests\test_api\test_persona_routes_extra.py` (UPDATED)
- `d:\Maxma\MaxmaHere\tests\test_api\test_upload.py` (UPDATED)

Report:
- `d:\Maxma\MaxmaHere\.superma\20260720-101810-maxmahere\rounds\round-4\red\report.md`
