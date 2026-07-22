# Round 2 — Blue Team Handoff

## Status

Complete. **Mode B** chosen and executed. **2 challenges filed** (BC-001, BC-002), both with runnable repro scripts. Both repros confirmed (exit code 1).

## Files Touched

### New files (this round)
- `.superma/20260720-101810-maxmahere/rounds/round-2/blue/mode-choice.md` — Mode B declaration.
- `.superma/20260720-101810-maxmahere/rounds/round-2/blue/review.md` — Blue's review of Red's Round 2 fixes.
- `.superma/20260720-101810-maxmahere/rounds/round-2/blue/handoff.md` — this file.
- `.superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` — BC-001 repro (B-010 challenge).
- `.superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs` — BC-002 repro (B-007 challenge).
- `.superma/20260720-101810-maxmahere/issues/blue-challenges.md` — append-only log of BC-NNN challenges.

### No source code modified
Blue is Mode B this round — no fixes applied, no source code touched. Only documentation, repro scripts, and the challenge log.

## Issues Table

| ID    | Target | Severity (claim) | Files                                           | Repro                                              | Status   | Score claim |
| ----- | ------ | ---------------- | ----------------------------------------------- | -------------------------------------------------- | -------- | ----------- |
| BC-001 | B-010  | MEDIUM           | `bun-sidecar/src/tools/config/manage_mcp.ts:40-64` | `patches/repro_b010_parseYaml.mjs` (exit 1)        | Filed    | +5          |
| BC-002 | B-007  | MEDIUM           | `bun-sidecar/src/session-bridge.ts:555-599`     | `patches/repro_b007_undo_empty_array.mjs` (exit 1) | Filed    | +5          |

**Round 2 Blue challenges**: 2 × +5 = **+10 points** if both confirmed by arbiter.
**Blue running total (projected)**: 20 + 10 = **30** (vs Red 25 — gap closed, Blue ahead by 5).

## Challenge summary

### BC-001 (targets B-010)
Red's rewritten `parseYaml` correctly fixed the dedent loop but left a second bug in the list-item inline-mapping branch. Any list item containing a colon — including Windows paths like `D:/Maxma` — is mis-parsed as `"- key: value"` syntax, producing `{D: "/Maxma"}` instead of the string `"D:/Maxma"`. The `args` array in the project's own `api/data/mcp_servers.yaml` is corrupted: loses 2 of 3 items. Repro: `node patches/repro_b010_parseYaml.mjs` from project root.

### BC-002 (targets B-007)
Red's rewritten `undo` handler correctly replaced `steps * 2` arithmetic with a backwards walk but failed to add the leading-system-message preservation guard that the sibling `compact` handler (lines 601-637, added by Red in the same round for B-003) has. When `cutIndex` lands on 0 — which happens with `messages = [user, assistant]` and `steps >= 1`, or with `steps >` available user-turn count — `remaining = []` and `replaceMessages([])` wipes all state silently. Repro: `node patches/repro_b007_undo_empty_array.mjs` from any cwd.

## Verification Commands

```powershell
# Both repros must exit 1 to confirm the bugs
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b010_parseYaml.mjs
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b007_undo_empty_array.mjs
```

## Unfinished Work / Known Limitations

- **BC-003 (B-005) considered but not filed**: The `_client_lock_loop` tracker in `balance.py` has a theoretical race (two coroutines on a fresh loop both observe `_client_lock_loop is not running_loop` and both recreate the lock, with the second overwriting the first). The practical window is narrow due to Python's GIL serializing the comparison, and constructing a concrete repro that demonstrates observable harm (e.g., a leaked unclosed client) is non-trivial. Dropped in favor of the two stronger challenges.
- **No challenge filed against B-001/B-002 coordination**: `app_paths.PROJECT_ROOT` is always a valid `Path` (never None), and the `process.cwd()` fallback in bun-sidecar is defensive. Solid.
- **No challenge filed against B-006 frontend swallowing**: `web/src/stores/memory.ts` swallows 501 delete errors silently (`catch { console.warn(...) }`), so the user doesn't see "not implemented" in the UI. This is a UX issue but not a challenge on Red's fix per se — Red's fix correctly returns 501 per spec.
- **No challenge filed against B-008 whitelist completeness**: The whitelist is conservative by design (Red's handoff acknowledges this). `_resolve_command` rejects absolute paths via the regex (path separators are not in `_COMMAND_NAME_RE`). Solid.
- **No challenge filed against B-009 migration**: Idempotent, non-fatal, Fernet key handling is correct. Solid.

## Suggestions for Arbiter

1. **Run both repros** — they are self-contained Node.js scripts using only `node:fs` and `node:path`. No dependencies. Exit 1 = bug confirmed.
2. **BC-001 is the stronger challenge** — it demonstrates that Red's fix does not actually parse the project's real config file correctly. The bug is end-to-end reproducible against `api/data/mcp_servers.yaml`.
3. **BC-002 is the more subtle challenge** — it requires comparing `undo` and `compact` handlers side-by-side to see the inconsistency. The repro makes the inconsistency explicit.
4. **Severity escalation**: BC-001 escalates B-010 from LOW to MEDIUM (the bug corrupts real config and is no longer masked by B-001). BC-002 keeps B-007 at MEDIUM.

## Suggestions for Red Team (Round 3)

If there is a Round 3, areas worth Red's attention:

1. **`manage_providers.ts` has a SEPARATE `parseYaml`** (not touched by B-010) with the *original* buggy dedent loop and a wrong `PROFILE_PATH = "config/providers.yaml"` (real path is `api/data/providers.yaml`). This is a Mode A target for Blue, not a Mode B challenge — but Red should fix it preemptively.
2. **`session-bridge.ts` undo/compact handlers have no unit tests** — `tests/session-bridge.test.ts` only tests `orchestratePrompt`. Adding undo/compact test coverage would prevent regressions.
3. **`replaceMessages([])` behavior is undefined** in pi-agent-core — the type signature accepts `AgentMessage[]` with no minimum length. Document or assert the expected behavior.

## Handoff Complete

Blue Team Round 2 work is complete. Two Mode B challenges filed, both with confirmed repros. No source code modified. Ready for arbiter verification.
