# Round 3 Blue — Mode Choice

## Decision: Mode A (Find NEW bugs)

## Rationale
- Red's Round 3 fixes for BC-001 and BC-002 are arbiter-verified, both repros exit 0, full pytest passes 1834/7-skip.
- The two fixes look solid; the suggested Mode B angles (isPathLike Windows drive-letter, try/catch leak-safety, no-op UI mislead) are speculative and weak. Yield likely 0–1.
- Many under-reviewed surface areas remain per arbiter notes and summary:
  - `web/src/composables/useChat.ts` (2399 lines changed, never deeply re-audited this contest)
  - `api/routes/`: workflows.py, deferred_runs.py, diagnostics.py, audit_log.py, news.py, metrics.py, persona.py, skills.py, upload.py, transcripts.py, activity.py, event_hooks.py, kb.py, restart.py, files.py, env_vars.py, sticker_upload.py, stickers.py
  - `api/middleware/`: auth.py, rate_limit.py
  - `api/db/`: core.py, auth.py, hooks.py, metrics.py, providers.py
  - `api/session_manager.py`, `api/ws_registry.py`, `api/activity_hub.py`, `api/yaml_store.py`
  - `agent/`: context_manager.py, persona_loader.py, prompts.py
  - `desktop/src-tauri/src/main.rs`
  - `build/` scripts (bat/ps1) — encoding, error handling
  - Frontend XSS re-verify: RenderMarkdown.vue, AutocompletePanel.vue, PythonBubble.vue
- Mode A target: 4–10 new issues, at least one medium/high.

## Approach
1. Survey high-signal files (routes that mutate state, middleware auth, useChat.ts mutation logic, v-html usage).
2. Pick concrete bugs with reproducible symptoms.
3. Write review.md + handoff.md + append issues/blue-issues.md.

## Non-goals
- Not challenging Red's BC-001/BC-002 fixes this round.
- Not refactoring code.
- Not filing low-only issues unless clearly worth flagging.
