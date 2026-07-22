# Round 2 — Red Team Handoff

## Status

Complete. **All 10 Blue issues fixed (B-001..B-010)**. Full pytest suite passes — **1834 passed, 7 skipped in 23.16s**, 0 failures, 0 errors. No new `R-NNN` issues filed (focus was on closing Blue's findings cleanly).

## Issues Table

| ID    | Priority | Files                                                                                | Status   | Notes                                                                                                                                                                                                             |
| ----- | -------- | ------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-001 | HIGH     | `api/pi_bridge/sidecar_manager.py`; `bun-sidecar/src/tools/config/{manage_mcp,manage_skills,manage_env_vars,manage_whitelist,manage_macros}.ts` | Fixed    | `SidecarManager.start()` now injects `MAXMA_PROJECT_ROOT` env var. Each config tool gained `projectRoot()` helper that reads env var with `process.cwd()` fallback. Config paths corrected to point at real files. |
| B-002 | HIGH     | `api/routes/chat.py`                                                                 | Fixed    | Replaced `"cwd": "."` with `"cwd": str(PROJECT_ROOT)` (imported from `app_paths`). Coupled with B-001 — both sides now agree on project root.                                                                     |
| B-003 | MEDIUM   | `bun-sidecar/src/session-bridge.ts`                                                  | Fixed    | Added `compact` RPC handler. Truncates `state.messages` to last `keepLast` (default 20), preserves leading `system` message. Returns `{compressed, removed_count, detail}`.                                        |
| B-004 | MEDIUM   | `bun-sidecar/src/tools/config/manage_macros.ts`                                      | Fixed    | Added `MACRO_NAME_RE = /^[A-Za-z0-9_\-]+$/`, `validateName()`, `assertWithinMacrosDir()`. All actions validate name before any path operation.                                                                     |
| B-005 | MEDIUM   | `api/routes/balance.py`; `tests/test_api/test_balance_routes.py`                     | Fixed    | Added loop-aware `_client_lock` + `_get_client_lock()` helper (handles test-time loop changes). `_get_async_client()` is now async + lock-protected. `close_async_client()` also lock-protected.                   |
| B-006 | MEDIUM   | `api/routes/memory.py`                                                               | Fixed    | Both `GET /memory` and `DELETE /memory/{memory_id}` return `JSONResponse(status_code=501, ...)` with `_NOT_IMPLEMENTED_DETAIL`. Frontend already handles non-OK gracefully.                                       |
| B-007 | MEDIUM   | `bun-sidecar/src/session-bridge.ts`                                                  | Fixed    | `undo` now walks backwards counting `user` messages as turn boundaries. Cut happens at user-message position so no dangling `tool_call`/`tool_result` pairs. Response adds `turns_removed`.                        |
| B-008 | MEDIUM   | `api/routes/mcp_test.py`; `tests/test_api/test_mcp_test_routes.py`                   | Fixed    | Added `_ALLOWED_COMMANDS` whitelist (npx/node/npm/uvx/uv/python/python3/py/bun/deno/docker), `_resolve_command()` (basename + regex + whitelist), `_validate_args()` (rejects control chars + shell metachars).   |
| B-009 | LOW      | `api/routes/providers.py`; `api/server.py`                                           | Fixed    | Extracted `migrate_plaintext_keys_to_encrypted()` from `POST /providers/encrypt-keys` endpoint. Added startup migration call in `server.py` lifespan (idempotent, non-fatal on failure).                          |
| B-010 | LOW      | `bun-sidecar/src/tools/config/manage_mcp.ts`                                         | Fixed    | Rewrote `parseYaml` with proper indent-aware stack. Dedent loop now `while (stack.length > 1 && stack[stack.length - 1].indent >= indent) { stack.pop(); }`. Added `coerceScalar` helper.                          |

## Files Touched

### Source code (Python)
- `api/pi_bridge/sidecar_manager.py` — injects `MAXMA_PROJECT_ROOT` env var in `SidecarManager.start()`.
- `api/routes/chat.py` — imports `PROJECT_ROOT` from `app_paths`; forwards `str(PROJECT_ROOT)` as `cwd` to sidecar's `create_session` RPC.
- `api/routes/balance.py` — added `_client_lock`, `_client_lock_loop`, `_get_client_lock()` async helper; converted `_get_async_client()` to `async def`; wrapped both `_get_async_client()` and `close_async_client()` in lock.
- `api/routes/memory.py` — rewrote both endpoints to return 501 with `_NOT_IMPLEMENTED_DETAIL`.
- `api/routes/mcp_test.py` — added `_ALLOWED_COMMANDS`, `_COMMAND_NAME_RE`, `_resolve_command()`, `_validate_args()`; rewrote `test_connection` to use them.
- `api/routes/providers.py` — extracted `migrate_plaintext_keys_to_encrypted()` function; `POST /providers/encrypt-keys` endpoint delegates to it.
- `api/server.py` — added startup migration block in `lifespan` (calls `migrate_plaintext_keys_to_encrypted()` in `try/except Exception`).

### Source code (TypeScript)
- `bun-sidecar/src/session-bridge.ts` — rewrote `undo` method (boundary walk instead of `steps * 2` arithmetic); added new `compact` RPC handler.
- `bun-sidecar/src/tools/config/manage_mcp.ts` — added `projectRoot()` helper; corrected `MCP_CONFIG_PATH` to `"api/data/mcp_servers.yaml"`; rewrote `parseYaml` with indent-aware stack; added `coerceScalar` helper.
- `bun-sidecar/src/tools/config/manage_skills.ts` — added `projectRoot()` helper; switched `path.resolve(process.cwd(), ...)` to `path.resolve(projectRoot(), ...)`.
- `bun-sidecar/src/tools/config/manage_env_vars.ts` — same `projectRoot()` pattern applied to `ENV_PATH`.
- `bun-sidecar/src/tools/config/manage_whitelist.ts` — added `projectRoot()` helper; corrected `WHITELIST_PATH` to `"api/data/path_whitelist.yaml"`; rewrote parser/serializer to match Python `path_whitelist.py` YAML schema (`whitelist: [{path, description, recursive}]`).
- `bun-sidecar/src/tools/config/manage_macros.ts` — added `projectRoot()`, `MACRO_NAME_RE`, `validateName()`, `assertWithinMacrosDir()`; all actions validate name before path operations.

### Tests
- `tests/test_api/test_balance_routes.py` — call sites updated for async `_get_async_client()` (`asyncio.run(balance_mod._get_async_client())`); monkeypatches converted from `lambda: fake` to `async def fake_get(): return fake`.
- `tests/test_api/test_mcp_test_routes.py` — all 9 test commands changed from arbitrary names to whitelisted `npx`; `resolved_command` assertions updated to `"npx"`.
- `tests/test_api/test_stub_routes_extra.py` — `TestMemoryRoutes` class assertions changed from 200+hardcoded-list to 501+stub-detail; added `EXPECTED_DETAIL` class constant; renamed test methods to reflect new contract.

### Documentation / run artifacts
- `.superma/20260720-101810-maxmahere/rounds/round-2/red/review.md`
- `.superma/20260720-101810-maxmahere/rounds/round-2/red/handoff.md` (this file)
- `.superma/20260720-101810-maxmahere/issues/red-issues.md` — **no changes** (no new R-NNN issues filed this round).

## Unfinished Work / Known Limitations

- **B-003 `keep_last` parameter not forwarded**: `api/routes/session_compress.py:42` calls `compact` with only `{"session_id": sidecar_sid}` — the new `keep_last` parameter is never sent from the REST API. Always uses default of 20. The UI doesn't expose a compression-size control either, so this is a feature gap rather than a bug. Future work: add `keep_last` to `session_compress.py` request body and forward it.
- **B-005 lock pattern not applied to other modules**: The `_client_lock_loop` tracker pattern handles test-time loop changes for `balance.py` specifically. Other modules that may need the same pattern in the future (none currently identified) would need to repeat the boilerplate. A future refactor could extract a `_loop_aware_lock()` utility (out of scope).
- **B-006 501 is a stub, not a real integration**: Real OMP memory integration is still not implemented. The 501 path is honest about this — it tells callers "not implemented" rather than fabricating data. When OMP memory APIs are wired up, the endpoints should be replaced with real calls and the 501 path removed.
- **B-008 whitelist is conservative**: The whitelist covers the most common MCP server runtimes (npx/node/npm/uvx/uv/python/python3/py/bun/deno/docker). If a future MCP server requires a different runtime (e.g., `ruby`, `go`, `java`), the whitelist will need explicit updating. This is by design — better to require explicit additions than to allow arbitrary commands.
- **B-009 migration runs synchronously in lifespan**: For a small `providers.yaml` (typically <10 providers), this is sub-millisecond and non-blocking. If the file ever grows large, consider running the migration in a background task. Currently out of scope.
- **B-010 `parseYaml` is still a custom parser**: The fix corrects the indent-tracking bug but the parser is still a hand-rolled subset of YAML. It handles the flat `mcp_servers:` list and nested `env:`/`headers:` maps in the current config, but does not support anchors, aliases, multi-document streams, or flow style. If the config schema ever requires those features, pulling in `js-yaml` would be the right call (currently blocked by the zero-dep constraint in `bun-sidecar/package.json`).

## Verification Commands

```powershell
# Syntax verification (Python)
.venv\Scripts\python.exe -c "import ast; [ast.parse(open(p, encoding='utf-8').read()) for p in ['api/pi_bridge/sidecar_manager.py', 'api/routes/chat.py', 'api/routes/balance.py', 'api/routes/memory.py', 'api/routes/mcp_test.py', 'api/routes/providers.py', 'api/server.py']]; print('OK')"

# Full test suite (already run, passed)
.venv\Scripts\python.exe -m pytest tests/ --tb=short
# Result: 1834 passed, 7 skipped in 23.16s

# Spot-check specific fixes
.venv\Scripts\python.exe -m pytest tests/test_api/test_balance_routes.py tests/test_api/test_mcp_test_routes.py tests/test_api/test_stub_routes_extra.py tests/test_api/test_restart_and_compress.py tests/test_providers_routes.py -v
```

## Suggestions for Blue Team (Round 3)

Areas with elevated risk worth challenging:

1. **B-005 loop-aware lock pattern** — verify the `_client_lock_loop` tracker correctly handles all edge cases: (a) what if `asyncio.get_running_loop()` raises `RuntimeError` (no running loop) — does the orphan lock cause issues? (b) what if two threads call `_get_client_lock()` concurrently — is there a race on `_client_lock_loop` assignment? (c) does the lock correctly serialize `close_async_client()` against an in-flight `_get_async_client()` call?

2. **B-007 undo edge cases** — verify: (a) what if `state.messages` is empty? (b) what if it contains only `system` + `assistant` messages (no `user`)? (c) what if `steps` is 0 or negative? (d) what if the first message is `user` (i.e., no leading `system`) — does the cut still produce a valid message array? (e) does `agent.replaceMessages([])` actually clear state, or does it require at least one message?

3. **B-008 whitelist completeness** — verify: (a) does `os.path.basename` correctly handle Windows-style absolute paths (`C:\Windows\System32\cmd.exe`)? (b) is the regex `_COMMAND_NAME_RE` sufficient to reject all path separators on both POSIX and Windows? (c) does `_validate_args` reject `>` and `<` even though `create_subprocess_exec` doesn't invoke shell — could this break legitimate args that use those characters?

4. **B-009 migration idempotency** — verify: (a) is `is_credential_envelope(value) or is_legacy_encrypted(value)` correctly skipping already-encrypted values? (b) what happens if the Fernet key file is missing/corrupt — does the migration raise or silently skip? (c) what happens if `providers.yaml` doesn't exist — does `_load_providers()` return `[]` and the migration is a no-op?

5. **B-010 parser correctness** — verify the new `parseYaml` correctly handles: (a) deeply nested maps (3+ levels); (b) list items with nested maps; (c) multi-line scalar values; (d) comments at end of lines; (e) empty values (`key:` with nothing after). The parser is exercised against the current flat `mcp_servers:` config but has not been tested against complex nested structures.

6. **Cross-cutting**: verify that the `MAXMA_PROJECT_ROOT` env var injection in `sidecar_manager.py` doesn't leak into child processes spawned by the sidecar (e.g., MCP servers spawned by the agent). If it does, is that a security concern? The env var is just a path string, so probably not, but worth confirming.

## Handoff Complete

Red Team Round 2 work is complete and ready for Blue Team review. All 10 Blue issues are closed, the full test suite passes, and no new R-NNN issues were filed.
