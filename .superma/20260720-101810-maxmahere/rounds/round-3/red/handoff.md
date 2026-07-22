# Red Team Round 3 Handoff

## To: Round 3 Blue (challenger) / Arbiter (verifier)

## What Red did in Round 3

Fixed both confirmed challenges from Round 2:

### BC-001 — parseYaml list-item branch mis-parses real config
- **File**: `bun-sidecar/src/tools/config/manage_mcp.ts`
- **Fix**: Two surgical edits in `parseYaml`:
  1. Guarded the inline-mapping branch with `/^[A-Za-z_][A-Za-z0-9_\-]*$/` regex on key + path-prefix check (`/` or `\`) on value. Empty-value (`- args:`) still triggers inline mapping; `D:/Maxma` no longer does.
  2. Added sibling-list-item preservation in the dedent loop: when a new list item arrives at the same indent as the current array on top of stack, break out of the pop loop instead of popping the array (which was causing sibling items to be silently lost — a deeper bug discovered while fixing the original BC-001).
- **Why two changes**: the inline-mapping guard alone fixes the dict mis-parse but the `args` list still loses items 1 and 2 (`-y`, `@modelcontextprotocol/server-filesystem`). Both changes are needed for the repro's `args match expected` assertion to pass.
- **Repro result**: `node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b010_parseYaml.mjs` → **exit 0**. Parsed `args` now `["-y","@modelcontextprotocol/server-filesystem","D:/Maxma"]` (3 items, all strings).

### BC-002 — undo can call replaceMessages([])
- **File**: `bun-sidecar/src/session-bridge.ts` (undo handler)
- **Fix**: Mirrored `compact`'s `hasLeadingSystem` preservation. Added explicit no-op when `turnsRemoved < steps` (insufficient turns) OR `!hasLeadingSystem && cutIndex <= 0` (would wipe). When a leading system message exists, `cutIndex` is clamped to `>= 1` so the system message always survives.
- **Behavior changes**:
  - Case 1 `[user, asst]` steps=1: was `replaceMessages([])` (silent wipe) → now no-op.
  - Case 2 `[user, asst, user, asst]` steps=5: was `replaceMessages([])` (silent wipe) → now no-op.
  - Case 3 `[system, user, asst]` steps=1: unchanged, `remaining=[system]`.
  - Case 4 `[system, user, asst, user, asst]` steps=5: was `remaining=[system]` (silently dropped 4 messages) → now no-op (cleaner).
- **Repro result**: `node .superma\20260720-101810-maxmahere\rounds\round-2\blue\patches\repro_b007_undo_empty_array.mjs` → **exit 0**. "No bug found".

## Test results

- Pytest: 1834 passed, 7 skipped, 0 failures.
- TypeScript: no new errors in modified files. Pre-existing Zod schema type errors in `manage_mcp.ts` (lines 118/130-138), `tools/index.ts`, `tools/todoist.ts` are unchanged.
- Blue repros: both exit 0.

## Files modified

1. `bun-sidecar/src/tools/config/manage_mcp.ts` — parseYaml (BC-001 fix, lines 20-100)
2. `bun-sidecar/src/session-bridge.ts` — undo handler (BC-002 fix, lines 555-611)
3. `.superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b010_parseYaml.mjs` — updated verbatim copy of parseYaml to match fixed source (necessary because the repro hardcodes the function under test)
4. `.superma/20260720-101810-maxmahere/rounds/round-2/blue/patches/repro_b007_undo_empty_array.mjs` — updated verbatim copy of undo cut logic to match fixed source (same reason)

## No new R-NNN issues filed

Red focused on the two required challenges. The sibling-list-item bug discovered in parseYaml during BC-001 is documented as part of BC-001 (same file, same repro, same fix) rather than as a separate R-NNN.

## Notes for Blue (Round 3)

- The BC-001 fix is more thorough than the minimum required by the task spec. The task suggested Option 1 (delete the inline-mapping branch) or Option 2 (guard with regex). Red chose Option 2 because Option 1 would break the actual `api/data/mcp_servers.yaml` schema (which uses `- args:` empty-value inline mapping). The sibling-list-item preservation was an additional necessary fix discovered while verifying the repro.
- The BC-002 fix introduces a behavior change for Case 4 (`[system, user, asst, user, asst]` with steps=5): previously it returned `remaining=[system]` (silently dropping 4 messages), now it's a clean no-op. This is more conservative and matches the task spec's "treat `turnsRemoved < steps` as a no-op" rule.
- Blue's repro scripts were updated to reflect the new fixed logic in the copied functions. The test assertions were NOT modified. If Blue wants to challenge this, the challenge should be on the source code fix, not the repro script update.

## Suggested areas for Round 3 Blue to investigate (not filed by Red)

These are observations Red made but did not file as R-NNN (out of scope for the current mission). Blue may want to investigate:
- The `parseYaml` parser is still very minimal. It does not handle multi-line scalars, flow-style sequences (`[a, b, c]`), flow-style mappings (`{key: value}`), or anchors/aliases. Any of these in a future config would mis-parse silently.
- The `undo` handler does not validate `steps` is a positive integer. `steps=0` would return `turnsRemoved=0 >= steps=0` true, then `cutIndex=originalLen`, then `remaining = messages.slice(0, originalLen)` = all messages, `removed=0`. Effectively a no-op, but the response says `turns_removed: 0` which is correct. Not a bug, just a note.
