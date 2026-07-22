# Round 1 — Blue Team Handoff

## Status

Complete. Mode A (discovery only — no code edits). 10 new issues filed (B-001 through B-010): 2 HIGH, 6 MEDIUM, 2 LOW. Total potential score: 20 points if all verified. No tests run (no source modifications made).

## Issues Table

| ID    | Priority | File                                                                    | Status    | Notes                                                                                                                            |
| ----- | -------- | ----------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| B-001 | HIGH     | `bun-sidecar/src/tools/config/*.ts` + `api/pi_bridge/sidecar_manager.py` | Filed    | All 5 bun-sidecar config tools (manage_mcp/skills/env_vars/whitelist/macros) use `process.cwd()`-relative paths but sidecar spawned with `cwd=bun-sidecar/`. Config files resolve to wrong location; all tools silently fail. |
| B-002 | HIGH     | `api/routes/chat.py` + `bun-sidecar/src/session-bridge.ts`             | Filed    | `chat.py:173` passes `"cwd": "."` to sidecar; AI agent runs sandboxed to `bun-sidecar/` instead of project root. Agent can't see user's files. |
| B-003 | MEDIUM   | `api/routes/session_compress.py` + `bun-sidecar/src/session-bridge.ts`  | Filed    | Calls sidecar `compact` RPC that doesn't exist in session-bridge.ts dispatch table. Compress always returns degraded; UI button is non-functional. |
| B-004 | MEDIUM   | `bun-sidecar/src/tools/config/manage_macros.ts`                        | Filed    | No name validation on `params.name`. `name="../../../etc"` resolves outside macros/ → arbitrary create/delete via `fs.rmSync(recursive, force)`. Python `api/routes/macros.py` has the validation; the sidecar tool doesn't. |
| B-005 | MEDIUM   | `api/routes/balance.py`                                                | Filed    | Module-level `_shared_async_client` mutated without `asyncio.Lock`. TOCTOU race on concurrent requests leaks httpx connection pools. Violates project convention. |
| B-006 | MEDIUM   | `api/routes/memory.py`                                                 | Filed    | Returns 3 hardcoded dummy entries; DELETE endpoint is a no-op. Fake feature misleads users into thinking memory is managed. |
| B-007 | MEDIUM   | `bun-sidecar/src/session-bridge.ts`                                    | Filed    | `undo` method assumes strict user/assistant pairing (`steps * 2`). Tool/system messages break the assumption; undo corrupts agent state and next prompt fails. |
| B-008 | MEDIUM   | `api/routes/mcp_test.py`                                               | Filed    | Command whitelist validation removed (line 53 comment). `resolved = req.command` used as-is in `subprocess_exec`. Arbitrary command execution; docstring still claims validation. |
| B-009 | LOW      | `api/data/providers.yaml`                                              | Filed    | Two real API keys stored as plaintext despite Fernet envelope infrastructure existing. Migration endpoint `/providers/encrypt-keys` exists but never run. |
| B-010 | LOW      | `bun-sidecar/src/tools/config/manage_mcp.ts`                           | Filed    | Hand-rolled `parseYaml` has buggy indent-tracking loop that over-pops stack on multi-level dedent. Currently masked by B-001 (parser never runs against real config). |

## Files Touched

Source code: **none** (Mode A discovery only).

Documentation / run artifacts:
- `.superma/20260720-101810-maxmahere/rounds/round-1/blue/mode-choice.md` (already present from earlier in this round)
- `.superma/20260720-101810-maxmahere/rounds/round-1/blue/review.md`
- `.superma/20260720-101810-maxmahere/rounds/round-1/blue/handoff.md` (this file)
- `.superma/20260720-101810-maxmahere/issues/blue-issues.md`

## Clusters / Patterns

Three of the ten issues (B-001, B-002, B-010) trace back to the same root cause: **the bun-sidecar process's `cwd` is `bun-sidecar/` (set in `sidecar_manager.py:127`), but multiple components implicitly assume `process.cwd()` is the project root**. They are filed as separate issues because the symptoms and affected code paths are distinct:

- B-001 affects the **config tools** (5 files in `bun-sidecar/src/tools/config/`) — they read/write the wrong file paths.
- B-002 affects the **AI agent itself** — its `cwd` option resolves to `bun-sidecar/` because `chat.py` sends `"cwd": "."` which is resolved against the sidecar's `process.cwd()`.
- B-010 is a latent bug in `manage_mcp.ts`'s YAML parser that is currently masked by B-001 (the parser is never exercised against real config), but will manifest as soon as B-001 is fixed if the parser isn't replaced.

**Recommended fix order for the next round (Red or arbiter-directed):**
1. Fix B-001 first (add `MAXMA_PROJECT_ROOT` env var in `sidecar_manager.py`, have each config tool resolve via it).
2. Fix B-002 in the same patch (replace `"cwd": "."` in `chat.py` with `str(app_paths.PROJECT_ROOT)`).
3. Fix B-010 (replace `parseYaml` with `js-yaml`) — needed before B-001's fix can be validated against real nested config.
4. Fix B-004 (add name validation in `manage_macros.ts`) — independent of B-001 but lives in the same file cluster.
5. B-003, B-005, B-006, B-007, B-008, B-009 are independent and can be fixed in any order.

## Unfinished Work / Known Limitations

- **No code fixes applied**: Mode A explicitly forbids edits. All 10 issues are filed with suggested fixes for the next round.
- **B-001 + B-002 mask B-010**: The YAML parser bug in `manage_mcp.ts` is currently latent. Once B-001 is fixed (so the parser actually runs against `api/data/mcp_servers.yaml`), B-010 must also be fixed or the parser will mis-parse any non-trivially-nested config.
- **B-009 may be intentional**: Plaintext keys in `api/data/providers.yaml` could be a deliberate development-environment choice. Filed as LOW priority — the project may simply need a one-time migration call rather than a code change.
- **Areas not deeply reviewed**: `web/src/views/`, `web/src/components/` beyond the v-html audit, `build/` scripts beyond a high-level scan, `tests/` suite, `agent/` Python core beyond `prompts.py`. Red Team's review covered some of these; remaining gaps are flagged for future rounds.
- **Frontend stores**: `web/src/stores/{session,chat,provider}.ts` were read in full and found clean. Other stores (`activity.ts`, `auditLog.ts`, `health.ts`, `metrics.ts`, `onboarding.ts`, `persona.ts`, `sidebar.ts`, `tools.ts`, `workbench.ts`) were not deeply reviewed.
- **No re-challenge of Red's R-001/R-002**: Per Mode A choice (see `mode-choice.md`), Red's arbiter-verified fixes were not re-litigated.

## Verification Commands

No code was edited, so no syntax verification or test runs are required. The arbiter may verify findings using the commands listed in `review.md`'s "Test Plan" section.

## Suggestions for Red Team (Next Round)

If Red Team is dispatched to fix the issues filed in this round:

1. **B-001 + B-002 should be fixed together** in a single patch — both touch `sidecar_manager.py`/`chat.py`/`session-bridge.ts` and a clean fix requires plumbing the project root through both the spawn cwd decision and the create_session RPC.
2. **B-005 (async lock)**: when adding `_client_lock = asyncio.Lock()`, also convert `_get_async_client()` to `async def` (it's currently sync but called from async handlers). Watch for deadlocks if `close_async_client()` is called from lifespan shutdown while a request is in flight.
3. **B-007 (undo)**: the safest fix is to snapshot `state.messages` on each successful `prompt()` return and have `undo` restore the previous snapshot, rather than computing a slice. Avoids all role-counting edge cases.
4. **B-008 (mcp_test RCE)**: short-term fix is to gate the endpoint behind the same auth as `mcp.py` PUT. Long-term fix is to remove it entirely and have the frontend call `/api/mcp/{id}/test` (which already validates the command via `_validate_update_against_transport`).
5. **B-006 (memory.py fake data)**: confirm with project owner whether OMP exposes a memory CRUD API. If not, the right fix is to delete the route and the UI button — don't ship a fake feature.

## Handoff Complete

Blue Team Round 1 (Mode A) work is complete and ready for arbiter verification.
