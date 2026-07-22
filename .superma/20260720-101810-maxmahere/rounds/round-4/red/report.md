# Round 4 — Red Team Report

**Scope**: Fix the 5 open Blue Team issues from Round 3 (B-011 through B-015).

**Result**: All 5 issues fixed. Full pytest suite passes: **1848 passed, 7 skipped, 0 failed** in 24.78s.

---

## Summary table

| Issue | Severity | File(s) modified | Regression test |
|---|---|---|---|
| B-011 | MEDIUM | `api/routes/persona.py`, `agent/prompts.py` | `tests/test_persona_memory_isolation.py::TestB011IsolatedNormalization` (6 tests) |
| B-012 | MEDIUM | `api/routes/persona.py` | `tests/test_persona_memory_isolation.py::TestB012PydanticEnum` (3) + `TestB012FrontmatterInjection` (4) |
| B-013 | LOW    | `api/routes/upload.py` | `tests/test_api/test_upload.py::TestSanitizeFilename` (6, updated) |
| B-014 | LOW    | `web/src/composables/useChat.ts` | (comment-only; no test) |
| B-015 | LOW    | `api/routes/sticker_upload.py` | (existing `TestConvertToWebp::test_convert_invalid_input_returns_false` exercises the path) |

---

## B-011 — `memory: "isolated"` silently falls back to shared memory

### Root cause
`create_new_persona` accepted `memory="isolated"` and created `memory_{persona_id}.yaml`,
but `get_persona_memory_path()` in `agent/prompts.py` only checked
`meta.get("memory") == "persona"`. An isolated-mode persona therefore
read/wrote the shared `memory.yaml`, leaking memory across personas; the
persona-scoped file created at write time was orphaned.

### Fix (defense in depth — both write-time and read-time)
- **`api/routes/persona.py:185-189`** — At write time, normalize
  `memory == "isolated"` to the canonical `"persona"` before writing
  frontmatter, creating the memory file, and reporting the response. This
  makes the stored SOUL frontmatter consistent with the read-time check
  regardless of which alias the client used.
- **`agent/prompts.py:356`** — At read time, accept both `"persona"` and
  `"isolated"` (`in ("persona", "isolated")`) so legacy SOUL files written
  before the write-time fix still resolve to the persona-scoped memory file
  instead of silently falling back to shared `memory.yaml`.

### Files modified
- `d:\Maxma\MaxmaHere\api\routes\persona.py`
- `d:\Maxma\MaxmaHere\agent\prompts.py`

### Diff description
```python
# api/routes/persona.py (create_new_persona)
+ effective_memory = "persona" if body.memory == "isolated" else body.memory
- if body.memory and body.memory != "shared":
-     fm_lines.append(f"memory: {body.memory}")
+ if effective_memory != "shared":
+     fm_dict["memory"] = effective_memory
- if body.memory in ("persona", "isolated"):
+ if effective_memory == "persona":
      ...create memory_{persona_id}.yaml...
- "memory_mode": body.memory,
+ "memory_mode": effective_memory,
```

```python
# agent/prompts.py (get_persona_memory_path)
- if meta.get("memory", "").strip().lower() == "persona":
+ if meta.get("memory", "").strip().lower() in ("persona", "isolated"):
```

### Verification
```
tests/test_persona_memory_isolation.py::TestB011IsolatedNormalization
  test_isolated_creates_persona_scoped_memory_file           PASSED
  test_isolated_writes_canonical_persona_in_frontmatter      PASSED
  test_get_persona_memory_path_accepts_isolated_legacy      PASSED
  test_get_persona_memory_path_persona_still_works          PASSED
  test_get_persona_memory_path_shared_when_no_frontmatter    PASSED
  test_get_persona_memory_path_shared_for_unknown_mode      PASSED
```

---

## B-012 — Persona creation YAML frontmatter injection

### Root cause
`description` / `tools` / `memory` were interpolated into the YAML
frontmatter via f-strings (`f'description: "{body.description}"'`). A
malicious `description = 'x"\nmemory: persona'` injected a new `memory:`
key that overrode the legitimate one — bypassing the memory isolation
contract. Additionally, `memory` was typed as `str`, allowing arbitrary
strings like `"custom"`.

### Fix
- **`api/routes/persona.py:8, 60-63`** — Added `from typing import Literal`
  and changed the `CreatePersonaRequest.memory` field to
  `Literal["shared", "persona", "isolated"]`. Pydantic now rejects any
  other value at request-validation time (HTTP 422).
- **`api/routes/persona.py:191-206`** — Replaced f-string frontmatter
  construction with a dict + `yaml.safe_dump(..., sort_keys=False,
  default_flow_style=False, allow_unicode=True)`. All special characters
  (double quotes, newlines, colons) are now escaped by PyYAML, so a
  crafted `description` cannot spawn a new frontmatter key. The body
  template (which is markdown, not YAML) still uses f-strings, which is
  safe — markdown has no key/value semantics the parser cares about.

### Files modified
- `d:\Maxma\MaxmaHere\api\routes\persona.py`

### Diff description
```python
+ from typing import Literal
+ import yaml

  class CreatePersonaRequest(BaseModel):
      name: str
      description: str = ""
      tools: str = ""
-     memory: str = "shared"
+     memory: Literal["shared", "persona", "isolated"] = "shared"

  # inside create_new_persona
- fm_lines = ["---"]
- if body.description:
-     fm_lines.append(f'description: "{body.description}"')
- if body.tools:
-     fm_lines.append(f"tools: {body.tools}")
- if body.memory and body.memory != "shared":
-     fm_lines.append(f"memory: {body.memory}")
- fm_lines.append("---")
- fm_lines.append("")
+ fm_dict: dict[str, str] = {}
+ if body.description:
+     fm_dict["description"] = body.description
+ if body.tools:
+     fm_dict["tools"] = body.tools
+ if effective_memory != "shared":
+     fm_dict["memory"] = effective_memory
+ fm_yaml = yaml.safe_dump(
+     fm_dict, sort_keys=False, default_flow_style=False, allow_unicode=True
+ ).strip()
+ fm_block = f"---\n{fm_yaml}\n---\n\n" if fm_yaml else "---\n---\n\n"
```

### Updated existing tests (encoded the old vulnerable behavior)
- `tests/test_api/test_persona_routes_extra.py::TestCreateNewPersona::test_create_with_description_and_tools`
  — Updated assertions to match the new unquoted YAML format
  (`description: a helpful bot` instead of `description: "a helpful bot"`).
- `tests/test_api/test_persona_routes_extra.py::TestCreateNewPersona::test_create_with_custom_memory_not_persona`
  — Replaced with `test_create_with_invalid_memory_mode_rejected_by_pydantic`,
  which asserts that `memory="custom"` now raises `pydantic.ValidationError`.

### Verification
```
tests/test_persona_memory_isolation.py::TestB012PydanticEnum
  test_memory_custom_rejected                            PASSED
  test_memory_arbitrary_string_rejected                 PASSED
  test_memory_valid_literals_accepted                    PASSED

tests/test_persona_memory_isolation.py::TestB012FrontmatterInjection
  test_description_cannot_inject_memory_key             PASSED
  test_tools_cannot_inject_memory_key                    PASSED
  test_description_with_double_quotes_is_escaped         PASSED
  test_unicode_description_preserved                     PASSED
```

The `test_description_cannot_inject_memory_key` test uses the exact
payload from the Blue Team bug report (`'x"\nmemory: persona'`) and
asserts that no `memory` key leaks into the parsed frontmatter.

---

## B-013 — `_sanitize_filename` strips all non-ASCII; Chinese filenames become dotfiles

### Root cause
`re.sub(r"[^a-zA-Z0-9._-]", "", name)` stripped every non-ASCII character.
`报告.pdf` → `.pdf` (a dotfile, hidden on Unix and confusing in the UI).

### Fix
- **`api/routes/upload.py:36-62`** — Widened the regex to
  `re.sub(r"[^\w.\-]", "", name, flags=re.UNICODE)`, which keeps Unicode
  letters/digits/underscore (CJK, Cyrillic, emoji, etc.) while still
  removing spaces, control chars, and shell metacharacters. Path
  separators (`/` and `\`) are explicitly stripped in a separate
  `re.sub(r"[\\/]+", "", name)` pass first, as defense in depth —
  `\w` already excludes them, but the explicit pass makes the intent
  obvious and survives any future regex widening. The Windows reserved
  name guard (`CON`/`NUL`/`LPT1`/etc.) is unchanged.

### Files modified
- `d:\Maxma\MaxmaHere\api\routes\upload.py`

### Diff description
```python
  def _sanitize_filename(name: str) -> str:
      name = Path(name).name
-     safe = re.sub(r"[^a-zA-Z0-9._-]", "", name)
+     name = re.sub(r"[\\/]+", "", name)  # defense in depth
+     safe = re.sub(r"[^\w.\-]", "", name, flags=re.UNICODE)
      ...
```

### Updated existing tests (encoded the old buggy behavior)
- `tests/test_api/test_upload.py::TestSanitizeFilename::test_strips_unicode_and_spaces`
  — Renamed to `test_strips_spaces`, asserts only that spaces are still
  stripped (Unicode letters are now preserved).
- `tests/test_api/test_upload.py::TestSanitizeFilename::test_strips_chinese_chars`
  — Replaced with `test_keeps_unicode_letters`, which asserts
  `_sanitize_filename("报告.pdf") == "报告.pdf"` and
  `_sanitize_filename("文件 名.py") == "文件名.py"`.
- Added `test_strips_path_separators` to verify the defense-in-depth
  separator stripping.
- `test_empty_after_sanitization_returns_default` — tightened to only
  assert the default fallback for truly empty/whitespace names
  (`""` and `"   "`), since `"中文"` is now a valid filename.

### Verification
```
tests/test_api/test_upload.py::TestSanitizeFilename
  test_strips_spaces                                       PASSED
  test_keeps_unicode_letters                                PASSED
  test_keeps_allowed_chars                                  PASSED
  test_windows_reserved_name_gets_prefix                    PASSED
  test_strips_path_separators                               PASSED
  test_empty_after_sanitization_returns_default             PASSED
```

---

## B-014 — `useChat.ts` QuotaExceededError eviction is FIFO, not LRU

### Root cause
The inline comment claimed LRU ("最近未使用" / "least recently used")
but the implementation iterates `localStorage` in insertion order and
drops the first half — i.e. FIFO. No access timestamp is tracked.

### Fix (simpler option per task description)
- **`web/src/composables/useChat.ts:75-79`** — Corrected the misleading
  comment to accurately describe the FIFO eviction policy. No behavior
  change (the simpler of the two options the task allowed).

### Files modified
- `d:\Maxma\MaxmaHere\web\src\composables\useChat.ts`

### Diff description
```typescript
-     // 收集除当前 sid 外的所有 turns 缓存键，按"最近未使用"策略删除最旧的
+     // B-014: collect every other session's turns cache key. Eviction is
+     // FIFO by localStorage insertion order (the iteration order returned by
+     // localStorage.key(i) reflects insertion order in modern browsers), NOT
+     // LRU — we do not track access timestamps. The first half of the
+     // oldest-inserted keys is dropped to make room for the current write.
```

### Verification
No automated test (frontend file, no vitest scope here per task rules).
Verified by manual inspection of the surrounding code: the implementation
matches the corrected comment.

---

## B-015 — `sticker_upload.py _convert_to_webp` uses `print()` instead of `logger`

### Root cause
`print(f"[sticker_upload] 转换失败: {e}")` writes to stdout, bypassing the
structured logging pipeline (no level, no module, no traceback).

### Fix
- **`api/routes/sticker_upload.py:3-13, 68-69`** — Added
  `import logging` and `logger = logging.getLogger(__name__)` at module
  top, and replaced `print(f"[sticker_upload] 转换失败: {e}")` with
  `logger.exception("转换失败")`. `logger.exception` automatically
  attaches the full traceback at ERROR level.

### Files modified
- `d:\Maxma\MaxmaHere\api\routes\sticker_upload.py`

### Diff description
```python
+ import logging
  ...
+ logger = logging.getLogger(__name__)
  ...
  except Exception as e:
-     print(f"[sticker_upload] 转换失败: {e}")
+     logger.exception("转换失败")
      return False
```

### Verification
```
tests/test_api/test_sticker_upload.py::TestConvertToWebp::test_convert_invalid_input_returns_false  PASSED
tests/test_api/test_sticker_upload_extra.py::TestConvertGif                                          PASSED (3 tests)
```
The existing `test_convert_invalid_input_returns_false` test feeds an
invalid PNG to `_convert_to_webp` and asserts it returns `False`,
exercising the modified `except` branch.

---

## Test suite verification

### Full suite
Command (run from `d:\Maxma\MaxmaHere`):
```
.venv\Scripts\python.exe -m pytest tests/ --tb=short -q
```

Output:
```
........................................................................ [  3%]
........................................................................ [  7%]
... (truncated) ...
..........................s............................................. [ 93%]
........................................................................ [ 97%]
.............................................                           [100%]
1848 passed, 7 skipped in 24.78s
```

**Result: 1848 passed, 7 skipped, 0 failed.** No regression.

### New regression tests added
- `d:\Maxma\MaxmaHere\tests\test_persona_memory_isolation.py` — 13 tests
  covering B-011 (6 tests: isolated normalization + read-time legacy
  handling + shared-mode fallthrough) and B-012 (7 tests: Pydantic enum
  rejection + frontmatter injection payloads for description/tools +
  double-quote and Unicode preservation).

```
tests/test_persona_memory_isolation.py
  TestB011IsolatedNormalization
    test_isolated_creates_persona_scoped_memory_file            PASSED
    test_isolated_writes_canonical_persona_in_frontmatter       PASSED
    test_get_persona_memory_path_accepts_isolated_legacy       PASSED
    test_get_persona_memory_path_persona_still_works           PASSED
    test_get_persona_memory_path_shared_when_no_frontmatter     PASSED
    test_get_persona_memory_path_shared_for_unknown_mode       PASSED
  TestB012PydanticEnum
    test_memory_custom_rejected                                 PASSED
    test_memory_arbitrary_string_rejected                        PASSED
    test_memory_valid_literals_accepted                          PASSED
  TestB012FrontmatterInjection
    test_description_cannot_inject_memory_key                    PASSED
    test_tools_cannot_inject_memory_key                          PASSED
    test_description_with_double_quotes_is_escaped               PASSED
    test_unicode_description_preserved                           PASSED

============================= 13 passed in 1.27s ==============================
```

### Existing tests updated (encoded old buggy behavior)
- `tests/test_api/test_persona_routes_extra.py` — 2 tests updated:
  `test_create_with_description_and_tools` (assertion format) and
  `test_create_with_custom_memory_not_persona` → `test_create_with_invalid_memory_mode_rejected_by_pydantic`.
- `tests/test_api/test_upload.py::TestSanitizeFilename` — 5 tests
  updated/added to reflect Unicode preservation, including the explicit
  `_sanitize_filename("报告.pdf") == "报告.pdf"` regression case.

---

## Out of scope
No files outside the 5 issue scopes were modified. No backwards-compat
shims added. No git commits made (per arbiter-managed commit rule).
