# Round 1 — Blue Team Review

## Summary

Mode A (discovery only — no fixes applied). Scanned in-scope directories flagged as under-reviewed by Red (`bun-sidecar/src/` TypeScript beyond surface, `desktop/src-tauri/src/main.rs`, `build/`) plus a broad sweep of `api/routes/`, `web/src/` stores/composables/components, and cross-module contracts. Read 30+ source files in this round plus cross-referenced Red's R-001/R-002 fixes.

Found **10 new bugs** (2 HIGH, 6 MEDIUM, 2 LOW). No code edits were made (Mode A). All findings include concrete file:line citations, symptom, root cause, suggested fix, and verification method.

## Issues

### B-001

- **Priority**: HIGH
- **File**: `bun-sidecar/src/tools/config/manage_mcp.ts`, `manage_skills.ts`, `manage_env_vars.ts`, `manage_whitelist.ts`, `manage_macros.ts`; root cause in `api/pi_bridge/sidecar_manager.py:31-34,120-128`
- **Lines**: `manage_mcp.ts:9,72`; `manage_skills.ts:12,31`; `manage_env_vars.ts:9,31`; `manage_whitelist.ts:9,22`; `manage_macros.ts:9,26`; `sidecar_manager.py:31-34,127`
- **Symptom**: All five bun-sidecar config tools resolve their target paths via `path.resolve(process.cwd(), <relative>)`, but the sidecar process is spawned with `cwd=str(SIDECAR_DIR)` where `SIDECAR_DIR = <project_root>/bun-sidecar`. So inside the sidecar `process.cwd()` returns `.../bun-sidecar`, and the tools look for `bun-sidecar/config/mcp_servers.yaml`, `bun-sidecar/anthropic_skills/`, `bun-sidecar/.env`, `bun-sidecar/config/.whitelist`, `bun-sidecar/macros/` — none of which exist. The real configs live at `api/data/mcp_servers.yaml`, `anthropic_skills/`, `.env`, `api/data/path_whitelist.yaml`, `macros/` (all relative to project root, not `bun-sidecar/`). Every config tool silently returns empty ("未配置任何 MCP 服务器", "anthropic_skills/ 目录不存在", etc.) on read, and silently writes to the wrong directory on write — the real config is never touched. The agent believes it has modified configuration but the changes are lost in a parallel phantom tree under `bun-sidecar/`.
- **Root cause**: `SidecarManager.start()` sets `cwd=str(SIDECAR_DIR)` (i.e. `bun-sidecar/`) so the sidecar process runs from its own source directory, but the config tools were authored assuming `process.cwd()` is the project root. The two assumptions are inconsistent. `bun-sidecar/` is the sidecar's own source tree, not the project root.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: pass an explicit project-root path into the sidecar via env var (e.g. `MAXMA_PROJECT_ROOT` set in `sidecar_manager.py` from `app_paths.PROJECT_ROOT`), and have each tool resolve its target via `process.env.MAXMA_PROJECT_ROOT ?? process.cwd()`.
- **Verification**: Confirmed by reading all five `bun-sidecar/src/tools/config/*.ts` files (each uses `path.resolve(process.cwd(), <RELATIVE>)`) and `sidecar_manager.py:127` (`cwd=str(SIDECAR_DIR)`). Cross-checked via Glob that the real config files live at the project root / `api/data/`, not under `bun-sidecar/`.

### B-002

- **Priority**: HIGH
- **File**: `api/routes/chat.py:168-175`; `bun-sidecar/src/session-bridge.ts:442,449`
- **Lines**: `chat.py:173` (`"cwd": "."`); `session-bridge.ts:442` (`const cwd: string = params?.cwd ?? process.cwd();`); `session-bridge.ts:449` (`cwd,` in `createOptions`)
- **Symptom**: When creating a sidecar session, `chat.py` sends `"cwd": "."` literally. In `session-bridge.ts`, `params?.cwd` is `"."` so the agent's `cwd` option becomes `"."`. `createAgentSession` resolves `"."` against the sidecar process's current working directory, which is `bun-sidecar/` (per B-001). The AI agent therefore runs with working directory `<project>/bun-sidecar/` rather than the user's project root `<project>/`. Consequences: (1) the agent cannot see the user's actual files via relative paths (`./api/routes/chat.py`, `./web/src/...`); (2) file tools operate on `bun-sidecar/` subdirectory — the agent may corrupt its own runtime; (3) even if B-001 were fixed, this bug would still prevent the agent from operating on the user's project.
- **Root cause**: Hardcoded `"cwd": "."` in `chat.py:173`. The intent was probably "use the sidecar's current directory" but that conflates the sidecar's runtime cwd (which is `bun-sidecar/` for spawn reasons) with the AI agent's logical project root. There's no plumbing to forward the actual project root into the sidecar create_session call.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: replace `"cwd": "."` with `"cwd": str(app_paths.PROJECT_ROOT)` (or the user-selected workspace path).
- **Verification**: Confirmed by reading `chat.py:168-175`, `session-bridge.ts:442-449`, and `sidecar_manager.py:127`. The combination means the agent's logical cwd resolves to `bun-sidecar/`.

### B-003

- **Priority**: MEDIUM
- **File**: `api/routes/session_compress.py:42`; `bun-sidecar/src/session-bridge.ts:418-606`
- **Lines**: `session_compress.py:42` (`result = await client.call("compact", {"session_id": sidecar_sid})`); `session-bridge.ts:602` (`sendError(id, "Unknown method: ${method}")`)
- **Symptom**: `POST /api/sessions/{id}/compress` and `/fresh-compact` always return `{"compressed": false, "method": "degraded", "detail": "compact not supported by sidecar: ..."}`. The UI surfaces a non-functional "compress" button — every invocation silently fails the same way. No actual context compression ever occurs via this endpoint.
- **Root cause**: `session_compress.py` was written assuming the sidecar exposes a `compact` RPC method, but `session-bridge.ts` never implemented it. The dispatch table handles seven methods (`create_session`, `prompt`, `cancel`, `destroy_session`, `get_health`, `undo`, `get_messages`); `compact` is not among them, so the request falls through to `sendError(id, "Unknown method: compact")`. The Python side catches `JsonRpcError` and silently degrades.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: either implement `compact` in `session-bridge.ts` to actually compress the agent's message history, or remove `session_compress.py` and the UI button if compression is handled elsewhere.
- **Verification**: Confirmed by full read of `session-bridge.ts` (602 lines) — only seven RPC methods are dispatched, `compact` is not present. `session_compress.py` was read in full (93 lines); the only call site for `compact` is line 42, wrapped in `try/except JsonRpcError` that returns `method: "degraded"`.

### B-004

- **Priority**: MEDIUM
- **File**: `bun-sidecar/src/tools/config/manage_macros.ts:49-66`
- **Lines**: `:51` (`const macroDir = path.resolve(macrosDir, params.name)`); `:54` (`fs.mkdirSync(macroDir, { recursive: true })`); `:56` (`fs.writeFileSync(macroPath, ...)`); `:61` (`const macroDir = path.resolve(macrosDir, params.name)`); `:64` (`fs.rmSync(macroDir, { recursive: true, force: true })`)
- **Symptom**: The `manage_macros` tool's `name` parameter is used directly in `path.resolve(macrosDir, params.name)` without any character or traversal validation. A caller (or the AI agent itself, when instructed by a prompt-injected tool result) can supply `name = "../../../etc"` or `name = "..\\..\\..\\Windows\\System32"`. `path.resolve` then walks above `macrosDir`, and `create`/`update` writes `MACRO.md` at any path the process has write access to; `delete` recursively deletes any directory the process can write to via `fs.rmSync(macroDir, { recursive: true, force: true })`. The Python equivalent `api/routes/macros.py:25-31` validates `_MACRO_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')` — the bun-sidecar tool is missing this guard entirely.
- **Root cause**: `manage_macros.ts` was authored without porting the validation that exists in `api/routes/macros.py`. No regex check on `params.name`, no `is_relative_to(macrosDir)` check on the resolved path.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: add `validateName(name)` using `/^[A-Za-z0-9_\-]+$/` and call it before any path operation; additionally assert `path.resolve(macrosDir, name).startsWith(macrosDir + path.sep)` as defense-in-depth. Mirror the pattern in `api/routes/macros.py:25-31`.
- **Verification**: Confirmed by full read of `manage_macros.ts` (86 lines) — no name validation anywhere. Compared with `api/routes/macros.py:25-31` (`_validate_macro_id` with strict regex).

### B-005

- **Priority**: MEDIUM
- **File**: `api/routes/balance.py:13-35`
- **Lines**: `:13` (`_shared_async_client: httpx.AsyncClient | None = None`); `:16-27` (`def _get_async_client()`); `:30-35` (`async def close_async_client()`)
- **Symptom**: `_get_async_client()` reads and writes the module-level `_shared_async_client` without holding any `asyncio.Lock`. Two concurrent `/deepseek-balance` requests can both observe `_shared_async_client is None` (or `.is_closed`) at the same time, both construct a new `httpx.AsyncClient`, and one overwrites the other — the losing client is never `await`-closed, leaking its 20-connection pool. Symmetrically, `close_async_client()` (called from `server.py` lifespan shutdown per R-002) mutates the global without a lock; a request in flight could observe a half-closed client. This violates the project convention "Async locks required for global state" — `SessionManager`, `WebSocketRegistry`, `ActivityHub`, `TokenBucket` all use locks for their singletons; `balance.py` is the exception.
- **Root cause**: The singleton was added (and later wired into lifespan shutdown by R-002) without an accompanying `asyncio.Lock` to serialise create/close races. The check-then-assign pattern `if _shared_async_client is None: _shared_async_client = httpx.AsyncClient(...)` is a textbook TOCTOU race.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: add a module-level `_client_lock = asyncio.Lock()` and wrap the body of `_get_async_client()` and `close_async_client()` in `async with _client_lock:`. `_get_async_client()` should be converted to `async def` so the lock can be held, or the lazy init moved to startup.
- **Verification**: Confirmed by full read of `balance.py` (74 lines) — no `asyncio.Lock` import or usage anywhere in the file. Cross-checked against `api/session_manager.py`, `api/ws_registry.py`, `api/activity_hub.py` (all use `asyncio.Lock`/`threading.RLock` for their singletons), confirming the convention.

### B-006

- **Priority**: MEDIUM
- **File**: `api/routes/memory.py:6-18`
- **Lines**: `:6` (`@router.get("/memory")`); `:9-13` (literal list of three hardcoded dicts); `:15-18` (`@router.delete("/memory/{memory_id}")` returns `{"status": "deleted", "id": memory_id}` without any persistence)
- **Symptom**: The `/memory` endpoint is documented as "proxies OMP recall/reflect data" but returns three hardcoded dummy entries (`"用户是软件开发者，主要使用 Python 和 TypeScript"`, etc.) regardless of the actual OMP memory state. The DELETE endpoint pretends to delete (`{"status": "deleted", "id": memory_id}`) but performs no actual deletion. The frontend memory view displays fabricated data; any "delete" action the user takes is silently ignored.
- **Root cause**: Stub implementation was never replaced with a real OMP integration. The file's docstring claims "proxies OMP recall/reflect data" but no OMP client call exists. The hardcoded list appears to be demo data left over from initial scaffolding.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: wire `list_memories` to the real OMP recall API and `delete_memory` to the OMP reflect/delete API, or return HTTP 501 Not Implemented and remove the UI surface so users aren't misled.
- **Verification**: Confirmed by full read of `memory.py` (18 lines) — three hardcoded dict literals, no imports beyond `APIRouter`, no call to any OMP client, no persistence layer. DELETE handler body is a single `return` statement.

### B-007

- **Priority**: MEDIUM
- **File**: `bun-sidecar/src/session-bridge.ts:555-572`
- **Lines**: `:565` (`const originalLen = record.session.state.messages.length`); `:566` (`const keepCount = Math.max(0, originalLen - steps * 2)`); `:567` (`const remaining = record.session.state.messages.slice(0, keepCount)`); `:569` (`record.session.agent.replaceMessages(remaining)`)
- **Symptom**: The `undo` method removes `steps * 2` messages from the end of `state.messages` assuming a strict alternating `user`/`assistant` sequence. Real agent conversations violate this: (1) tool calls produce `user → assistant(tool_call) → tool(result) → assistant(text)` — removing the last 2 leaves a dangling `tool_call` with no matching `tool_result`, which most LLM APIs reject with a 400 on the next prompt; (2) a system message prepended at the start shifts the cut point; (3) large `steps` can land mid-tool-call, leaving the agent in an unrecoverable state. The UI "undo" button returns 200 with `removed: <n>` but the next chat message fails with an opaque API error.
- **Root cause**: The `steps * 2` arithmetic doesn't account for `tool`/`system`/`function` roles in the message array. No logic to walk back to a safe boundary (e.g. the last `user` message) before truncating. `replaceMessages` then commits the broken state.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: walk backwards from the end counting complete `user`→`assistant` turns (where an assistant turn may include trailing `tool` messages) and cut at the boundary; or snapshot the message array on each successful prompt and let `undo` restore the previous snapshot.
- **Verification**: Confirmed by reading `session-bridge.ts:555-572`. The only logic is `keepCount = Math.max(0, originalLen - steps * 2)` with no role inspection.

### B-008

- **Priority**: MEDIUM
- **File**: `api/routes/mcp_test.py:44-86`
- **Lines**: `:53` (`# 1. 白名单校验 (removed - tools.mcp_security no longer available)`); `:55` (`resolved = req.command`); `:68-74` (`asyncio.create_subprocess_exec(resolved, *req.args, env=env, ...)`)
- **Symptom**: `POST /api/mcp/test-connection` accepts a `command` string and `args` list from the request body and executes them as a subprocess with no command validation. The docstring at line 46-52 still documents "1. 校验命令白名单" as step 1, but the implementation comment at line 53 says "(removed - tools.mcp_security no longer available)" and `resolved = req.command` is assigned directly. A request like `{"command": "cmd.exe", "args": ["/c", "del", "/q", "/s", "..."]}` executes verbatim. The AI agent (via prompt-injected tool results) can also trigger this, bypassing the MCP command whitelist that `api/routes/mcp.py:20-34` enforces for actual MCP server configuration. This is a regression: the file's own docstring still claims whitelist validation happens, but it doesn't.
- **Root cause**: `tools.mcp_security` module was removed (replaced by OMP per the audit_log.py comment pattern) but `mcp_test.py` was not updated to either re-implement validation or be removed. The endpoint was left in a half-migrated state.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: restore command whitelist validation against the same allowlist used by `api/routes/mcp.py`, gate the endpoint behind the same auth as `mcp.py` PUT, or remove the endpoint and update the frontend to call `/api/mcp/{id}/test` instead.
- **Verification**: Confirmed by full read of `mcp_test.py` (118 lines). Line 53 explicitly states the whitelist was removed. Line 55 confirms no validation. Compared with `api/routes/mcp.py:20-34` which has a working `_BLOCKED_ENV_KEYS` plus transport validation.

### B-009

- **Priority**: LOW
- **File**: `api/data/providers.yaml:2,11`; `api/routes/providers.py:218-221,283-287`
- **Lines**: `providers.yaml:2` (`api_key: sk-80c22ad320e6991e-dkaber-74a7b63e`); `:11` (`api_key: sk-35fc1368b45b4234a37d5c45bf5c7101`)
- **Symptom**: `api/data/providers.yaml` stores two real-looking API keys in plaintext. The codebase already ships a Fernet-based credential envelope (`api/security/credential_envelope.py` with `encv1:` prefix), `providers.py` auto-encrypts newly-created and updated keys, and a bulk migration endpoint `POST /providers/encrypt-keys` exists. None of these have been run against the existing file — the keys remain in plaintext at rest. Anyone with read access to `api/data/` (the user, backup software, sync tools, malware) gets the raw API keys.
- **Root cause**: The encryption infrastructure was added but never back-filled against pre-existing entries. There's no startup hook that auto-migrates plaintext keys on server boot.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: invoke `POST /providers/encrypt-keys` once manually, or add a startup hook in `server.py` lifespan that detects plaintext keys and migrates them.
- **Verification**: Confirmed by reading `api/data/providers.yaml` (19 lines) — both `api_key:` values are plaintext `sk-...` strings. Cross-checked with `providers.py:218-221` (auto-encryption only on create/update), `providers.py:518-546` (`_decrypt_api_key` handles `encv1:`/legacy `enc:`/plaintext), and `api/security/credential_envelope.py`.

### B-010

- **Priority**: LOW
- **File**: `bun-sidecar/src/tools/config/manage_mcp.ts:11-59`
- **Lines**: `:54-56` (`if (indent < currentIndent) { while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; } }`)
- **Symptom**: `manage_mcp.ts` does not use a real YAML library; it ships a custom `parseYaml()` function with broken indent tracking. The dedent handler at lines 54-56 has a buggy loop: `while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; }`. After the first pop, `currentIndent = indent` makes the condition `indent <= currentIndent` always true (since `currentIndent === indent`), so the loop continues popping until `stack.length === 1` — over-popping the stack and losing all intermediate nesting levels. For the simple flat `mcp_servers:` list currently in the config this happens to parse correctly, but any future config with nested fields (per-server `env:` blocks, `headers:` maps) will be silently mis-parsed. Additionally, the list-item handler at lines 28-41 doesn't preserve prior scalar values when converting a key from scalar to array. Combined with B-001 (wrong path), this parser is currently never exercised against the real config, which masks the bug.
- **Root cause**: The author reinvented YAML parsing instead of pulling in `js-yaml`. The indent-tracking state machine doesn't correctly model the stack-push-on-indent / stack-pop-on-dedent invariant.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: replace `parseYaml` with `import yaml from "js-yaml"; yaml.load(text)`. If a zero-dependency constraint applies, fix the dedent loop to `while (stack.length > 1 && indent < currentIndent) { stack.pop(); currentIndent = <new top of stack's indent> }` — note `<` not `<=`, and `currentIndent` should be derived from the new top of stack, not from the current line's `indent`.
- **Verification**: Confirmed by reading `manage_mcp.ts:11-59` in full. Traced the loop semantics: `currentIndent = indent` inside the `while` body makes the loop condition trivially true after the first iteration, causing over-pop.

## Scope of Review

Files reviewed in this round (no issues found unless listed above):

- `bun-sidecar/src/`: `session-bridge.ts` (full read, 610 lines), `tools/config/manage_mcp.ts`, `manage_skills.ts`, `manage_env_vars.ts`, `manage_whitelist.ts`, `manage_macros.ts` (all 5 config tools — B-001, B-004, B-010)
- `api/pi_bridge/`: `sidecar_manager.py` (full read — root cause of B-001), `security_adapter.py` (cross-referenced with Red's R-001)
- `api/routes/`: `chat.py` (B-002), `session_compress.py` (B-003), `balance.py` (B-005), `memory.py` (B-006), `mcp_test.py` (B-008), `providers.py`, `env_vars.py`, `macros.py`, `skills.py`, `workflows.py`, `deferred_runs.py`, `diagnostics.py`, `audit_log.py`, `news.py`, `metrics.py`, `persona.py`, `maxma_blocker.py` (Red's R-001 verified), `path_whitelist.py`, `upload.py`, `mcp.py`
- `api/data/`: `providers.yaml` (B-009), `mcp_servers.yaml`, `MaxmaBlocker` (orphaned legacy file noted in handoff)
- `api/security/`: `credential_envelope.py` (cross-referenced for B-009)
- `web/src/stores/`: `session.ts`, `chat.ts`, `provider.ts` (all clean)
- `web/src/composables/`: `useChatInput.ts`, `useFloatSidebar.ts`, `useGlobalShortcut.ts`, `useHealthPolling.ts`, `useMarkdownPersist.ts`, `useMediaViewer.ts`, `useStickerPerformance.ts` (all clean — minor module-level state concerns noted but not filed as bugs)
- `web/src/components/`: `RenderMarkdown.vue`, `AutocompletePanel.vue`, `tools/PythonBubble.vue` (v-html audit — all safe, sanitised via `renderMarkdown` or `escapeHtml`)
- `web/src/utils/`: `markdown.ts` (sanitiser — reviewed thoroughly, safe), `python-highlight.ts` (incomplete `escapeHtml` doesn't escape quotes, but not exploitable in v-html span context)
- `desktop/src-tauri/src/`: `main.rs` (Job Object cleanup, NO_PROXY env, health check — all clean)

Patterns specifically checked per `project.md` conventions:
- `asyncio.get_event_loop()` in production code: 0 occurrences found in scanned files.
- `v-html` usage: re-verified all 6 files Red flagged — all safe.
- Async locks for global state: found one violation (B-005 in `balance.py`); all other modules (`SessionManager`, `WebSocketRegistry`, `ActivityHub`, `TokenBucket`) confirmed locked.
- `MaxmaBlocker` consistency: Red's R-001 fix is correct; cross-referenced `security_adapter._find_blocker_path()` uses `.maxma_blocker` literal — matches Red's `BLOCKER_FILENAME`.
- Path traversal: found one violation (B-004 in `manage_macros.ts`); `api/routes/macros.py`, `skills.py`, `path_whitelist.py`, `upload.py` all validate IDs against strict regex.

## Test Plan

No code edits were made (Mode A discovery only). No tests need to be run for verification of fixes. All findings are documented with file:line citations and reproducible symptoms for the arbiter to verify.

If the arbiter wishes to spot-check any finding, the suggested commands are:

```bash
# Verify B-001 path mismatch:
# Sidecar spawn cwd
grep -n "cwd=str" api/pi_bridge/sidecar_manager.py
# Config tool path resolution
grep -n "path.resolve(process.cwd()" bun-sidecar/src/tools/config/*.ts
# Real config locations
ls api/data/mcp_servers.yaml api/data/path_whitelist.yaml anthropic_skills/ .env macros/

# Verify B-002:
grep -n '"cwd":' api/routes/chat.py

# Verify B-003:
grep -n '"compact"' api/routes/session_compress.py
grep -n 'method === "compact"' bun-sidecar/src/session-bridge.ts  # should return nothing

# Verify B-004:
grep -n 'validateName\|_MACRO_ID_RE' bun-sidecar/src/tools/config/manage_macros.ts api/routes/macros.py

# Verify B-005:
grep -n 'asyncio.Lock\|_client_lock' api/routes/balance.py  # should return nothing

# Verify B-006:
cat api/routes/memory.py  # 18 lines, all hardcoded

# Verify B-008:
grep -n 'resolved = req.command\|tools.mcp_security' api/routes/mcp_test.py

# Verify B-009:
grep -n 'api_key:' api/data/providers.yaml  # plaintext sk-... values
```
