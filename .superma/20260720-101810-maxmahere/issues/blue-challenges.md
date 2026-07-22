# Blue Team Challenges — Round 2 (Mode B)

Append-only log of challenges filed by Blue against Red's Round 2 fixes for
B-001..B-010. Each challenge references the B-NNN it targets and includes a
concrete repro.

---

## BC-001 — Red's rewritten `parseYaml` mis-parses the project's own `api/data/mcp_servers.yaml` (B-010 fix is incomplete)

- **Target**: B-010 (LOW) — `bun-sidecar/src/tools/config/manage_mcp.ts`
- **Claim**: Red's rewritten `parseYaml` (lines 20-83) still produces wrong output for the project's *actual* `api/data/mcp_servers.yaml`. The `args` list loses 2 of 3 items, and `D:/Maxma` is parsed as `{D: "/Maxma"}` instead of the string `"D:/Maxma"`. The B-010 fix therefore does not actually fix the parser for the real config — it only fixed the dedent loop in isolation, leaving a second bug in the list-item branch (`colonIdx > 0` misfires on any list item containing a colon, treating it as `"- key: value"` syntax and producing an object instead of a string).
- **Evidence**:
  - **Source of bug**: `bun-sidecar/src/tools/config/manage_mcp.ts:40-64` — the list-item branch unconditionally runs `const colonIdx = val.indexOf(":"); if (colonIdx > 0) { ... obj[k] = v; arr.push(obj); ... }` whenever a list item contains a colon. For a list item like `D:/Maxma`, this creates `obj = { D: "/Maxma" }` and pushes the object — silently losing the string form. List items that don't contain a colon (`-y`, `'@modelcontextprotocol/server-filesystem'`) are pushed via the `else` branch (`arr.push(coerceScalar(val))`), but the stack manipulation in the `if` branch (line 61: `stack.push({ indent, node: obj })`) corrupts subsequent parsing of sibling list items.
  - **Real config**: `api/data/mcp_servers.yaml` (B-001 fix made `manage_mcp.ts` actually read this file):
    ```yaml
    mcp_servers:
    - args:
      - -y
      - '@modelcontextprotocol/server-filesystem'
      - D:/Maxma
      command: npx
      description: 文件系统 MCP - 读写 D:/Maxma 目录
      enabled: true
      server_id: filesystem
      transport: stdio
    ```
  - **Repro**: `rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` — imports Red's `parseYaml` verbatim and runs it against the real config file. Output:
    ```json
    {
      "mcp_servers": [
        {
          "args": [ { "D": "/Maxma" } ],
          "command": "npx",
          "description": "文件系统 MCP - 读写 D:/Maxma 目录",
          "enabled": true,
          "server_id": "filesystem",
          "transport": "stdio"
        }
      ]
    }
    ```
    Expected `args`: `["-y", "@modelcontextprotocol/server-filesystem", "D:/Maxma"]` (3 string items).
    Actual `args`: `[{"D":"/Maxma"}]` (1 object item, 2 items lost, `D:/Maxma` mis-typed as dict).
  - **Run**: `node .superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` from project root. Exit code 1 = bug confirmed.
  - **Why Red's verification missed it**: Red's `review.md` says "Code review confirms the loop correctly stops popping at the first ancestor with strictly smaller indent." — true for the dedent loop, but Red never ran the parser against the real config file. The arbiter's verification (line 46) likewise only confirmed the dedent loop's `>=` operator was correct, not end-to-end behavior.
- **Severity**: MEDIUM (was LOW). The bug silently corrupts the MCP server config: `manage_mcp` `list` returns `npx` as the command (correct by accident — `command: npx` is a simple scalar), but `get` returns a malformed `args` array. Any downstream code that spawns MCP servers from this config would invoke `npx` with no args (or with `[{D:"/Maxma"}]` stringified), breaking every MCP server defined with path-like arguments. Windows paths (`D:/...`, `C:/...`) and any list items containing `:` (URLs, key=value strings, timestamps) trigger this. Since B-001 was also fixed this round, the parser is now *actually reached* — the bug is no longer masked.
- **Suggested fix**: In the list-item branch, only treat the item as `"- key: value"` syntax when the *parent* is expected to be a list-of-dicts (i.e. when the parsed `obj` will become a dict entry in a sequence). For the `args:` case (list-of-scalars), always push `coerceScalar(val)` and do NOT push a new stack frame. Concretely, change lines 53-64 to:
  ```ts
  // Only treat as "- key: value" when the colon is NOT part of a scalar
  // like a Windows path (D:/foo) or URL. A safe heuristic: require the
  // key to be a valid YAML identifier AND not be a single letter followed
  // by a path separator. Better: only enter the obj branch when the
  // *parent* expects a list-of-dicts, which for the mcp_servers schema
  // is the top-level `mcp_servers:` list — not nested `args:` lists.
  const colonIdx = val.indexOf(":");
  const looksLikeMapping = colonIdx > 0
    && /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(val.slice(0, colonIdx).trim())
    && !val.slice(colonIdx + 1).trim().startsWith("/");
  if (looksLikeMapping) {
    // ... existing obj branch ...
  } else {
    arr.push(coerceScalar(val));
  }
  ```
  Alternatively, just delete the inline-mapping branch entirely — the current `mcp_servers.yaml` schema never uses `- key: value` inline syntax; each server's fields are on their own lines (`command: npx`, `server_id: filesystem`, etc.). The inline branch is dead code that corrupts scalar list items.
- **Verification**: Run `node .superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` from project root. Pre-fix: exit 1, output shows `args: [{"D":"/Maxma"}]`. Post-fix: exit 0, output shows `args: ["-y","@modelcontextprotocol/server-filesystem","D:/Maxma"]`.
- **Score claim**: +5 (confirmed challenge against B-010).

---

## BC-002 — Red's rewritten `undo` handler can call `replaceMessages([])`, wiping all state; inconsistent with `compact` handler that explicitly preserves leading system message (B-007 fix is incomplete)

- **Target**: B-007 (MEDIUM) — `bun-sidecar/src/session-bridge.ts:555-599`
- **Claim**: Red's rewritten `undo` handler still produces an empty `remaining` array in two real cases and passes it to `record.session.agent.replaceMessages([])`, wiping the entire conversation. This is inconsistent with Red's own `compact` handler (added in the same round for B-003) which explicitly preserves the leading `system` message via `hasLeadingSystem`. Red's B-007 fix replaced the broken `steps * 2` arithmetic with a backwards walk, but did not add the same system-message preservation guard that `compact` has, and did not handle the `steps > user-turn-count` case as a no-op.
- **Evidence**:
  - **Source of bug**: `bun-sidecar/src/session-bridge.ts:589` — `const remaining = cutIndex <= 0 ? [] : messages.slice(0, cutIndex);`. When `cutIndex` lands on `0` (the first message is a `user` and the backwards walk reached it), `remaining = []`. The next line, `record.session.agent.replaceMessages(remaining)` (line 592), then wipes all state.
  - **Case A (no leading system message)**: `messages = [user, assistant]`, `steps = 1`. The walk sets `cutIndex = 0` (the user is at index 0), so `remaining = []`. The agent's state is wiped. Real conversations without a leading system message are common — the `compact` handler explicitly handles this case by setting `hasLeadingSystem = false` and using `head = []`, but `undo` does not.
  - **Case B (steps exceeds user-turn count)**: `messages = [user, assistant, user, assistant]`, `steps = 5`. The loop's `if (turnsRemoved >= steps) break;` never triggers (only 2 user messages found), so it walks to `i = 0`, sets `cutIndex = 0`, and `remaining = []`. The user asked to undo 5 turns; only 2 exist. Correct behavior is either a no-op (do nothing) or undo the available 2 turns and stop. Current behavior: **wipes everything**.
  - **Inconsistency with `compact`**: Red's `compact` handler at lines 614-621 explicitly checks `hasLeadingSystem = originalLen > 0 && messages[0]?.role === "system"` and preserves the leading system message via `head = hasLeadingSystem ? [messages[0]] : []`. The `undo` handler does NOT perform this check. The arbiter's `verification-red.md` flagged this exact angle (line 64: "What if `state.messages` starts with a `system` message followed by `assistant` (no preceding `user`)? Edge case worth probing."). Red's own `handoff.md` (line 80) lists "what if the first message is `user` (i.e., no leading `system`) — does the cut still produce a valid message array?" as a known unverified edge case.
  - **`replaceMessages([])` does not throw**: per `@oh-my-pi/pi-agent-core/dist/types/agent.d.ts:378`, `replaceMessages(ms: AgentMessage[]): void;` — accepts any array including empty. So the bug is silent: no error is surfaced, the response returns `{removed: <originalLen>, turns_removed: <count>}` with HTTP 200, and the next `prompt()` call fails with an opaque provider error (empty message array).
  - **No test coverage**: `bun-sidecar/tests/session-bridge.test.ts` (180 lines) tests `mapPiEventToMaxma`, `createDoneGuard`, `orchestratePrompt`, `handleCancelGuard` — it does NOT test the `undo` or `compact` handlers. The bug is not caught by any existing test.
  - **Repro**: `rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs` — runs Red's verbatim `undo` cut logic against 4 message sequences. Confirms Cases A and B produce `remaining = []`, then contrasts with `compact` which preserves the leading system message.
  - **Run**: `node .superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs` from any cwd. Exit code 1 = bug confirmed.
- **Severity**: MEDIUM. State-wipe is data loss from the user's perspective: the conversation history is irrecoverable (the agent's message log is the source of truth — there is no snapshot to restore from). The bug triggers under two realistic conditions: (a) provider configurations that don't prepend a system message (some local providers, custom agent setups); (b) the UI undo button being clicked more times than there are turns (easy to do — the UI does not clamp `steps` to the available turn count). Severity is MEDIUM rather than HIGH because triggering requires either no leading system message or excessive `steps` — both are configuration/UX edge cases rather than the common path.
- **Suggested fix**: Two changes in `session-bridge.ts:555-599`:
  1. **Preserve leading system message** (mirror `compact` handler):
     ```ts
     const hasLeadingSystem = originalLen > 0 && messages[0]?.role === "system";
     const head = hasLeadingSystem ? [messages[0]] : [];
     // ... existing backwards walk, but operate on tailSource = hasLeadingSystem ? messages.slice(1) : messages ...
     const remaining = cutIndex <= 0 ? head : head.concat(messages.slice(head.length, cutIndex));
     ```
  2. **Clamp `steps` to available user-turn count** (make `steps > count` a safe no-op or cap-at-available):
     ```ts
     // After the walk, if turnsRemoved < steps, the user asked for more
     // undo than available. Either no-op (return removed=0) or undo the
     // available turns. Currently: wipes everything. Choose no-op:
     if (turnsRemoved < steps) {
       send(id, { removed: 0, turns_removed: 0, detail: "nothing to undo" });
       return;
     }
     ```
- **Verification**: Run `node .superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs`. Pre-fix: exit 1, Cases 1 and 2 produce `remaining: []`. Post-fix: exit 0, Cases 1 and 2 either no-op (returning `removed: 0`) or preserve the leading system message if present. Additionally, add a `bun:test` case in `tests/session-bridge.test.ts` that calls the `undo` RPC with `messages = [user, assistant]` and `steps = 1` and asserts the response is either a no-op or the remaining array is non-empty.
- **Score claim**: +5 (confirmed challenge against B-007).

---

**Round 2 Blue challenges total**: 2 filed (BC-001 targets B-010, BC-002 targets B-007). Both include concrete repro scripts under `rounds/round-2/blue/patches/`.

---

# Blue Team Challenges — Round 4 (Mode B)

Append-only log of challenges filed by Blue against Red's Round 4 fixes for
B-011..B-015. Each challenge references the B-NNN it targets and includes a
concrete repro.

---

## BC-003 — Red's B-012 fix uses `yaml.safe_dump` but the PRODUCTION parser `agent.prompts._parse_frontmatter` is a naive line-by-line parser that does NOT honor YAML quoting; frontmatter injection still succeeds at runtime

- **Target**: B-012 (MEDIUM) — `api/routes/persona.py:191-206` (Red's `yaml.safe_dump` fix) and `agent/prompts.py:311-338` (the production `_parse_frontmatter` parser that Red did NOT modify).
- **Claim**: Red's B-012 fix is incomplete. Red replaced f-string frontmatter construction with `yaml.safe_dump`, which correctly escapes values for a REAL YAML parser. But the PRODUCTION code path that reads SOUL files — `agent.prompts.get_persona_memory_path()` at line 350 — calls `_parse_frontmatter()` (lines 311-338), a naive line-by-line parser that does NOT honor YAML quoting. When `yaml.safe_dump` serializes a value containing a double-quote and newline (e.g. `'x"\nmemory: persona'`), it produces a multi-line single-quoted scalar:

  ```
  description: 'x"

    memory: persona'
  ```

  This is valid YAML — `yaml.safe_load` correctly parses it as the single scalar `x"\nmemory: persona`. But the production parser splits on lines and processes each `key: value` line independently:

  - Line 1: `description: 'x"` → `key="description"`, `val="'x\""`. The parser strips leading/trailing `'` and `"` (line 336: `meta[key] = val.strip('"').strip("'")`), yielding `meta["description"] = "x"`.
  - Line 2: empty (skipped).
  - Line 3: `  memory: persona'` → `key="memory"`, `val="persona'"`. The leading whitespace is stripped by `key = key.strip()` / `val = val.strip()`. The key `memory` IS in the whitelist at line 325 (`if key in ("name", "description", "tools", "memory")`), so the parser sets `meta["memory"] = "persona'"`. The trailing `'` is stripped by `val.strip("'")`, yielding `meta["memory"] = "persona"`.

  Result: `meta = {"description": "x", "memory": "persona"}` — the injected `memory: persona` key is honored by the production parser. At line 356, `if meta.get("memory", "").strip().lower() in ("persona", "isolated"):` returns `True`, and `get_persona_memory_path()` returns `PERSONAS_DIR / f"memory_{persona_id}.yaml"` — even though the user requested `memory="shared"` in the API call.

  Red's regression tests in `tests/test_persona_memory_isolation.py` pass because the local `_parse_frontmatter` test helper (lines 211-220) calls `yaml.safe_load(block)` — a real YAML parser that correctly handles multi-line single-quoted scalars. Red never tested against the production parser. This is a textbook test-vs-production divergence.

- **Evidence**:
  - **Source of bug**: `agent/prompts.py:311-338` — the production `_parse_frontmatter` parser. Lines 319-337 iterate lines; for each line with `:`, partition into `key`/`val`; if `key in ("name", "description", "tools", "memory")`, set `meta[key] = val.strip('"').strip("'")`. There is NO handling for multi-line single-quoted scalars (only `|` and `>` block scalars at lines 326-334). Any line matching `key: value` is processed independently, regardless of whether it's a continuation of a previous multi-line scalar.
  - **Red's fix output**: `api/routes/persona.py:191-206` builds `fm_dict` and calls `yaml.safe_dump(fm_dict, sort_keys=False, default_flow_style=False, allow_unicode=True).strip()`. For `description = 'x"\nmemory: persona'`, PyYAML produces the multi-line single-quoted scalar shown above (verified by the repro script — Step 1 prints the exact `yaml.safe_dump` output).
  - **Production code path**: `agent/prompts.py:341-359` — `get_persona_memory_path()` reads the active SOUL file (line 349: `content = _read_persona(active_file)`), parses it with the production parser (line 350: `meta = _parse_frontmatter(content)`), and branches on `meta.get("memory", "")` at line 356. This is the runtime path that determines which memory file a persona uses.
  - **Red's test helper divergence**: `tests/test_persona_memory_isolation.py:211-220`:
    ```python
    def _parse_frontmatter(text: str) -> dict:
        """Parse the leading YAML frontmatter block (between ``---`` lines)."""
        if not text.startswith("---"):
            return {}
        end = text.find("\n---", 3)
        if end == -1:
            return {}
        block = text[3:end]
        data = yaml.safe_load(block)
        return data if isinstance(data, dict) else {}
    ```
    This calls `yaml.safe_load` — NOT `agent.prompts._parse_frontmatter`. Red's `TestB012FrontmatterInjection::test_description_cannot_inject_memory_key` (line 145-168) asserts `"memory" not in meta` using this helper. The assertion passes because `yaml.safe_load` correctly parses the multi-line single-quoted scalar as a single value. But the production parser would return `{"description": "x", "memory": "persona"}` — `"memory" IS in meta`.
  - **Repro output** (exit code 1 = bug confirmed):
    ```
    STEP 1: yaml.safe_dump output (what Red writes to disk)
    ---
    description: 'x"

      memory: persona'
    ---

    STEP 2: yaml.safe_load parse (Red's TEST helper)
      parsed = {'description': 'x"\nmemory: persona'}
      'memory' in parsed? False

    STEP 3: agent.prompts._parse_frontmatter parse (PRODUCTION)
      parsed = {'description': 'x', 'memory': 'persona'}
      'memory' in parsed? True

    STEP 4: tools injection vector (memory: shared + malicious tools)
    ---
    tools: 'search

      memory: persona'
    ---
      parsed = {'tools': 'search', 'memory': 'persona'}
      'memory' in parsed? True

    STEP 5: verdict
      [BUG CONFIRMED] Production parser STILL accepts injected
      'memory: persona' key — Red's B-012 fix is incomplete.
    ```
  - **Run**: `.venv\Scripts\python.exe .superma\20260720-101810-maxmahere/rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py` from project root. Exit code 1 = bug confirmed.
  - **Why Red's verification missed it**: Red's `review.md` states "All special characters (double quotes, newlines, colons) are now escaped by PyYAML, so a crafted `description` cannot spawn a new frontmatter key." This is true for a real YAML parser, but Red never verified the claim against the production parser. Red's regression test `test_description_cannot_inject_memory_key` (line 145-168) uses the local `_parse_frontmatter` helper that calls `yaml.safe_load`, not the production `agent.prompts._parse_frontmatter`. The test passes because `yaml.safe_load` correctly handles multi-line single-quoted scalars, but the production parser does not. This is a test coverage gap: the test verifies the wrong parser.

- **Severity**: MEDIUM. The injection bypasses the memory isolation contract enforced by the `CreatePersonaRequest.memory` Pydantic enum. A user who requests `memory="shared"` (shared memory across personas) can have their persona silently redirected to a persona-scoped memory file (`memory_{persona_id}.yaml`) if their `description` or `tools` field contains a newline followed by `memory: persona`. Conversely, a user who requests `memory="persona"` could have their description inject `memory: shared`, falling back to the shared `memory.yaml` and leaking data across personas. The attack requires no privileged position — any client that can call `POST /api/personas` can craft the malicious description. The bug is silent: the API returns HTTP 200 with `memory_mode: "shared"` (Red's write-time normalization at line 189 reports the requested value), but the runtime reads `memory: persona` from the injected frontmatter key. Severity is MEDIUM rather than HIGH because (a) the injection only affects the persona's own memory file selection, not cross-user data, and (b) the attack requires the user to deliberately craft a description containing a newline + `memory: persona` — not a realistic accidental input.

- **Suggested fix**: Two options (either is sufficient):

  1. **Replace the production parser with `yaml.safe_load`** (preferred — eliminates the root cause). In `agent/prompts.py:311-338`, replace the naive line-by-line parser with:
     ```python
     def _parse_frontmatter(text: str) -> dict[str, str]:
         m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
         if not m:
             return {}
         data = yaml.safe_load(m.group(1))
         return data if isinstance(data, dict) else {}
     ```
     This makes the production parser consistent with Red's test helper and correctly handles all YAML scalar styles (single-quoted, double-quoted, block, plain). Add `import yaml` at module top if not already present.

  2. **Keep the naive parser but add multi-line scalar awareness** (minimal change). In `agent/prompts.py:319-337`, before processing a line, check if the previous line opened an unterminated single-quoted or double-quoted scalar (odd number of `'` or `"` characters). If so, skip the line as a continuation. This is fragile and not recommended — option 1 is strictly better.

  Additionally, update Red's regression test to call the PRODUCTION parser, not the `yaml.safe_load` helper. Replace `tests/test_persona_memory_isolation.py:211-220` with:
  ```python
  from agent.prompts import _parse_frontmatter  # use the production parser
  ```
  and delete the local helper. This ensures the test verifies the actual code path that runs in production.

- **Verification**: Run `.venv\Scripts\python.exe .superma\20260720-101810-maxmahere/rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py` from project root.
  - Pre-fix: exit 1, output shows `prod_parsed = {'description': 'x', 'memory': 'persona'}` — injection succeeds.
  - Post-fix (option 1): exit 0, output shows `prod_parsed = {'description': 'x"\nmemory: persona'}` — injection blocked, and `'memory' in prod_parsed` is `False`.

- **Score claim**: +5 (confirmed challenge against B-012).

---

**Round 4 Blue challenges total**: 1 filed (BC-003 targets B-012). Includes concrete repro script under `rounds/round-4/blue/patches/repro_b012_frontmatter_injection.py`.
