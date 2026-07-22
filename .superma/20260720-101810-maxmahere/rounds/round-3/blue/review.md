# Round 3 Blue Team Review — Mode A (New Bugs)

## Meta
- **Mode chosen**: A (find new bugs)
- **Rationale**: See `mode-choice.md`. Red's BC-001/BC-002 fixes are arbiter-verified with passing repros and 1834/7-skip pytest; speculative Mode B angles (Windows drive-letter isPathLike, try/catch leak-safety, no-op UI mislead) had low expected yield. Many under-reviewed surface areas remained.
- **Scope audited** (files read in full this round):
  - `api/routes/`: persona.py, news.py, upload.py, sticker_upload.py, sticker_favorites.py, stickers.py, skills.py, env_vars.py, diagnostics.py, restart.py, files.py, transcripts.py, activity.py, audit_log.py, event_hooks.py, kb.py, metrics.py, workflows.py, deferred_runs.py
  - `api/middleware/`: auth.py, rate_limit.py
  - `api/`: session_manager.py, activity_hub.py, ws_registry.py, yaml_store.py
  - `agent/`: prompts.py (lines 318-378), persona_loader.py, context_manager.py
  - `web/src/`: composables/useChat.ts (lines 1-355), components/RenderMarkdown.vue, components/AutocompletePanel.vue, components/tools/PythonBubble.vue, utils/markdown.ts, utils/python-highlight.ts
  - `desktop/src-tauri/src/main.rs` (lines 1-405)
  - `config/settings.py`
- **Issues filed**: 5 (B-011 … B-015)
- **Score claim**: 0 HIGH + 2 MEDIUM + 3 LOW = **7 points** if all verified.

## Issues filed this round

| ID    | Priority | Title                                                                                                  | Score |
| ----- | -------- | ------------------------------------------------------------------------------------------------------ | ----- |
| B-011 | MEDIUM   | Persona `memory: "isolated"` silently falls back to shared `memory.yaml` — isolation contract broken  | +2    |
| B-012 | MEDIUM   | Persona creation YAML frontmatter injection via unescaped `description`/`tools`/`memory` (key override)| +2    |
| B-013 | LOW      | `upload.py _sanitize_filename` strips all non-ASCII; Chinese filenames become dotfiles (`.pdf`)         | +1    |
| B-014 | LOW      | `useChat.ts` QuotaExceededError eviction is FIFO, not LRU as documented; old active sessions evicted   | +1    |
| B-015 | LOW      | `sticker_upload.py _convert_to_webp` uses `print()` instead of `logger`; failures invisible in logs    | +1    |

## Issue details

### B-011 — Persona `memory: "isolated"` silently falls back to shared memory (MEDIUM)
- **Files**: `api/routes/persona.py:212,188`; `agent/prompts.py:352`
- **Bug**: `create_new_persona` accepts `memory: "isolated"` and creates `memory_{persona_id}.yaml`, but `get_persona_memory_path()` only checks `== "persona"`, so `isolated`-mode personas silently use shared `memory.yaml`. The orphaned persona-scoped file is never read.
- **Impact**: Cross-persona memory leakage. A "work" persona and "personal" persona both with `memory: isolated` actually share one `memory.yaml`. User's explicit isolation selection is silently ignored — no error, no warning, no log.
- **Fix**: Normalize `"isolated"` → `"persona"` at write time, OR accept both at read time (`in ("persona", "isolated")`), OR add a shared enum. Add a regression test.

### B-012 — Persona creation YAML frontmatter injection (MEDIUM)
- **Files**: `api/routes/persona.py:184,186,188,55-60`
- **Bug**: `description`/`tools`/`memory` are interpolated into YAML frontmatter via f-strings without escaping. `description = 'x"\nmemory: persona'` injects a `memory: persona` line that the line-by-line parser in `_parse_frontmatter` picks up, overriding the user's selected memory mode. `tools` field with newline can widen the tool restriction set. `memory` field has no Pydantic enum constraint.
- **Impact**: Data corruption (truncated descriptions for legitimate users with `"` in text) + silent key override (malicious or accidental multi-line values can override `memory`/`tools`/`name` frontmatter keys, since the parser is last-write-wins on duplicate keys).
- **Fix**: (1) Constrain `memory` to `Literal["shared","persona","isolated"]`; (2) use `yaml.safe_dump` for frontmatter values; (3) add a test with `description` containing `"` and `\n`.

### B-013 — `_sanitize_filename` strips non-ASCII (LOW)
- **Files**: `api/routes/upload.py:40`
- **Bug**: `re.sub(r"[^a-zA-Z0-9._-]", "", name)` removes all non-ASCII. `报告.pdf` → `.pdf` (dotfile, no stem). User sees `filename: ".pdf"` in API response.
- **Impact**: UX — Chinese/Japanese/Korean filenames become unusable for identification. Stored files work but display names are lost. Not a security issue (the file_id prefix prevents collisions).
- **Fix**: Widen regex to `[^\w.\u4e00-\u9fff\-]` with `re.UNICODE`, mirroring the convention in `sticker_favorites.py:21`.

### B-014 — localStorage eviction is FIFO, not LRU (LOW)
- **Files**: `web/src/composables/useChat.ts:75-90`
- **Bug**: Comment on line 75 claims `"最近未使用策略"` (LRU), but implementation iterates `localStorage.key(i)` in insertion order (per Web Storage spec) and `slice(0, N/2)` takes the oldest-inserted half. Line 83's comment `"近似 FIFO"` contradicts line 75.
- **Impact**: Frequently-used old sessions get evicted before recently-created but unused sessions. After eviction, the old session's turns disappear from `localStorage` until backend re-streams (if still available). Only triggers on QuotaExceededError.
- **Fix**: Maintain a separate `maxma:turns:lru` access-log key, or correct the misleading LRU comment.

### B-015 — `_convert_to_webp` uses `print()` for errors (LOW)
- **Files**: `api/routes/sticker_upload.py:66`
- **Bug**: PIL exceptions caught in `_convert_to_webp` are reported via `print()`, not the module logger. The module doesn't import `logging` or declare a `logger`. Caller raises generic `HTTPException(500, "图片转换失败")` with no root cause.
- **Impact**: Sticker upload failures are invisible in server log files (`logs/server.log`). Developers can't debug user-reported "sticker upload broken" tickets without reproducing locally. Violates the project convention that all backend modules use `logging.getLogger(__name__)`.
- **Fix**: Add `import logging; logger = logging.getLogger(__name__)`, replace `print` with `logger.exception(...)`.

## Areas audited but found clean (no bug filed)

These were checked and either had no issues or had only minor nits below the filing bar:

- **`api/middleware/auth.py`**: Token extraction via `X-Maxma-Token` or WS subprotocol; `hmac.compare_digest` for constant-time comparison; min-length 8 + no-leading-dash on subprotocol tokens. Sticker GET exemption (`len(parts) >= 2`) is intentional and bounded by regex validation in `stickers.py`. No bypass found.
- **`api/routes/stickers.py`**: Regex validation on `category` (`^[\w\u4e00-\u9fff\-]+$`) and `filename` (`^[\w\-]+\.webp$`), plus `.resolve().startswith(...)` defense-in-depth. No path traversal.
- **`api/routes/sticker_favorites.py`**: `_validate_sticker_ref` shared by all endpoints; YAML load/save via `yaml.safe_load`/`yaml.dump`. Clean.
- **`api/routes/transcripts.py`**: `_ALLOWED_CATEGORIES` frozenset + `os.path.normpath` + `..`/`/`/`\\` rejection + `.resolve().startswith(...)`. Triple defense. Clean.
- **`api/routes/env_vars.py`**: `ENV_VAR_META` whitelist gates all writes; `set_key` from python-dotenv handles `.env` formatting. No arbitrary env var injection.
- **`api/routes/diagnostics.py`**: Log cleanup only deletes `maxma.log.*`/`tauri.log.*`/`*.log.old` patterns; protected names `maxma.log`/`tauri.log` skipped. No arbitrary file deletion.
- **`api/routes/restart.py`**: `sys.exit(0)` in frozen mode (Tauri sidecar monitor restarts); dev mode uses `subprocess.Popen` with `CREATE_NEW_CONSOLE`. No injection (no user input).
- **`api/routes/news.py`**: `yaml.safe_load` on static file; `NewsEntry` Pydantic model validates. Clean.
- **`api/routes/skills.py`**: `_SKILL_ID_RE = ^[A-Za-z0-9_\-]+$` validates all IDs. Clean.
- **`api/routes/files.py`**: `_is_local_runtime()` gate (MAXMA_ENV != production). Clean.
- **`api/activity_hub.py`**: Singleton with double-checked locking + `threading.Lock` for buffer. Clean.
- **`web/src/utils/markdown.ts`**: `data:` URI whitelist blocks `image/svg+xml` (only png/jpeg/jpg/gif/webp/bmp/avif). `DANGEROUS_TAGS` + `ALLOWED_TAGS` + `ALLOWED_URL_SCHEMES` sanitization. XSS defenses look thorough.
- **`web/src/utils/python-highlight.ts`**: `escapeHtml` before tokenization. Clean.
- **`web/src/components/AutocompletePanel.vue`**: `v-html` with `escapeHtml` + highlight regex. Clean.
- **`desktop/src-tauri/src/main.rs`**: Job Object with `KILL_ON_JOB_CLOSE`; `no_proxy()` on health check reqwest; panic hook writes to startup log. Clean.

## Self-assessment

- **Confidence**: B-011 and B-012 are high-confidence — both are traceable to specific lines with clear causal chains and the contradiction between the two code sites is verifiable by reading. B-013 is a clear UX regression with a one-line trace. B-014 is spec-backed (Web Storage §4.12) but low impact. B-015 is a convention violation with concrete repro (any sticker upload failure).
- **No HIGH filed**: The persona issues (B-011, B-012) are MEDIUM, not HIGH, because they require authenticated user action (no unauthenticated exploit) and the blast radius is limited to the user's own personas (no cross-user impact, no RCE, no data exfiltration to an attacker). The YAML injection in B-012 is a data-integrity issue, not a code-execution vector, because the injected values flow into a line-by-line parser that only accepts four whitelisted keys (no `eval`, no `exec`, no template rendering).
- **No tests run**: Mode A = discovery only, no code edits, so no test run required per task spec.
- **Round 3 does NOT terminate the contest**: 2 MEDIUM issues filed this round → `consecutive_empty_rounds` stays at 0 (Red R3 had 0 new issues, but Blue R3 has 2 MEDIUM, so the round is not empty). Round 4 Red must fix B-011/B-012; Round 4 Blue may challenge or find new bugs.
