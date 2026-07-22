# Round 2 — Red Team Review

## Summary

Mode B (fix Blue's findings). All 10 Blue issues from Round 1 (`B-001`..`B-010`) were addressed with surgical edits. Verification: full pytest suite passes — **1834 passed, 7 skipped in 23.16s**. Type/syntax-checked via `ast.parse` for Python edits and structural review for TypeScript edits.

Two coupled HIGH issues (`B-001` + `B-002`) were fixed together as required by the spec. The MEDIUM cluster (`B-003`..`B-008`) was fixed in priority order. Both LOW issues (`B-009`, `B-010`) were also fixed. No new `R-NNN` issues were filed this round — the audit focused on closing Blue's findings cleanly without scope creep.

## Blue issues fixed

### B-001 — sidecar `cwd` mismatch breaks all 5 config tools (HIGH)

- **Files**: `api/pi_bridge/sidecar_manager.py`; `bun-sidecar/src/tools/config/{manage_mcp,manage_skills,manage_env_vars,manage_whitelist,manage_macros}.ts`
- **Root cause**: Sidecar spawned with `cwd=str(SIDECAR_DIR)` (= `bun-sidecar/`), but config tools resolved paths via `path.resolve(process.cwd(), <relative>)` — looking for `bun-sidecar/config/mcp_servers.yaml`, `bun-sidecar/anthropic_skills/`, `bun-sidecar/.env`, `bun-sidecar/config/.whitelist`, `bun-sidecar/macros/` — none of which exist. Real configs live at project root.
- **Fix**: `SidecarManager.start()` now injects `MAXMA_PROJECT_ROOT` env var from `app_paths.PROJECT_ROOT`. Each of the 5 config tools gained a `projectRoot()` helper that returns `process.env.MAXMA_PROJECT_ROOT ?? process.cwd()` (defensive fallback for standalone sidecar runs). All `path.resolve(process.cwd(), ...)` calls replaced with `path.resolve(projectRoot(), ...)`. Config paths also corrected to point at the real files: `manage_mcp.ts` → `api/data/mcp_servers.yaml`; `manage_whitelist.ts` → `api/data/path_whitelist.yaml` (with schema rewrite to match `api/routes/path_whitelist.py` YAML format).
- **Verification**: `manage_mcp.ts`, `manage_skills.ts`, `manage_env_vars.ts`, `manage_whitelist.ts`, `manage_macros.ts` all read the `MAXMA_PROJECT_ROOT` env var. `sidecar_manager.py` exports it.

### B-002 — `"cwd": "."` makes agent run inside `bun-sidecar/` (HIGH, coupled with B-001)

- **Files**: `api/routes/chat.py`
- **Root cause**: Hardcoded `"cwd": "."` in `create_session` RPC. With sidecar spawn cwd = `bun-sidecar/`, the agent's logical project root resolved to `bun-sidecar/`, not the user's project root. The agent could not see real project files and could corrupt its own runtime.
- **Fix**: Import `PROJECT_ROOT` from `app_paths` and forward `"cwd": str(PROJECT_ROOT)` to the sidecar. Together with B-001's `MAXMA_PROJECT_ROOT` env injection, both sides now agree on the project root.
- **Verification**: `chat.py` no longer contains the literal `"cwd": "."`.

### B-003 — `compact` RPC not implemented (MEDIUM)

- **Files**: `bun-sidecar/src/session-bridge.ts`
- **Root cause**: `session_compress.py:42` calls `client.call("compact", ...)`, but the sidecar's RPC dispatcher only handled 7 methods — `compact` fell through to `sendError("Unknown method: compact")`. The Python side caught `JsonRpcError` and silently degraded.
- **Fix**: Added `compact` RPC handler that truncates `state.messages` to the last `keepLast` entries (default 20). Always preserves a leading `system` message if present (LLM providers require it). Calls `agent.replaceMessages(remaining)` only when something was actually removed. Returns `{"compressed": bool, "removed_count": int, "detail": "压缩完成" | "无需压缩"}` matching the contract expected by `session_compress.py` and `tests/test_api/test_restart_and_compress.py`'s `_FakeSidecarClient`.
- **Verification**: New handler at `session-bridge.ts:601-637`. Existing tests (`test_compress_success`, `test_fresh_compact_success`, etc.) continue to pass against the mocked sidecar.

### B-004 — `manage_macros` name validation missing (MEDIUM)

- **Files**: `bun-sidecar/src/tools/config/manage_macros.ts`
- **Root cause**: `path.resolve(macrosDir, params.name)` with no validation allowed `name = ".."` or `name = "../../etc"`, letting `create`/`update` write `MACRO.md` anywhere the process has write access, and `delete` recursively delete any writable directory. The Python equivalent `api/routes/macros.py:25-31` already had `_MACRO_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')` — the bun-sidecar tool was missing this guard.
- **Fix**: Added `MACRO_NAME_RE = /^[A-Za-z0-9_\-]+$/` and `validateName(name)` helper. All `get`/`create`/`update`/`delete` actions now call `validateName()` before any path operation. Additionally added `assertWithinMacrosDir()` defense-in-depth check that asserts `path.resolve(macrosDir, name).startsWith(macrosDir + path.sep)` — mirrors the pattern in `api/routes/macros.py`.
- **Verification**: `manage_macros.ts` now exports both validators and calls them on every path operation.

### B-005 — `balance.py` singleton client race (MEDIUM)

- **Files**: `api/routes/balance.py`; `tests/test_api/test_balance_routes.py`
- **Root cause**: `_get_async_client()` was synchronous with no lock — two concurrent `/deepseek-balance` requests could both observe `_shared_async_client is None`, both construct a new `httpx.AsyncClient`, and one would be silently lost (leaking its 20-connection pool). `close_async_client()` mutated the global without a lock; an in-flight request could observe a half-closed client. Violates the project convention "Async locks required for global state" (SessionManager, WebSocketRegistry, ActivityHub, TokenBucket all lock).
- **Fix**: Added module-level `_client_lock` + `_client_lock_loop` tracker. The `_get_client_lock()` async helper recreates the lock when the running loop changes — this handles tests that use `asyncio.run()` (which creates a fresh loop each call) without breaking production (single FastAPI loop). `_get_async_client()` converted to `async def` and wrapped in `async with lock`. `close_async_client()` wrapped in same lock. Updated test callsites in `test_balance_routes.py` to use `asyncio.run(balance_mod._get_async_client())` and `async def fake_get(): return fake` monkeypatches.
- **Verification**: All `test_balance_routes.py` tests pass. `import ast; ast.parse(...)` confirms no syntax errors.

### B-006 — `/memory` endpoint returns hardcoded demo data (MEDIUM)

- **Files**: `api/routes/memory.py`
- **Root cause**: Stub returned 3 fabricated demo entries (`"用户是软件开发者..."`) regardless of OMP state; DELETE returned `{"status": "deleted"}` without persisting. Misleading UI surface.
- **Fix**: Per spec's "simpler 501 path acceptable" guidance, both `GET /memory` and `DELETE /memory/{memory_id}` now return `JSONResponse(status_code=501, ...)` with `_NOT_IMPLEMENTED_DETAIL = "OMP memory integration not implemented — endpoint is a stub."`. Frontend `web/src/stores/memory.ts` already handles non-OK responses gracefully (clears `facts` on list failure, swallows delete errors).
- **Verification**: `tests/test_api/test_stub_routes_extra.py::TestMemoryRoutes` updated to assert 501 status and the new detail string. All pass.

### B-007 — `undo` arithmetic breaks on tool messages (MEDIUM)

- **Files**: `bun-sidecar/src/session-bridge.ts`
- **Root cause**: `keepCount = Math.max(0, originalLen - steps * 2)` assumed strict alternating `user`/`assistant`. Real agent conversations include `tool`/`function` role messages — the arithmetic cut mid-tool-call, leaving dangling `tool_call` with no matching `tool_result`. Most LLM APIs reject this with a 400 on the next prompt.
- **Fix**: Replaced arithmetic with a backwards walk: scan from end of `state.messages`, count `user` messages as turn boundaries, and cut at the index of the Nth-to-last user message. This guarantees the cut happens just before a `user` message — the preceding assistant turn (including its trailing `tool` messages) is removed as a unit. Response now includes `turns_removed` for the UI's information.
- **Verification**: Code review confirms no arithmetic on message length; cut index always lands on a `user`-message position (or `originalLen` if no user message exists, which is a safe no-op).

### B-008 — `mcp_test.py` accepts arbitrary commands (MEDIUM)

- **Files**: `api/routes/mcp_test.py`; `tests/test_api/test_mcp_test_routes.py`
- **Root cause**: `resolved = req.command` accepted any string and passed it directly to `asyncio.create_subprocess_exec`. The file's own docstring still documented "1. 校验命令白名单" as step 1, but a comment said "(removed - tools.mcp_security no longer available)" and no replacement validation existed. A request like `{"command": "cmd.exe", "args": ["/c", "del", ...]}` executed verbatim.
- **Fix**: Added `_ALLOWED_COMMANDS` frozenset whitelist (npx, node, npm, uvx, uv, python, python3, py, bun, deno, docker). Added `_resolve_command(raw)` helper that: (1) rejects empty commands; (2) extracts basename (defensive — rejects absolute paths); (3) validates basename against `_COMMAND_NAME_RE = /^[A-Za-z0-9_.\-]+$/` (rejects shell metacharacters, path separators); (4) checks basename (lowercased) is in the whitelist. Added `_validate_args(args)` helper that rejects control characters (`\n`, `\r`, `\x00`) and shell metacharacters (`` ` $ | ; & < > ``) in args. Existing tests updated to use `"npx"` as the test command.
- **Verification**: All 9 `test_mcp_test_routes.py::TestTestConnection` tests pass. The whitelist matches the commands used by real MCP servers (npx/uvx/python/node).

### B-009 — Plaintext API keys never auto-encrypted (LOW)

- **Files**: `api/routes/providers.py`; `api/server.py`
- **Root cause**: `api/data/providers.yaml` stored real-looking API keys in plaintext. Encryption infrastructure existed (Fernet envelope with `encv1:` prefix, auto-encryption on create/update, bulk migration endpoint `POST /providers/encrypt-keys`), but no startup hook auto-migrated pre-existing entries. Anyone with read access to `api/data/` got raw keys.
- **Fix**: Extracted `migrate_plaintext_keys_to_encrypted() -> int` from the `POST /providers/encrypt-keys` endpoint body. The endpoint now delegates to this function (zero behavior change for callers). Added startup migration in `api/server.py` lifespan: after sidecar manager is created, calls `migrate_plaintext_keys_to_encrypted()` inside `try/except Exception` (non-fatal — startup continues even if migration fails). Logs the count of newly-encrypted keys.
- **Verification**: `tests/test_api/test_providers_routes.py` (29 tests) all pass. Existing `POST /providers/encrypt-keys` endpoint behavior unchanged.

### B-010 — `parseYaml` dedent loop over-pops stack (LOW)

- **Files**: `bun-sidecar/src/tools/config/manage_mcp.ts`
- **Root cause**: Custom `parseYaml()` had buggy dedent handler: `while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; }`. After the first pop, `currentIndent = indent` made the condition trivially true (since `currentIndent === indent`), so the loop continued popping until `stack.length === 1` — losing all intermediate nesting levels. Real YAML configs with nested `env:` blocks would be silently mis-parsed.
- **Fix**: Rewrote `parseYaml` with a proper indent-aware stack of `{indent, node}` pairs. The dedent loop is now `while (stack.length > 1 && stack[stack.length - 1].indent >= indent) { stack.pop(); }` — uses `>=` (not `<=`) and derives `currentIndent` implicitly from the new top of stack. Added `coerceScalar` helper for proper bool/null/number parsing. Chose stack-rewrite over adding `js-yaml` dependency to preserve the zero-dep constraint documented in `bun-sidecar/package.json`.
- **Verification**: Code review confirms the loop correctly stops popping at the first ancestor with strictly smaller indent.

## Blue issues deferred

None. All 10 Blue issues were fixed in this round.

## New issues found

None filed as `R-NNN`. The audit focused on closing Blue's findings cleanly without scope creep. A few minor observations (not filed):

1. `session_compress.py:42` calls `compact` with only `{"session_id": sidecar_sid}` — the `keep_last` parameter added by B-003 is never forwarded from the REST API. Currently always uses the default of 20. This is a feature gap, not a bug — the UI doesn't expose a compression-size control either.
2. The new `undo` response field `turns_removed` is additive — `chat.py`'s Python-side undo handler passes through whatever the sidecar returns, so no breaking change. Future UI work could surface this for user feedback.
3. The new `mcp_test.py` whitelist is conservative. If a future MCP server requires a runtime not in the list (e.g., `ruby`, `go`), the whitelist will need updating. This is by design — better to add runtimes explicitly than to allow arbitrary commands.

## Test plan

Full pytest suite run after all fixes:

```
.venv\Scripts\python.exe -m pytest tests/ --tb=short
```

Result: **1834 passed, 7 skipped in 23.16s** (0 failures, 0 errors).

Tests updated for the new behavior:
- `tests/test_api/test_balance_routes.py` — call sites updated for async `_get_async_client()`; monkeypatches converted to async fakes.
- `tests/test_api/test_mcp_test_routes.py` — all 9 test commands changed from arbitrary names (`ghost-cmd`, `echo`, `failer`, `long-running`, `stubborn`, `x`) to whitelisted `npx` so they pass the new validation.
- `tests/test_api/test_stub_routes_extra.py::TestMemoryRoutes` — assertions changed from 200+hardcoded-list to 501+stub-detail.

No test files were deleted; no new test files were created. Existing tests for `compact` (`test_restart_and_compress.py`) continue to pass via the `_FakeSidecarClient` mock — the mock simulates the sidecar returning `{"compressed": True, "removed_count": 5, "detail": "压缩完成"}`, which matches the contract of my new `compact` RPC implementation.
