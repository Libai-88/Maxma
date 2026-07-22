# Arbiter Verification — Round 1 Blue

## Verification approach
- Re-read `rounds/round-1/blue/review.md` and `handoff.md`
- For each B-NNN, spot-checked the cited file:line citations to confirm the claim
- Verified key infrastructural claims (sidecar `cwd`, config tool path resolution, `compact` method absence, `mcp_test.py` whitelist removal, plaintext API keys, no asyncio.Lock in balance.py)
- No code edits made by Blue (Mode A) — no test runs needed

## Per-issue audit

### B-001 — Sidecar config tools use wrong base path (HIGH) ✅ VERIFIED
- **Evidence**: `api/pi_bridge/sidecar_manager.py:127` sets `cwd=str(SIDECAR_DIR)` where `SIDECAR_DIR = bun-sidecar/`. All 5 bun-sidecar config tools (`manage_mcp.ts:72`, `manage_skills.ts:31`, `manage_env_vars.ts:31`, `manage_whitelist.ts:22`, `manage_macros.ts:26`) use `path.resolve(process.cwd(), <RELATIVE>)`. Real configs live at `api/data/mcp_servers.yaml`, `api/data/path_whitelist.yaml`, project-root `.env`, project-root `macros/`, project-root `anthropic_skills/` — confirmed via Glob.
- **Severity**: HIGH. Every config tool silently no-ops or writes to phantom paths. Functional + data-integrity impact.
- **Verdict**: ✅ Award **+3** (high).

### B-002 — Agent runs with wrong cwd (HIGH) ✅ VERIFIED
- **Evidence**: `api/routes/chat.py:173` literally sends `"cwd": "."`. `bun-sidecar/src/session-bridge.ts:442` resolves `const cwd = params?.cwd ?? process.cwd()`. Combined with B-001, agent's cwd resolves to `bun-sidecar/`. Agent cannot see user's project files via relative paths.
- **Severity**: HIGH. Agent fundamentally cannot operate on user's project.
- **Verdict**: ✅ Award **+3** (high).

### B-003 — `compact` RPC method unimplemented (MEDIUM) ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/session-bridge.ts` dispatches only 7 methods: `create_session` (431), `prompt` (480), `cancel` (516), `destroy_session` (534), `get_health` (550), `undo` (555), `get_messages` (574). No `compact`. `api/routes/session_compress.py:42` calls `client.call("compact", ...)`. Falls through to `sendError(id, "Unknown method: compact")`.
- **Severity**: MEDIUM. UI button is non-functional; silently degrades.
- **Verdict**: ✅ Award **+2** (medium).

### B-004 — `manage_macros.ts` path traversal (MEDIUM) ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/tools/config/manage_macros.ts:51,61` uses `path.resolve(macrosDir, params.name)` with no validation. `params.name = "../../etc"` traverses. Delete uses `fs.rmSync(macroDir, { recursive: true, force: true })` — dangerous. Python equivalent `api/routes/macros.py:25-31` has `_MACRO_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')` — bun-sidecar port missing this guard.
- **Severity**: MEDIUM. Path traversal + recursive delete. Agent or prompt-injected tool result can trigger.
- **Verdict**: ✅ Award **+2** (medium).

### B-005 — `balance.py` singleton race condition (MEDIUM) ✅ VERIFIED
- **Evidence**: `api/routes/balance.py:13-35` has `_shared_async_client` module-level singleton. `_get_async_client()` is sync `def` (not `async def`), check-then-assign with no `asyncio.Lock`. Violates project convention "Async locks required for global state". `SessionManager`, `WebSocketRegistry`, `ActivityHub`, `TokenBucket` all use locks.
- **Severity**: MEDIUM. TOCTOU race leaks 20-connection pool per occurrence.
- **Verdict**: ✅ Award **+2** (medium).

### B-006 — `/memory` endpoint returns hardcoded data (MEDIUM) ✅ VERIFIED
- **Evidence**: `api/routes/memory.py` (18 lines) returns 3 hardcoded dict literals. DELETE returns `{"status": "deleted", "id": memory_id}` with no persistence. Docstring claims "proxies OMP recall/reflect data" but no OMP client call.
- **Severity**: MEDIUM. UI shows fabricated data; user actions silently ignored.
- **Verdict**: ✅ Award **+2** (medium).

### B-007 — `undo` method `steps * 2` truncation broken for tool calls (MEDIUM) ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/session-bridge.ts:566` `keepCount = Math.max(0, originalLen - steps * 2)`. No role inspection. Real conversations have `user → assistant(tool_call) → tool(result) → assistant(text)` patterns; removing last 2 leaves dangling `tool_call` without matching `tool_result`, which most LLM APIs reject with 400 on next prompt.
- **Severity**: MEDIUM. UI undo appears to work but next chat fails with opaque error.
- **Verdict**: ✅ Award **+2** (medium).

### B-008 — `mcp_test.py` no command validation (MEDIUM) ✅ VERIFIED
- **Evidence**: `api/routes/mcp_test.py:53` comment "(removed - tools.mcp_security no longer available)"; `:55` `resolved = req.command` with no validation; `:68` `asyncio.create_subprocess_exec(resolved, *req.args, env=env, ...)`. Docstring still claims "1. 校验命令白名单". Endpoint accepts any command string and executes it.
- **Severity**: MEDIUM. Arbitrary command execution via API. Mitigated by being a local dev endpoint, but still a real regression.
- **Verdict**: ✅ Award **+2** (medium).

### B-009 — Plaintext API keys in providers.yaml (LOW) ✅ VERIFIED
- **Evidence**: `api/data/providers.yaml:2,11` have plaintext `sk-...` values. `api/security/credential_envelope.py` exists with `encv1:` prefix; `providers.py:218-221` auto-encrypts on create/update; `POST /providers/encrypt-keys` bulk migration endpoint exists. None have been run against existing file.
- **Mitigation**: `providers.yaml` IS in `.gitignore` (line 74, 76), so source-leak risk is low. At-rest security concern remains.
- **Severity**: LOW. Correctly classified.
- **Verdict**: ✅ Award **+1** (low).

### B-010 — Broken YAML parser in `manage_mcp.ts` (LOW) ✅ VERIFIED
- **Evidence**: `bun-sidecar/src/tools/config/manage_mcp.ts:54-56`:
  ```ts
  if (indent < currentIndent) {
    while (stack.length > 1 && indent <= currentIndent) { stack.pop(); currentIndent = indent; }
  }
  ```
  After first pop, `currentIndent = indent` makes condition `indent <= currentIndent` trivially true (`indent <= indent`). Loop over-pops until `stack.length === 1`, losing intermediate nesting.
- **Severity**: LOW. Currently masked because (a) config is flat, (b) B-001 means parser is never exercised against real config.
- **Verdict**: ✅ Award **+1** (low).

## Scoring
- Blue Round 1 issues: 2 HIGH + 6 MEDIUM + 2 LOW = 2×3 + 6×2 + 2×1 = **+20 points**
- **Blue running total**: 20
- **Red running total**: 5 (unchanged)

## Cross-team note
Per superma rules: "Red may fix open Blue issues (B-###) directly — no need to re-file as R-###." Red team in Round 2 should address B-001 through B-010 (or as many as feasible), prioritizing HIGH (B-001, B-002) and MEDIUM issues with security impact (B-004, B-005, B-008).

## Round 1 totals
- Red: 1H + 1M + 0L = 5 points
- Blue: 2H + 6M + 2L = 20 points
- New medium/high issues this round: 8 (1+1 from Red, 2+6 from Blue) — well above zero
- `consecutive_empty_rounds`: 0 (reset because new medium/high issues were found)

## Contest continues
Round 2 will be Red team's opportunity to fix Blue's discoveries (cross-team fixing). Blue team in Round 2 can either find new bugs OR challenge Red's Round 2 fixes.
