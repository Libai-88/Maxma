# Red Team Round 3 Review

## Summary

Round 3 mission: fix the 2 confirmed Blue challenges from Round 2 (BC-001, BC-002). Both challenges were verified by the arbiter as legitimate incomplete fixes from Red's Round 2 work.

**Outcome**: Both challenges fixed. Both Blue repro scripts now exit 0. Full pytest suite passes (1834 passed, 7 skipped, 0 failures). No new R-NNN issues filed — focused on the required fixes.

**Files modified** (surgical edits only):
- `bun-sidecar/src/tools/config/manage_mcp.ts` — parseYaml (BC-001)
- `bun-sidecar/src/session-bridge.ts` — undo handler (BC-002)
- `rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` — updated verbatim copy of parseYaml to match the fixed source (the repro hardcodes the function under test; without updating it, the repro would still test the old buggy logic)
- `rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs` — updated verbatim copy of undo cut logic to match the fixed source (same reason)

## Confirmed challenges fixed

### BC-001: parseYaml list-item branch mis-parses real config — FIXED

**File**: `bun-sidecar/src/tools/config/manage_mcp.ts` (parseYaml function, lines 20-100)

**Root cause**: The original B-010 fix corrected the dedent loop but left two latent bugs in the list-item handling:
1. **Inline-mapping false positive** (the challenge Blue flagged): the `if (colonIdx > 0)` branch was unconditional, so any list item containing a colon (like `D:/Maxma`) was mis-parsed as `{"D": "/Maxma"}` instead of the string `"D:/Maxma"`.
2. **Sibling list-item loss** (deeper bug discovered while fixing #1): the dedent loop popped the array when a sibling list item at the same indent arrived, then the "parent is not an array" branch created a NEW array, overwriting the previous one. This silently lost all prior items — `args: [-y, @modelcontextprotocol/server-filesystem, D:/Maxma]` became `args: [D:/Maxma]` (only the last item survived). Blue's repro only checked for the dict bug, not the lost-items bug, but the expected-args assertion caught both.

**Fix applied** (two surgical edits in parseYaml):

1. **Guard the inline-mapping branch** (Option 2 from the task spec):
   ```typescript
   const colonIdx = val.indexOf(":");
   const keyCandidate = colonIdx > 0 ? val.slice(0, colonIdx).trim() : "";
   const valCandidate = colonIdx > 0 ? val.slice(colonIdx + 1).trim() : "";
   const isYamlKey = /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(keyCandidate);
   const isPathLike =
     valCandidate.startsWith("/") || valCandidate.startsWith("\\");
   if (colonIdx > 0 && isYamlKey && !isPathLike) {
     // inline mapping (e.g. `- args:` empty-value, or `- name: foo`)
   } else {
     arr.push(coerceScalar(val));  // scalar (e.g. `D:/Maxma`)
   }
   ```
   The guard requires the key to be a YAML identifier and the value (when non-empty) not to start with `/` or `\`. Empty value (`- args:`) is still treated as inline mapping because `valCandidate === ""` does not start with `/` or `\`. This is needed by the actual `mcp_servers.yaml` schema which uses `- args:` to introduce the args list.

2. **Don't pop array on sibling list items**:
   ```typescript
   const isListItem = trimmed.startsWith("- ");
   while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
     const top = stack[stack.length - 1];
     if (isListItem && Array.isArray(top.node) && top.indent === indent) break;
     stack.pop();
   }
   ```
   When the new line is a list item AND the stack top is an array at the same indent, treat it as a sibling append (break out of the dedent loop) instead of popping the array. This is the standard YAML rule: sibling `- item` lines at the same indent belong to the same array.

**Why Option 1 (delete the inline-mapping branch entirely) was not chosen**: the actual `api/data/mcp_servers.yaml` schema DOES use `- args:` (empty-value inline mapping) to introduce the args list. Deleting the branch entirely would treat `- args:` as the scalar string `"args:"`, breaking the schema. Option 2 (guard) is more correct.

**Verification**:
- Blue's repro: `node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b010_parseYaml.mjs` → **exit 0**.
  - Parsed output now shows `args: ["-y","@modelcontextprotocol/server-filesystem","D:/Maxma"]` (3 items, all strings) — matches expected exactly.
  - `server.args has 'D' key (BUG)? false` — no more dict mis-parse.
  - `args match expected? true`.
- Pytest suite: 1834 passed, 7 skipped, 0 failures (no regressions).
- TypeScript: no new errors in `manage_mcp.ts` (only pre-existing Zod schema type errors at lines 118/130-138 unrelated to parseYaml).

### BC-002: undo can call replaceMessages([]) — FIXED

**File**: `bun-sidecar/src/session-bridge.ts` (undo handler, lines 555-611)

**Root cause**: Red's Round 2 B-007 fix replaced the `steps * 2` arithmetic with a backwards walk (good), but the final line `const remaining = cutIndex <= 0 ? [] : messages.slice(0, cutIndex);` produced `[]` when `cutIndex` landed on 0. This happened in two real cases:
- Case 1: `[user, assistant]` with `steps >= 1` (no leading system message) — walk reaches `i=0`, `cutIndex=0`.
- Case 2: `steps >` user-turn count — walk reaches `i=0` without finding enough user turns, `cutIndex=0`.

The sibling `compact` handler (added by Red in the same round for B-003) explicitly preserves the leading system message via `hasLeadingSystem` check; `undo` did not. `replaceMessages([])` does not throw — it silently wipes all conversation state, and the next prompt fails with an opaque provider error.

**Fix applied** (mirrors `compact`'s `hasLeadingSystem` preservation + no-op on insufficient turns):

```typescript
const hasLeadingSystem = originalLen > 0 &&
  (messages[0] as any)?.role === "system";
// ... existing backwards walk ...
// No-op when (a) we couldn't find `steps` user turns to remove, or
// (b) the cut would land at/before index 0 with no leading system
// message to keep — both cases previously produced
// replaceMessages([]), silently wiping all conversation state.
if (turnsRemoved < steps || (!hasLeadingSystem && cutIndex <= 0)) {
  send(id, { removed: 0, turns_removed: 0, detail: "no turns to undo" });
  return;
}
// Defensive: when a leading system message exists, ensure it is
// preserved even if cutIndex would land on index 0.
if (hasLeadingSystem && cutIndex < 1) cutIndex = 1;
const remaining = messages.slice(0, cutIndex);
```

Three behavior changes:
1. Added `hasLeadingSystem` check (mirrors `compact` lines 614-621).
2. `turnsRemoved < steps` → no-op (return `{removed: 0, turns_removed: 0, detail: "no turns to undo"}`) — handles Case 2 (excessive steps) and Case 4 (with system, excessive steps).
3. `!hasLeadingSystem && cutIndex <= 0` → no-op — handles Case 1 (no system, single turn undone would wipe). When a leading system exists, the system message is always preserved (clamp `cutIndex` to `>= 1`).

**Verification**:
- Blue's repro: `node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b007_undo_empty_array.mjs` → **exit 0**.
  - Case 1: `[user, assistant]`, steps=1 → no-op (remaining = original 2 messages). Was: `replaceMessages([])` (wipe).
  - Case 2: `[user, asst, user, asst]`, steps=5 → no-op (remaining = original 4 messages). Was: `replaceMessages([])` (wipe).
  - Case 3: `[system, user, assistant]`, steps=1 → `remaining = [system]` (system preserved). Unchanged.
  - Case 4: `[system, user, asst, user, asst]`, steps=5 → no-op (remaining = original 5 messages). Was: `remaining = [system]` (partial). Behavior change: now a clean no-op instead of silently dropping 4 messages.
  - `*** No bug found (challenge would be rejected) ***` — no case produces a wipe.
- Pytest suite: 1834 passed, 7 skipped, 0 failures (no regressions).
- TypeScript: no errors in `session-bridge.ts`.

## New issues found

None filed. Focused on the two required challenges. The parseYaml sibling-list-item bug discovered during BC-001 fix is documented above as part of BC-001 (same parser, same repro, same fix) rather than as a separate R-NNN — it would have been a legitimate R-003 if encountered independently, but it was a direct blocker to making BC-001's repro pass and is causally entangled with the inline-mapping false positive.

## Test plan

```powershell
# BC-001 verification
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b010_parseYaml.mjs
# Expected: exit 0, args match ["-y","@modelcontextprotocol/server-filesystem","D:/Maxma"]

# BC-002 verification
node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b007_undo_empty_array.mjs
# Expected: exit 0, "No bug found"

# Full test suite
.venv\Scripts\python.exe -m pytest tests/ --tb=short -q
# Expected: 1834 passed, 7 skipped, 0 failures
```

## Notes for arbiter

- Blue's repro scripts hardcode verbatim copies of the functions under test (the script comment explicitly says "Verbatim copy of Red's new parseYaml"). To make the repros pick up the Round 3 fixes, the copied functions in the repro scripts were updated to match the fixed source. This is necessary for the acceptance criterion ("Blue's repro scripts must exit 0 after your fix") to be satisfiable. The test assertions themselves were not modified.
- The BC-001 fix required two changes (inline-mapping guard + sibling-list-item preservation). Both are necessary for the repro to pass: the guard alone fixes the dict mis-parse but the args list still loses items 1 and 2; the sibling fix alone preserves all 3 items but `D:/Maxma` is still a dict. Both changes are surgical and limited to the parseYaml function.
- No new R-NNN issues filed. The parseYaml sibling-list-item bug is documented under BC-001 rather than as a separate issue because it shares the same repro, same file, and same fix as the original BC-001 challenge.
