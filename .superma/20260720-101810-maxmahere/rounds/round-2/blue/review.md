# Round 2 — Blue Team Review (Mode B)

## Summary

Mode B (challenge Red's Round 2 fixes). Reviewed all 10 of Red's fixes (B-001..B-010) by reading the cited source files and the arbiter's `verification-red.md`. Filed **2 confirmed challenges** (BC-001, BC-002), each with a runnable repro script under `patches/`.

Red's fix quality is generally high — 8 of 10 fixes hold up under scrutiny. The two challenges target incomplete fixes where Red corrected the *primary* bug but left a *secondary* bug in the same code path:

- **BC-001 (B-010)**: Red fixed the dedent loop but the list-item branch still mis-parses the project's actual `api/data/mcp_servers.yaml` — `args: [..., D:/Maxma]` becomes `args: [{D:"/Maxma"}]` (2 items lost, path typed as dict).
- **BC-002 (B-007)**: Red replaced `steps * 2` arithmetic with a backwards walk but did not add the leading-system-message preservation guard that the sibling `compact` handler has. Two real cases (`[user, assistant]` with `steps >= 1`, or `steps >` user-turn count) produce `replaceMessages([])` — silent state wipe.

## Challenges filed

### BC-001 — B-010 fix incomplete: `parseYaml` still mis-parses real config

- **Target**: B-010 (LOW).
- **Files**: `bun-sidecar/src/tools/config/manage_mcp.ts:40-64`.
- **Claim**: Red's rewritten `parseYaml` produces wrong output for `api/data/mcp_servers.yaml`. The `args` list loses 2 of 3 items and `D:/Maxma` is parsed as `{D: "/Maxma"}` instead of the string `"D:/Maxma"`.
- **Root cause of incomplete fix**: Red only fixed the dedent loop (lines 35-37) but left the list-item inline-mapping branch (lines 53-64) unconditional. Any list item containing a colon triggers the `"- key: value"` parser, which wraps the item in an object and pushes a new stack frame — corrupting sibling items. The current `mcp_servers.yaml` schema never uses `- key: value` inline syntax, so the entire `if (colonIdx > 0)` branch is dead code that only ever mis-fires on scalar list items.
- **Repro**: `patches/repro_b010_parseYaml.mjs` — imports Red's `parseYaml` verbatim and runs it against the real config file. Exit 1 = bug confirmed.
- **Severity**: MEDIUM (escalated from LOW). The bug corrupts the MCP server config used to spawn MCP servers — `npx` would be invoked with wrong/missing args, breaking every server with path-like arguments. Since B-001 was also fixed this round, the parser is now actually reached (no longer masked by the wrong-cwd bug).
- **Suggested fix**: Either delete the inline-mapping branch (the schema doesn't use it) or guard it with a regex that requires the key to be a YAML identifier and the value not to start with `/`.
- **Verification**: `node patches/repro_b010_parseYaml.mjs` from project root.
- **Score claim**: +5.

### BC-002 — B-007 fix incomplete: `undo` can call `replaceMessages([])`, inconsistent with `compact`

- **Target**: B-007 (MEDIUM).
- **Files**: `bun-sidecar/src/session-bridge.ts:555-599`.
- **Claim**: Red's rewritten `undo` handler can pass an empty array to `record.session.agent.replaceMessages([])`, wiping all state. The sibling `compact` handler (lines 601-637, added by Red in the same round for B-003) explicitly preserves the leading system message — `undo` does not.
- **Root cause of incomplete fix**: Red replaced the `steps * 2` arithmetic with a backwards walk (good), but the final line `const remaining = cutIndex <= 0 ? [] : messages.slice(0, cutIndex);` produces `[]` when `cutIndex` lands on 0. This happens in two real cases: (a) `messages = [user, assistant]` with `steps >= 1` (no leading system); (b) `steps` exceeds the user-turn count and the walk reaches `i = 0`.
- **Repro**: `patches/repro_b007_undo_empty_array.mjs` — runs Red's verbatim cut logic against 4 message sequences and contrasts with `compact`. Exit 1 = bug confirmed.
- **Severity**: MEDIUM. State-wipe is data loss — the conversation is irrecoverable. Triggered by either no-leading-system configurations or excessive `steps` (UI doesn't clamp). `replaceMessages([])` does not throw, so the bug is silent: HTTP 200 returned, next prompt fails with opaque provider error.
- **Suggested fix**: (1) Mirror `compact`'s `hasLeadingSystem` check in `undo`; (2) treat `turnsRemoved < steps` as a no-op (return `removed: 0`).
- **Verification**: `node patches/repro_b007_undo_empty_array.mjs` from any cwd.
- **Score claim**: +5.

## Red fixes that hold up (no challenge filed)

- **B-001**: `MAXMA_PROJECT_ROOT` env var injection + `projectRoot()` helper in all 5 bun-sidecar config tools. Solid. Read `sidecar_manager.py:126-135` and all 5 `manage_*.ts` files — pattern is consistent and the fallback (`process.cwd()`) is defensive.
- **B-002**: `"cwd": str(PROJECT_ROOT)` in `chat.py`. Solid.
- **B-003**: `compact` RPC handler implemented correctly with `hasLeadingSystem` preservation. (Ironically, this is the pattern `undo` should also follow — see BC-002.)
- **B-004**: `MACRO_NAME_RE` + `validateName()` + `assertWithinMacrosDir()` in `manage_macros.ts`. Defense-in-depth, mirrors Python `_MACRO_ID_RE`. Solid.
- **B-005**: Loop-aware `_client_lock` + `_client_lock_loop` tracker in `balance.py`. Considered challenging on race-condition grounds (two coroutines on a fresh loop both recreate the lock), but the practical window is narrow (Python GIL serializes the comparison) and the fix is sound for the documented test-environment case.
- **B-006**: 501 stub path. Per spec ("simpler 501 path acceptable") — not challenging. The frontend `memory.ts` swallows delete errors silently, which is a minor UX issue but not a challenge on Red's fix.
- **B-008**: `_ALLOWED_COMMANDS` frozenset + `_resolve_command` + `_validate_args`. Conservative whitelist is by design. Considered challenging on `os.path.basename` not handling Windows absolute paths, but `_resolve_command` rejects absolute paths via the regex (path separators `/` and `\` are not in `_COMMAND_NAME_RE = /^[A-Za-z0-9_.\-]+$/`). Solid.
- **B-009**: `migrate_plaintext_keys_to_encrypted()` extracted + startup migration in lifespan. Idempotent (skips already-encrypted values via `is_credential_envelope(value) or is_legacy_encrypted(value)`). Non-fatal `try/except Exception` is appropriate for startup. Verified `api/data/providers.yaml` now contains `encv1:...` envelopes.

## Test plan

Both repro scripts are self-contained (no dependencies beyond Node.js stdlib). Run from project root:

```powershell
# BC-001 (B-010 challenge)
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b010_parseYaml.mjs
# Expected: exit 1, output shows args: [{"D":"/Maxma"}]

# BC-002 (B-007 challenge)
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b007_undo_empty_array.mjs
# Expected: exit 1, output shows "BC-002 CONFIRMED"
```

No existing tests were modified. No new test files created (repro scripts live under `patches/`, not `tests/`).
