# Blue Team Issues — Round 1

Append-only log of new issues found by the Blue Team (Mode A — discovery only, no fixes applied).

---

## B-001 — Bun sidecar config tools resolve paths against wrong cwd; all five config tools silently fail

- **Priority**: HIGH
- **Files**:
  - `bun-sidecar/src/tools/config/manage_mcp.ts:9,72` (`MCP_CONFIG_PATH = "config/mcp_servers.yaml"`; `path.resolve(process.cwd(), MCP_CONFIG_PATH)`)
  - `bun-sidecar/src/tools/config/manage_skills.ts:12,31` (`SKILLS_DIR = "anthropic_skills"`; `path.resolve(process.cwd(), SKILLS_DIR)`)
  - `bun-sidecar/src/tools/config/manage_env_vars.ts:9,31` (`ENV_PATH = ".env"`; `path.resolve(process.cwd(), ENV_PATH)`)
  - `bun-sidecar/src/tools/config/manage_whitelist.ts:9,22` (`WHITELIST_PATH = "config/.whitelist"`; `path.resolve(process.cwd(), WHITELIST_PATH)`)
  - `bun-sidecar/src/tools/config/manage_macros.ts:9,26` (`MACROS_DIR = "macros"`; `path.resolve(process.cwd(), MACROS_DIR)`)
  - `api/pi_bridge/sidecar_manager.py:31-34,120-128` (root cause — `SIDECAR_DIR = .../"bun-sidecar"`; `cwd=str(SIDECAR_DIR)` in `create_subprocess_exec`)
- **Lines**: see above
- **Symptom**: Every bun-sidecar config tool resolves its target path with `path.resolve(process.cwd(), <relative>)`. The sidecar process is spawned with `cwd=str(SIDECAR_DIR)` where `SIDECAR_DIR = <project_root>/bun-sidecar`. So inside the sidecar `process.cwd()` returns `.../bun-sidecar`, and the tools look at:
  - `bun-sidecar/config/mcp_servers.yaml` — does not exist (real config is at `api/data/mcp_servers.yaml`)
  - `bun-sidecar/anthropic_skills/` — does not exist (real dir is at project root `anthropic_skills/`)
  - `bun-sidecar/.env` — does not exist (real file is at project root `.env`)
  - `bun-sidecar/config/.whitelist` — does not exist (real whitelist is `api/data/path_whitelist.yaml`, different format)
  - `bun-sidecar/macros/` — does not exist (real dir is at project root `macros/`)

  Result: `manage_mcp` always returns "未配置任何 MCP 服务器" even when `api/data/mcp_servers.yaml` has entries; `manage_skills` always returns "anthropic_skills/ 目录不存在"; `manage_env_vars` always returns "没有配置环境变量"; `manage_whitelist` always returns "白名单为空"; `manage_macros` always returns "macros/ 目录不存在". Write operations (`set`/`delete`/`create`/`update`/`enable`/`disable`/`add`/`remove`) silently create files in the wrong directory under `bun-sidecar/` that nothing else reads — the real config is untouched. The agent believes it has modified configuration but the changes are lost in a parallel phantom tree.
- **Root cause**: `SidecarManager.start()` sets `cwd=str(SIDECAR_DIR)` (i.e. `bun-sidecar/`) so the sidecar process runs from that directory, but the config tools were authored assuming `process.cwd()` is the project root. The two assumptions are inconsistent. `bun-sidecar/` is the sidecar's *own* source tree, not the project root; it does not contain the user-facing config files.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: pass an explicit project-root path into the sidecar (e.g. via env var `MAXMA_PROJECT_ROOT` set in `sidecar_manager.py` from `_project_root` or `app_paths.PROJECT_ROOT`), and have each tool resolve its target via `process.env.MAXMA_PROJECT_ROOT ?? process.cwd()`. Alternatively, resolve relative to `import.meta.dir`'s parent (the project root) rather than `process.cwd()`.
- **Verification**: Confirmed by reading `bun-sidecar/src/tools/config/{manage_mcp,manage_skills,manage_env_vars,manage_whitelist,manage_macros}.ts` (all five use `path.resolve(process.cwd(), <RELATIVE>)`) and `api/pi_bridge/sidecar_manager.py:127` (`cwd=str(SIDECAR_DIR)`). Also confirmed by Glob that the actual config files live at `api/data/mcp_servers.yaml`, `anthropic_skills/`, `.env`, `api/data/path_whitelist.yaml`, `macros/` — none under `bun-sidecar/`.
- **Score claim**: +3 (HIGH).

---

## B-002 — chat.py passes cwd="." to sidecar; AI agent runs sandboxed to bun-sidecar/ instead of project root

- **Priority**: HIGH
- **Files**:
  - `api/routes/chat.py:168-175` (root cause — `"cwd": "."` in `client.call("create_session", {...})`)
  - `bun-sidecar/src/session-bridge.ts:442,449` (`const cwd = params?.cwd ?? process.cwd(); ... createOptions.cwd = cwd`)
- **Lines**: `chat.py:173` (`"cwd": "."`); `session-bridge.ts:442` (`const cwd: string = params?.cwd ?? process.cwd();`); `session-bridge.ts:449` (`cwd,` in `createOptions`)
- **Symptom**: When creating a sidecar session, `chat.py` sends `"cwd": "."` literally. In `session-bridge.ts`, `params?.cwd` is `"."` so the agent's `cwd` option becomes `"."`. The `pi-coding-agent` `createAgentSession` resolves `"."` against the sidecar process's current working directory, which is `bun-sidecar/` (per B-001). The AI agent therefore runs with working directory `<project>/bun-sidecar/` rather than the user's project root `<project>/`.

  Consequences:
  1. The agent cannot see the user's actual files via relative paths (`./api/routes/chat.py`, `./web/src/...`) — they don't exist under `bun-sidecar/`.
  2. File tools the agent invokes (read/write/list) operate on `bun-sidecar/` subdirectory, which is the sidecar's own source tree — the agent may corrupt its own runtime.
  3. B-001's path-mismatch bug is partially masked because the agent never reaches the real config files anyway — even if B-001 were fixed, this bug would still prevent the agent from operating on the user's project.
  4. The agent's `cwd` parameter is supposed to scope the AI's file operations to the user's selected project; passing `"."` defeats that purpose entirely.
- **Root cause**: Hardcoded `"cwd": "."` in `chat.py:173`. The intent was probably "use the sidecar's current directory" but that conflates the sidecar's runtime cwd (which is `bun-sidecar/` for spawn reasons) with the AI agent's logical project root. There's no plumbing to forward the actual project root (e.g. from `app_paths.PROJECT_ROOT` or `settings.project_root`) into the sidecar create_session call.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: in `chat.py`, replace `"cwd": "."` with `"cwd": str(app_paths.PROJECT_ROOT)` (or the user-selected workspace path if a multi-project model is ever introduced), so the agent runs in the project root. Additionally, ensure the sidecar's `process.cwd()` is independent of the agent's `cwd` option (which it already is — they are different concepts).
- **Verification**: Confirmed by reading `chat.py:168-175` (literal `"cwd": "."`), `session-bridge.ts:442-449` (uses `params?.cwd`), and `sidecar_manager.py:127` (sidecar process spawned with `cwd=str(SIDECAR_DIR)` = `bun-sidecar/`). The combination means the agent's logical cwd resolves to `bun-sidecar/`.
- **Score claim**: +3 (HIGH).

---

## B-003 — session_compress.py calls sidecar `compact` RPC that does not exist in session-bridge.ts; compress always degrades

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/session_compress.py:42` (`result = await client.call("compact", {"session_id": sidecar_sid})`)
  - `bun-sidecar/src/session-bridge.ts:418-606` (RPC handler dispatch — methods handled: `create_session`, `prompt`, `cancel`, `destroy_session`, `get_health`, `undo`, `get_messages`; **no `compact` method**)
- **Lines**: `session_compress.py:42`; `session-bridge.ts:602` (`sendError(id, "Unknown method: ${method}")`)
- **Symptom**: `POST /api/sessions/{id}/compress` and `POST /api/sessions/{id}/fresh-compact` always return `{"compressed": false, "method": "degraded", "detail": "compact not supported by sidecar: ..."}`. The UI surfaces this to the user as a non-functional "compress" button — every invocation silently fails the same way. No actual context compression ever occurs via this endpoint.
- **Root cause**: `session_compress.py` was written assuming the sidecar exposes a `compact` RPC method, but `session-bridge.ts` never implemented it. The dispatch table in session-bridge.ts (lines 431-602) handles seven methods; `compact` is not among them, so the request falls through to `sendError(id, "Unknown method: compact")`. The Python side catches `JsonRpcError` and silently degrades instead of surfacing the missing implementation as a real error.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: either (a) implement `compact` in `session-bridge.ts` to actually compress the agent's message history (e.g. summarise older turns and replace them with a single summary message), or (b) if compression is intentionally handled elsewhere (e.g. by the Python session_manager), remove `session_compress.py` and the UI button to avoid advertising a non-functional feature.
- **Verification**: Confirmed by full read of `session-bridge.ts` (602 lines) — only seven RPC methods are dispatched, `compact` is not present. `session_compress.py` was read in full (93 lines); the only call site for `compact` is line 42, which is wrapped in `try/except JsonRpcError` that returns `method: "degraded"`.
- **Score claim**: +2 (MEDIUM).

---

## B-004 — manage_macros.ts has no name validation; path traversal allows create/delete in arbitrary directories

- **Priority**: MEDIUM
- **Files**:
  - `bun-sidecar/src/tools/config/manage_macros.ts:49-66` (create/update/delete paths use `params.name` without validation)
- **Lines**: `manage_macros.ts:51` (`const macroDir = path.resolve(macrosDir, params.name)`); `:54` (`fs.mkdirSync(macroDir, { recursive: true })`); `:56` (`fs.writeFileSync(macroPath, ...)`); `:61` (`const macroDir = path.resolve(macrosDir, params.name)`); `:64` (`fs.rmSync(macroDir, { recursive: true, force: true })`)
- **Symptom**: The `manage_macros` tool's `name` parameter is used directly in `path.resolve(macrosDir, params.name)` without any character or traversal validation. A caller (or the AI agent itself, when instructed by a malicious prompt) can supply `name = "../../../etc"` or `name = "..\\..\\..\\Windows\\System32"`. `path.resolve` then walks above `macrosDir`, and:
  - `create`/`update` calls `fs.mkdirSync(macroDir, {recursive: true})` followed by `fs.writeFileSync(macroPath, attacker_content)` — creates `MACRO.md` at any path the process has write access to.
  - `delete` calls `fs.rmSync(macroDir, {recursive: true, force: true})` — recursively deletes any directory the process can write to.

  Compare with the Python `api/routes/macros.py:25-31` which validates `_MACRO_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')` before any path operation — the bun-sidecar equivalent is missing this guard entirely. The Python route is safe; the sidecar tool is not. Because the sidecar tool runs in the agent's context (no HTTP auth boundary), any prompt-injection content from a tool result could trigger this.
- **Root cause**: `manage_macros.ts` was authored without porting the validation that exists in `api/routes/macros.py`. No regex check on `params.name`, no `is_relative_to(macrosDir)` check on the resolved path.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: add a `validateName(name)` helper using `/^[A-Za-z0-9_\-]+$/` and call it before any path operation; additionally assert `path.resolve(macrosDir, name).startsWith(macrosDir + path.sep)` as defense-in-depth. Mirror the pattern in `api/routes/macros.py:25-31`.
- **Verification**: Confirmed by full read of `manage_macros.ts` (86 lines) — no name validation anywhere. Compare with `api/routes/macros.py:25-31` (`_validate_macro_id` with strict regex). Same gap exists in `manage_skills.ts:67` (`path.resolve(skillsDir, params.name, "SKILL.md")`) but skills has a more constrained file layout (subdirectory + fixed filename) so traversal is harder to exploit — still worth fixing.
- **Score claim**: +2 (MEDIUM).

---

## B-005 — balance.py mutates module-level `_shared_async_client` without async lock; race condition violates project convention

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/balance.py:13-35` (module-level `_shared_async_client` singleton + `_get_async_client()`/`close_async_client()` mutators)
- **Lines**: `balance.py:13` (`_shared_async_client: httpx.AsyncClient | None = None`); `:16-27` (`def _get_async_client()`); `:30-35` (`async def close_async_client()`)
- **Symptom**: `_get_async_client()` reads and writes the module-level `_shared_async_client` without holding any `asyncio.Lock`. Two concurrent `/deepseek-balance` requests can both observe `_shared_async_client is None` (or `.is_closed`) at the same time, both construct a new `httpx.AsyncClient`, and one of them overwrites the other — the losing client is never `await`-closed, leaking its 20-connection pool. Symmetrically, `close_async_client()` (called from `server.py` lifespan shutdown per R-002) mutates the global without a lock; a request in flight could observe a half-closed client.

  This violates the explicit project convention recorded in `project.md` and project memory: "Global state in async modules requires asyncio.Lock for thread safety" / "Async locks required for global state". The `SessionManager`, `WebSocketRegistry`, `ActivityHub`, and `TokenBucket` all use locks for their global state — `balance.py` is the exception.
- **Root cause**: The singleton was added (and later wired into lifespan shutdown by R-002) without an accompanying `asyncio.Lock` to serialise create/close races. The check-then-assign pattern `if _shared_async_client is None: _shared_async_client = httpx.AsyncClient(...)` is a textbook TOCTOU race.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: add a module-level `_client_lock = asyncio.Lock()` and wrap the body of `_get_async_client()` and `close_async_client()` in `async with _client_lock:`. Note that `_get_async_client()` is currently a sync function called from the async handler — it should be converted to `async def` so the lock can be held, or alternatively the lazy init should be done eagerly at startup under the lock.
- **Verification**: Confirmed by full read of `balance.py` (74 lines) — no `asyncio.Lock` import or usage anywhere in the file. Cross-checked against `api/session_manager.py`, `api/ws_registry.py`, `api/activity_hub.py` (all use `asyncio.Lock`/`threading.RLock` for their singletons), confirming the convention.
- **Score claim**: +2 (MEDIUM).

---

## B-006 — memory.py returns hardcoded dummy data; "delete" endpoint is a no-op; feature is fake

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/memory.py:6-18` (`list_memories` returns three hardcoded entries; `delete_memory` returns success without doing anything)
- **Lines**: `memory.py:6` (`@router.get("/memory")`); `:9-13` (literal list of three dicts with hardcoded `id`, `content`, `category`, `confidence`, `updatedAt`); `:15-18` (`@router.delete("/memory/{memory_id}")` returns `{"status": "deleted", "id": memory_id}` without any persistence)
- **Symptom**: The `/memory` endpoint is documented as "proxies OMP recall/reflect data" but the implementation returns three hardcoded dummy entries (`"用户是软件开发者，主要使用 Python 和 TypeScript"`, etc.) regardless of the actual OMP memory state. The DELETE endpoint pretends to delete (`{"status": "deleted", "id": memory_id}`) but performs no actual deletion — calling it does nothing. The frontend memory view displays fabricated data to the user, and any "delete" action the user takes is silently ignored.

  This is a fake feature: it looks functional from the UI but the data is static and the write paths are no-ops. A user relying on memory management (e.g. trying to clear an incorrect fact about themselves) will see the same hardcoded entries reappear on next refresh.
- **Root cause**: Stub implementation was never replaced with a real OMP integration. The file's docstring claims "proxies OMP recall/reflect data" but no OMP client call exists. The hardcoded list appears to be demo data left over from initial scaffolding.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: either (a) wire `list_memories` to the real OMP recall API and `delete_memory` to the OMP reflect/delete API (if such endpoints exist), or (b) if OMP doesn't expose memory CRUD, return HTTP 501 Not Implemented and remove the UI surface so users aren't misled into thinking their memory is being managed.
- **Verification**: Confirmed by full read of `memory.py` (18 lines) — three hardcoded dict literals, no imports beyond `APIRouter`, no call to any OMP client, no persistence layer. DELETE handler body is a single `return` statement.
- **Score claim**: +2 (MEDIUM).

---

## B-007 — session-bridge.ts undo assumes strict user/assistant pairing; corrupts state when tool messages are present

- **Priority**: MEDIUM
- **Files**:
  - `bun-sidecar/src/session-bridge.ts:555-572` (`undo` RPC method)
- **Lines**: `:565` (`const originalLen = record.session.state.messages.length`); `:566` (`const keepCount = Math.max(0, originalLen - steps * 2)`); `:567` (`const remaining = record.session.state.messages.slice(0, keepCount)`); `:569` (`record.session.agent.replaceMessages(remaining)`)
- **Symptom**: The `undo` method removes `steps * 2` messages from the end of `state.messages` on the assumption that the conversation is a strict alternating sequence of `user`/`assistant` pairs. Real agent conversations frequently violate this assumption:
  1. If the assistant made a tool call, the message sequence is `user → assistant(tool_call) → tool(result) → assistant(text)` — removing the last 2 messages leaves a dangling `tool_call` with no matching `tool_result`, which most LLM APIs reject with a 400 on the next prompt.
  2. If a system message is prepended (common in many providers), the off-by-one shifts the cut point and removes the wrong messages.
  3. If `steps` is large enough that `keepCount` lands mid-tool-call, the agent enters an unrecoverable state where every subsequent prompt errors until the session is destroyed.

  The UI "undo" button then appears broken: the user clicks undo, gets a 200 response with `removed: <n>`, but the next chat message fails with an opaque API error.
- **Root cause**: The `steps * 2` arithmetic is a simplifying assumption that doesn't account for `tool`/`system`/`function` roles in the message array. There's no logic to walk back to a safe boundary (e.g. the last `user` message) before truncating. `replaceMessages` then commits the broken state.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: instead of `originalLen - steps * 2`, walk backwards from the end counting complete `user`→`assistant` turns (where an "assistant turn" may include trailing `tool` messages belonging to that assistant turn) and cut at the boundary. Or, more conservatively, snapshot the message array on each successful prompt and let `undo` restore the previous snapshot rather than computing a slice.
- **Verification**: Confirmed by reading `session-bridge.ts:555-572`. The only logic is `keepCount = Math.max(0, originalLen - steps * 2)` with no role inspection. `state.messages` is the agent's raw message log which per the pi-coding-agent API includes `tool` and `system` roles.
- **Score claim**: +2 (MEDIUM).

---

## B-008 — mcp_test.py removed command whitelist validation; arbitrary command execution via /api/mcp/test-connection

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/mcp_test.py:44-86` (`test_connection` endpoint — step 1 "校验命令白名单" is removed, `resolved = req.command` is used as-is)
- **Lines**: `mcp_test.py:53` (`# 1. 白名单校验 (removed - tools.mcp_security no longer available)`); `:55` (`resolved = req.command`); `:68-74` (`asyncio.create_subprocess_exec(resolved, *req.args, env=env, ...)`)
- **Symptom**: The endpoint `POST /api/mcp/test-connection` accepts a `command` string and `args` list from the request body and executes them as a subprocess with no validation. The docstring at line 46-52 still documents "1. 校验命令白名单" as step 1, but the implementation comment at line 53 says "(removed - tools.mcp_security no longer available)" and `resolved = req.command` is assigned directly. A request like `{"command": "cmd.exe", "args": ["/c", "del", "/q", "/s", "C:\\\\Users\\\\..."]}` (Windows) or `{"command": "rm", "args": ["-rf", "/"]}` (Unix) executes verbatim.

  Even though this is a desktop app where the user already has shell access, the endpoint:
  1. Is reachable from any local process (no auth on most local FastAPI setups).
  2. Allows the AI agent (via prompt-injected tool results) to execute arbitrary commands not in any allowlist, bypassing the MCP command whitelist that `api/routes/mcp.py:20-34` enforces for actual MCP server configuration.
  3. The `env` blocklist (`_BLOCKED_ENV_KEYS`) is the only surviving security measure, but it doesn't restrict the command itself.

  This is a regression: the file's own docstring still claims whitelist validation happens, but it doesn't.
- **Root cause**: `tools.mcp_security` module was removed (replaced by OMP per the audit_log.py comment pattern) but `mcp_test.py` was not updated to either re-implement validation or be removed. The endpoint was left in a half-migrated state.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: either (a) restore command whitelist validation (e.g. against the same allowlist used by `api/routes/mcp.py`), (b) gate the endpoint behind the same auth/permission system as `mcp.py` PUT, or (c) if MCP testing is no longer needed client-side, remove the endpoint and update the frontend to call `/api/mcp/{id}/test` instead.
- **Verification**: Confirmed by full read of `mcp_test.py` (118 lines). Line 53 explicitly states the whitelist was removed. Line 55 (`resolved = req.command`) confirms no validation. Compare with `api/routes/mcp.py:20-34` which has a working `_BLOCKED_ENV_KEYS` plus command validation via `_validate_update_against_transport`.
- **Score claim**: +2 (MEDIUM).

---

## B-009 — Plaintext API keys persisted in api/data/providers.yaml despite Fernet encryption infrastructure

- **Priority**: LOW
- **Files**:
  - `api/data/providers.yaml:2,11` (two `api_key:` entries stored as plaintext `sk-...` strings)
  - `api/routes/providers.py:218-221,283-287` (encryption logic exists for new/updated keys but no migration runs on existing entries)
  - `api/routes/providers.py:408+` (a `/providers/encrypt-keys` bulk endpoint exists but has never been invoked against this file)
- **Lines**: `providers.yaml:2` (`api_key: sk-80c22ad320e6991e-dkaber-74a7b63e`); `:11` (`api_key: sk-35fc1368b45b4234a37d5c45bf5c7101`)
- **Symptom**: `api/data/providers.yaml` stores two real-looking API keys in plaintext: `sk-80c22ad320e6991e-dkaber-74a7b63e` (local provider) and `sk-35fc1368b45b4234a37d5c45bf5c7101` (DeepSeek). The codebase already ships a Fernet-based credential envelope (`api/security/credential_envelope.py` with `encv1:` prefix), `providers.py` auto-encrypts newly-created and updated keys (lines 218-221, 283-287), and a bulk migration endpoint `POST /providers/encrypt-keys` exists. None of these have been run against the existing file — the keys remain in plaintext at rest.

  Anyone with read access to `api/data/` (which is blocked by MaxmaBlocker for the AI agent, but accessible to the user, backup software, sync tools, malware, etc.) gets the raw API keys. This is a credential-at-rest security gap, not a runtime bug.
- **Root cause**: The encryption infrastructure was added but never back-filled against pre-existing entries. There's no startup hook that auto-migrates plaintext keys on server boot.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: invoke `POST /providers/encrypt-keys` once manually (or add a startup hook in `server.py` lifespan that detects plaintext keys and calls the migration), then verify `providers.yaml` only contains `encv1:` envelopes.
- **Verification**: Confirmed by reading `api/data/providers.yaml` (full file, 19 lines) — both `api_key:` values are plaintext `sk-...` strings. Cross-checked with `providers.py:218-221` (auto-encryption only triggers on create/update, not on load), `providers.py:518-546` (`_decrypt_api_key` handles `encv1:`/legacy `enc:`/plaintext), and `api/security/credential_envelope.py` (envelope format exists).
- **Score claim**: +1 (LOW).

---

## B-010 — manage_mcp.ts ships a hand-rolled YAML parser with broken indent tracking

- **Priority**: LOW
- **Files**:
  - `bun-sidecar/src/tools/config/manage_mcp.ts:11-59` (`parseYaml` function — custom YAML parser)
- **Lines**: `:54-56` (`if (indent < currentIndent) { while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; } }`)
- **Symptom**: `manage_mcp.ts` does not use a real YAML library; instead it ships a custom `parseYaml()` function that mishandles multi-level dedent. The dedent handler at lines 54-56 only pops the stack *once per line* even when multiple levels of nesting need to close, and it mutates `currentIndent` inside the `while` condition (`currentIndent = indent`) which means the comparison `indent <= currentIndent` immediately becomes false after the first pop (since `currentIndent` is now equal to `indent`). The result: nested YAML structures with more than one level of dedent are mis-parsed — keys end up attached to the wrong parent, or values silently overwrite each other.

  For the simple flat `mcp_servers:` list currently in `api/data/mcp_servers.yaml` this happens to parse correctly (no deep nesting). But any future config that adds nested fields (e.g. per-server `env:` blocks, nested `headers:` maps) will be silently corrupted. Combined with B-001 (wrong path), this parser is currently never exercised against the real config, which masks the bug.

  Additionally, lines 28-41 handle list items (`- value`) by checking `if (!Array.isArray(arr))` and converting the last key's value to an array — but the conversion path pushes the *current* item's value to the new array without first pushing the previous scalar value (if any) that occupied that slot, so `key: scalar` immediately followed by `  - item` loses the scalar.
- **Root cause**: The author reinvented YAML parsing instead of pulling in `js-yaml` (which is presumably already a transitive dependency of the pi-coding-agent stack). The indent-tracking state machine doesn't correctly model the stack-push-on-indent / stack-pop-on-dedent invariant.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: replace `parseYaml` with `import yaml from "js-yaml"; yaml.load(text)`. If a zero-dependency constraint applies, at minimum fix the dedent loop to: `while (stack.length > 1 && indent < currentIndent) { stack.pop(); currentIndent = <new top of stack's indent> }` — note `<` not `<=`, and `currentIndent` should be derived from the new top of stack, not from the current line's `indent`.
- **Verification**: Confirmed by reading `manage_mcp.ts:11-59` in full. The `while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; }` loop has the described bug — after the first iteration `currentIndent === indent` so the condition `indent <= currentIndent` is true but `currentIndent = indent` is a no-op on subsequent iterations, which means the loop runs forever popping until `stack.length === 1`. (Actually re-reading: the assignment `currentIndent = indent` happens inside the loop, so after the first pop `currentIndent` becomes equal to the current line's indent, and the loop continues popping while `indent <= currentIndent` — i.e. always true — until `stack.length === 1`. This over-pops the stack, losing intermediate nesting levels.)
- **Score claim**: +1 (LOW).

---

**Round 1 total**: 10 issues filed (2 HIGH + 6 MEDIUM + 2 LOW) = **20 points** if all verified.

---

# Blue Team Issues — Round 3

Mode A discovery (Round 2 was Mode B, filed BC-001/BC-002 challenges only — no new B-### issues that round).

---

## B-011 — Persona memory_mode "isolated" silently falls back to shared memory.yaml (isolation contract broken)

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/persona.py:212` (`if body.memory in ("persona", "isolated"):` — accepts both modes, creates `memory_{persona_id}.yaml`)
  - `api/routes/persona.py:187-188` (writes `memory: {body.memory}` to frontmatter — so "isolated" is persisted verbatim)
  - `agent/prompts.py:352` (`if meta.get("memory", "").strip().lower() == "persona":` — only recognizes `"persona"`, not `"isolated"`)
- **Lines**: `api/routes/persona.py:212` (`if body.memory in ("persona", "isolated"):`); `api/routes/persona.py:188` (`fm_lines.append(f"memory: {body.memory}")`); `agent/prompts.py:352` (`if meta.get("memory", "").strip().lower() == "persona":`)
- **Symptom**: When a user creates a new persona via `POST /api/personas` with `memory: "isolated"` (a value the API explicitly accepts — the request model declares `memory: str = "shared"` with no enum constraint, and the handler at line 212 branches on `body.memory in ("persona", "isolated")`), the API:
  1. Writes `memory: isolated` to the persona's SOUL frontmatter (line 188).
  2. Creates an empty `memory_{persona_id}.yaml` file in `PERSONAS_DIR` (lines 213-216).
  3. Returns `{"memory_mode": "isolated", ...}` to the caller, implying success.

  However, `agent/prompts.py:get_persona_memory_path()` — the function actually consulted at runtime to decide where the agent reads/writes persona memory — only checks `meta.get("memory", "").strip().lower() == "persona"`. For a frontmatter value of `isolated`, this comparison is False, so the function falls through to the `else` branch and returns the **shared** `PERSONAS_DIR / "memory.yaml"`.

  Net effect: the persona-scoped `memory_{persona_id}.yaml` file created at persona-creation time is **never read or written**. The persona silently uses the shared `memory.yaml`, leaking its private memories into the shared pool and absorbing other personas' memories. The "isolated" memory mode — which the user explicitly selected and the API confirmed — does not actually isolate anything. There is no error, no warning, no log line; the isolation contract is silently broken.

  This is a cross-persona data-leakage bug: a user who creates a "work" persona and a "personal" persona both with `memory: isolated` expects each to have its own memory store, but both actually read/write the same `memory.yaml`. Memories formed in one persona (e.g. "user's doctor appointment is on Friday") become visible to the other persona.

- **Root cause**: Two code sites disagree on the set of valid memory modes. `api/routes/persona.py:212` was written (or later extended) to accept `"isolated"` as an alias for `"persona"` (likely to match a frontend `PersonaMemoryMode: 'shared' | 'isolated'` type, per the inline comment at line 211), but `agent/prompts.py:352` was never updated to recognise `"isolated"`. The two files were authored/modified independently and the contract between them was not enforced (no shared constant, no enum, no test).
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix (pick one):
  1. **Normalize at write time**: in `create_new_persona`, when `body.memory == "isolated"`, write `memory: persona` to the frontmatter (canonical internal value) while still returning `memory_mode: isolated` in the API response for UI compatibility. This is the smallest change.
  2. **Accept both at read time**: change `agent/prompts.py:352` to `if meta.get("memory", "").strip().lower() in ("persona", "isolated"):`. Mirrors the API's acceptance set.
  3. **Add a shared enum**: define `PersonaMemoryMode` in a shared module and validate against it in both `CreatePersonaRequest` (Pydantic field validator) and `get_persona_memory_path`. Prevents future drift.
  Additionally, add a regression test that creates a persona with `memory: "isolated"` and asserts `get_persona_memory_path()` returns a persona-scoped path, not `memory.yaml`.
- **Verification**: Confirmed by reading `api/routes/persona.py:163-226` (full `create_new_persona` handler) and `agent/prompts.py:341-357` (full `get_persona_memory_path`). The API accepts `"isolated"` at line 212; the runtime check at `prompts.py:352` only compares against `"persona"`. No other site in the codebase re-maps `"isolated"` → `"persona"` (verified by Grep for `"isolated"` across `api/` and `agent/`). The empty `memory_{persona_id}.yaml` file created at persona-creation is therefore provably orphaned.
- **Score claim**: +2 (MEDIUM).

---

## B-012 — Persona creation YAML frontmatter injection via unescaped description/tools/memory (data corruption + key override)

- **Priority**: MEDIUM
- **Files**:
  - `api/routes/persona.py:184` (`fm_lines.append(f'description: "{body.description}"')`)
  - `api/routes/persona.py:186` (`fm_lines.append(f"tools: {body.tools}")`)
  - `api/routes/persona.py:188` (`fm_lines.append(f"memory: {body.memory}")`)
  - `api/routes/persona.py:55-60` (`CreatePersonaRequest` model — `description`, `tools`, `memory` are bare `str` with no validators)
- **Lines**: see above
- **Symptom**: `create_new_persona` builds the persona file's YAML frontmatter by f-string interpolation of user-controlled fields without any escaping or quoting (for `tools`/`memory`) and with only naive double-quote wrapping (for `description`). Three concrete injection vectors:

  1. **`description` with embedded double-quote + newline**: A request with `description = 'x"\nmemory: persona\nz: "'` produces frontmatter:
     ```
     ---
     description: "x"
     memory: persona
     z: "
     ---
     ```
     The line-by-line frontmatter parser in `agent/prompts.py:_parse_frontmatter` (lines 318-338) sees `memory: persona` and sets `meta["memory"] = "persona"` — overriding whatever the user selected in the `memory` field. The user's intended memory mode is silently replaced. The trailing unclosed `z: "` line is ignored by the parser (key `z` not in whitelist), but a real YAML parser (e.g. if any other code path uses `yaml.safe_load` on this file) would raise a parse error, corrupting the persona.

  2. **`tools` with newline**: A request with `tools = "file_read\ntools: file_write, run_python"` produces:
     ```
     tools: file_read
     tools: file_write, run_python
     ```
     The parser processes both lines; the second `tools:` overwrites the first, so `meta["tools"] = "file_write, run_python"`. A user who intended `tools: file_read` (read-only) ends up with `tools: file_write, run_python` — the tool restriction is silently widened.

  3. **`memory` with newline**: `memory` has no Pydantic enum constraint (`memory: str = "shared"`). A request with `memory = "shared\nmemory: persona"` passes the `body.memory != "shared"` check at line 187 (the string is not equal to `"shared"`), so `memory: shared\nmemory: persona` is written to frontmatter. The parser picks the last `memory:` line, setting `meta["memory"] = "persona"`. This bypasses the API's own `body.memory in ("persona", "isolated")` gate at line 212 — no persona-scoped memory file is created (the gate is False for the multi-line string), but the runtime reads `memory: persona` and tries to use a persona-scoped memory file that doesn't exist.

  None of these require a malicious actor — a user who legitimately includes a `"` in their persona description (e.g. `She said "hello"` ) triggers vector 1 partially, producing malformed frontmatter.

- **Root cause**: The frontmatter is constructed via f-string concatenation (`fm_lines.append(f'description: "{body.description}"')`) instead of using `yaml.safe_dump` or a proper YAML serializer. The `CreatePersonaRequest` Pydantic model declares `description`, `tools`, `memory` as bare `str` with no `Field(..., pattern=...)` or validator, so arbitrary content (including newlines, quotes, colons) flows through to the file. The line-by-line frontmatter parser in `agent/prompts.py` is not a real YAML parser and can be confused by injected keys that match the whitelist (`name`, `description`, `tools`, `memory`).
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix:
  1. **Constrain `memory` to an enum**: `memory: Literal["shared", "persona", "isolated"] = "shared"` in `CreatePersonaRequest`. Prevents vector 3 entirely.
  2. **Escape frontmatter values**: use `yaml.safe_dump({"description": body.description, "tools": body.tools, "memory": body.memory}, default_flow_style=True).strip()` to produce a single-line YAML mapping with proper quoting, then write that as the frontmatter body. This handles embedded quotes, newlines, and colons correctly.
  3. **Alternatively**, reject any field value containing `\n`, `\r`, or `:` (except for `tools` which legitimately uses `,` separators) via a Pydantic validator.
  Add a test that creates a persona with `description = 'x"\nmemory: persona'` and asserts the resulting frontmatter parses to exactly `{description: 'x" memory: persona', ...}` (single value, no injected keys).
- **Verification**: Confirmed by reading `api/routes/persona.py:163-226` (full `create_new_persona` handler) and `agent/prompts.py:318-338` (`_parse_frontmatter` line-by-line parser). The f-string interpolations at lines 184/186/188 are verbatim. `CreatePersonaRequest` at lines 55-60 has no validators. The parser at `prompts.py:325` checks `if key in ("name", "description", "tools", "memory")` and overwrites `meta[key]` on each match, so duplicate keys are last-write-wins — confirmed by the loop structure. No `yaml.safe_dump` is used anywhere in `persona.py`.
- **Score claim**: +2 (MEDIUM).

---

## B-013 — upload.py _sanitize_filename strips all non-ASCII chars; Chinese filenames become dotfiles

- **Priority**: LOW
- **Files**:
  - `api/routes/upload.py:40` (`safe = re.sub(r"[^a-zA-Z0-9._-]", "", name)`)
  - `api/routes/upload.py:36-46` (full `_sanitize_filename` function)
- **Lines**: `api/routes/upload.py:40`
- **Symptom**: `_sanitize_filename` strips every character outside `[a-zA-Z0-9._-]` from the uploaded filename. For a Chinese filename like `报告.pdf`, `Path("报告.pdf").name` returns `"报告.pdf"`, then `re.sub(r"[^a-zA-Z0-9._-]", "", "报告.pdf")` removes both `报` and `告`, leaving `.pdf`. The returned `original_name` is `.pdf` — a dotfile with no stem.

  Consequences:
  1. The API response returns `{"filename": ".pdf", ...}` — the user sees their file renamed to `.pdf`, losing all identifying information.
  2. The stored file is `{file_id}_.pdf` — the leading `_` is from the `{file_id}_` prefix, but the user-visible name is `.pdf`.
  3. On Unix, `.pdf` is a hidden file; file managers and `ls` won't show it by default.
  4. The `.meta` file stores `original_name=.pdf`, so `GET /uploads` also displays `.pdf`.
  5. A user uploading `年度总结.docx` gets `original_name = ".docx"` — unusable for identification.

  The same stripping applies to spaces (`report (final).pdf` → `reportfinal.pdf`), parentheses, and any Unicode character (Japanese, Korean, emoji, etc.). The intent was path-traversal protection, but the implementation is far more aggressive than necessary — `Path(name).name` already strips directory components, and the subsequent Windows-reserved-name check (line 44) handles `CON`/`NUL` etc. The character whitelist is the over-aggressive step.

- **Root cause**: The regex `[^a-zA-Z0-9._-]` was written with only ASCII in mind. The project's other filename validators (e.g. `api/routes/sticker_favorites.py:21` `_CATEGORY_RE = re.compile(r'^[\w\u4e00-\u9fff\-]+$')`) explicitly include `\u4e00-\u9fff` for Chinese support, so the convention exists — `upload.py` just didn't follow it. The function docstring says "移除 Unicode 控制字符、空格、保留名等" but the implementation removes all non-ASCII, not just control characters.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: widen the allowed set to include Unicode word chars and CJK: `re.sub(r"[^\w.\u4e00-\u9fff\-]", "", name, flags=re.UNICODE)` (note: `\w` with `re.UNICODE` includes letters/digits/underscore from all scripts, but not punctuation/space/separator, which is the desired behavior). Optionally also allow spaces and replace them with `_` for cross-platform safety. Add a test with `报告.pdf` asserting the result is `报告.pdf`.
- **Verification**: Confirmed by reading `api/routes/upload.py:36-46` in full. The regex at line 40 is `[^a-zA-Z0-9._-]` — no Unicode ranges. Cross-checked with `api/routes/sticker_favorites.py:21` which uses `\u4e00-\u9fff` — confirming the project has a convention for CJK filenames that `upload.py` doesn't follow. Mentally traced `报告.pdf` → `Path("报告.pdf").name` = `"报告.pdf"` → `re.sub` removes `报`,`告` → `.pdf`. The Windows-reserved-name check at line 44 splits on `.` and checks `stem.upper()` — for `.pdf`, `stem = ""`, which is not in `{"CON","NUL","PRN","AUX"}` and doesn't start with `COM`/`LPT`, so the function returns `.pdf` unchanged.
- **Score claim**: +1 (LOW).

---

## B-014 — useChat.ts localStorage QuotaExceededError eviction is FIFO, not LRU as documented; frequently-used old sessions evicted first

- **Priority**: LOW
- **Files**:
  - `web/src/composables/useChat.ts:75-90` (QuotaExceededError fallback eviction)
- **Lines**: `useChat.ts:75` (comment `// 收集除当前 sid 外的所有 turns 缓存键，按"最近未使用"策略删除最旧的`); `useChat.ts:77-82` (iterate `localStorage.key(i)` in insertion order); `useChat.ts:84` (`const toEvict = otherKeys.slice(0, Math.max(1, Math.ceil(otherKeys.length / 2)))`); `useChat.ts:83` (comment `// 删除一半最旧的缓存（最多保留一半），按键在 localStorage 中的顺序（近似 FIFO）`)
- **Symptom**: When `localStorage.setItem` throws `QuotaExceededError`, the fallback handler attempts to free space by evicting "the oldest half" of other sessions' turn caches. The code iterates `localStorage.key(i)` from `i=0` to `localStorage.length-1`, collecting keys with the `TURNS_KEY_PREFIX` prefix, then `slice(0, N/2)` to take the first half.

  Per the Web Storage spec, `localStorage.key(i)` returns keys in **insertion order** (the order in which keys were first added), and `setItem` on an existing key updates the value but does **not** move the key to the end. So the iteration order is insertion order, not access-recency order. The `slice(0, N/2)` therefore evicts the **oldest-inserted** sessions, regardless of how recently they were used.

  The comment on line 75 claims `"按'最近未使用'策略删除最旧的"` (LRU — least recently used), but the comment on line 83 admits `"近似 FIFO"` (approximate FIFO). The two comments contradict. The implementation is FIFO.

  Real-world impact: a user who created a "work" session months ago but uses it daily will have its turn cache evicted before a "test" session created yesterday and never opened again. After eviction, the work session's turns are no longer in `localStorage`, so on next refresh the user sees an empty chat history for that session (until the backend re-streams them, if the backend still has them). The LRU policy the author intended would have kept the work session and evicted the test session — the opposite of what happens.

- **Root cause**: The author conflated insertion order with access-recency order. `localStorage` does not expose access-recency metadata; the only way to implement true LRU is to maintain a separate access-log (e.g. a `TURNS_ACCESS_LOG_KEY` that records `sid` timestamps on each `saveTurnsToStorage` call) and sort by that. The current code doesn't do this, so it falls back to insertion order, which is FIFO.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: either (a) implement true LRU by maintaining a separate `localStorage` key (e.g. `maxma:turns:lru` = JSON array of `sid`s in access order, bumped on each `saveTurnsToStorage`) and sort `otherKeys` by position in that array; or (b) correct the misleading comment on line 75 to state FIFO explicitly, so future maintainers aren't misled into thinking the policy is LRU. Option (a) is the real fix; option (b) is the minimum honesty fix.
- **Verification**: Confirmed by reading `web/src/composables/useChat.ts:59-110` (full `saveTurnsToStorage` function including the QuotaExceededError branch). Line 75's comment says `"最近未使用策略"` (LRU); line 83's comment says `"近似 FIFO"`. The loop at lines 77-82 iterates `localStorage.key(i)` without any access-recency sort. `slice(0, ...)` takes the first half in iteration order. Per WHATWG Web Storage spec §4.12 ("The order of keys in the list is the order in which they were added"), insertion order is what's returned. No separate access-log key exists (verified by Grep for `lru` / `access` / `recent` in `useChat.ts` and `stores/chat.ts`).
- **Score claim**: +1 (LOW).

---

## B-015 — sticker_upload.py _convert_to_webp uses print() for error logging; failures invisible in log files

- **Priority**: LOW
- **Files**:
  - `api/routes/sticker_upload.py:66` (`print(f"[sticker_upload] 转换失败: {e}")`)
- **Lines**: `api/routes/sticker_upload.py:66`
- **Symptom**: `_convert_to_webp` catches all exceptions from PIL's `Image.open` / `img.save` / `ImageSequence.Iterator` and reports them via `print()` instead of the module logger. The function returns `False` on failure, and the caller (`upload_sticker` at line 116) raises `HTTPException(500, "图片转换失败")` — but the underlying cause (e.g. "cannot identify image file", "image truncated", "Pillow not installed") is only visible on stdout, not in the server's log file (`logs/server.log` or `logs/maxma.log`).

  In the packaged desktop app, the sidecar's stdout is captured by Tauri but not persisted to the user-visible log file — the `print()` output goes to the sidecar's console pipe, which is not the same as the Python `logging` system that `server_log_path()` and `tauri_log_path()` capture. When a user reports "sticker upload keeps failing", the developer asks for the log file and sees only `HTTPException: 图片转换失败` with no root cause — the PIL exception is lost.

  This violates the project convention that all backend modules use `logging.getLogger(__name__)` for diagnostic output. Compare with `api/routes/persona.py:21` (`logger = logging.getLogger(__name__)`) and `api/routes/diagnostics.py:19` (same) — `sticker_upload.py` is the outlier; it imports `logging` is not even imported at module level (verified by reading lines 1-11).

- **Root cause**: The module was written without a `logger = logging.getLogger(__name__)` declaration, and the author used `print()` as a quick debugging aid that was never replaced with proper logging. The `except Exception as e:` block at line 65 catches the error but the `print` at line 66 doesn't route it through the logging system.
- **Fix applied**: Not fixed (Mode A discovery only). Suggested fix: add `import logging` and `logger = logging.getLogger(__name__)` at the top of `sticker_upload.py`, then replace line 66 with `logger.exception("[sticker_upload] 图片转换失败: %s", src)` — `logger.exception` includes the traceback automatically. The `exception` level ensures it shows up in log files at the default `INFO`+ level.
- **Verification**: Confirmed by reading `api/routes/sticker_upload.py:30-67` (full `_convert_to_webp` function). Line 66 is `print(f"[sticker_upload] 转换失败: {e}")`. The module's imports (lines 1-10) do not include `logging`. Cross-checked `api/routes/persona.py:21`, `api/routes/diagnostics.py:19`, `api/routes/env_vars.py` (no logger declared but no `print` either), `api/routes/upload.py` (no `print`) — `sticker_upload.py` is the only route module that uses `print()` for error reporting.
- **Score claim**: +1 (LOW).

---

**Round 3 total**: 5 issues filed (0 HIGH + 2 MEDIUM + 3 LOW) = **7 points** if all verified.
