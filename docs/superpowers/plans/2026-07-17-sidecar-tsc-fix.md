# Sidecar TSC Error Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix pre-existing TypeScript compilation error in `session-bridge.ts` line 94 so that `bunx tsc --noEmit` reports zero errors under `src/`.

**Architecture:** Confirm the single `src/` error (`TS2352` on the `as Model` cast in the manual fallback `Model` constructor) → replace two invalid string-literal fields in the `compat` object with values that satisfy the `@oh-my-pi/pi-catalog` type unions → verify with `tsc`, `bun test`, and `bun build`.

**Tech Stack:** Bun, TypeScript, `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-catalog`

---

## Background (investigation already performed)

Running `bunx tsc --noEmit` in `d:\Maxma\MaxmaHere\bun-sidecar` produces exactly **one** error under `src/`:

```
src/session-bridge.ts(94,10): error TS2352: Conversion of type '{ … compat: { … } }' to type 'Model<Api>' may be a mistake because neither type sufficiently overlaps with the other.
  …
  Types of property 'thinkingFormat' are incompatible.
    Type '"disabled"' is not comparable to type 'OpenAIReasoningFormat'.
```

The ~20 remaining errors all live under `node_modules/@oh-my-pi/...` (missing `bun` / `bun:sqlite` module declarations, `ReadOnlyDict`, etc.). Per task scope these are **dependency type-definition issues and are NOT fixed**.

### Root cause

`parseModel()` in `src/session-bridge.ts` builds a manual fallback `Model` object (Option B, lines 94–157) and casts it `as Model` (line 156). The `compat` sub-object contains two string literals that are **not members of their declared union types** in `@oh-my-pi/pi-catalog`:

| Line | Field               | Current (invalid) | Declared type                       | Valid members                                                                                |
|------|---------------------|-------------------|-------------------------------------|----------------------------------------------------------------------------------------------|
| 111  | `thinkingFormat`    | `"disabled"`       | `OpenAIReasoningFormat`             | `"openai" \| "openrouter" \| "zai" \| "qwen" \| "qwen-chat-template"`                        |
| 112  | `reasoningDisableMode` | `"off"`         | `OpenAIReasoningDisableMode`        | `"omit" \| "lowest-effort" \| "openrouter-enabled-false" \| "zai-thinking-disabled" \| "qwen-enable-thinking-false" \| "qwen-template-false"` |

`tsc` reports only the first mismatch (`thinkingFormat`) because `TS2352` short-circuits on the first union member that fails to compare. Fixing `thinkingFormat` alone would surface `reasoningDisableMode` on the next run, so both are fixed in one pass.

All other `as const` literals in the `compat` object were verified valid against their union types:
- `wireModelIdMode: "raw"` → valid (`"raw" | "firepass" | "fireworks" | "openrouter"`, `types.d.ts:459`)
- `toolStrictMode: "none"` → valid (`"all_strict" | "none"` + resolved `"mixed"`, `types.d.ts:289,413`)
- `maxTokensField: "max_tokens"` → valid (`"max_completion_tokens" | "max_tokens"`)

### Chosen replacement values

The fallback model is a **non-reasoning** OpenAI Chat Completions model (`api: "openai-completions"`, `reasoning: false`, `supportsReasoningParams: false`, `supportsReasoningEffort: false`).

- `thinkingFormat: "openai"` — the documented default (`types.d.ts:170`: *Default: "openai"*) and the correct dialect for an OpenAI Chat Completions endpoint.
- `reasoningDisableMode: "omit"` — the format-agnostic disable mode (don't emit any reasoning parameter), matching `supportsReasoningParams: false`.

---

## File Structure

- **Modify:** `d:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts` (lines 111–112 only — two single-line literal edits)
- **No other files touched.** `tsconfig.json` is unchanged (the error is a real type incompatibility, not a config issue; `skipLibCheck` would not fix line 94).

---

### Task 1: Replace the two invalid compat literals

**Files:**
- Modify: `d:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts:111-112`

- [ ] **Step 1: Read the target lines to confirm exact text**

Run `Read` on `d:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts` offset 105 limit 12. Confirm lines 111–112 read exactly:

```ts
      thinkingFormat: "disabled" as const,
      reasoningDisableMode: "off" as const,
```

- [ ] **Step 2: Apply the two literal edits**

Edit `d:\Maxma\MaxmaHere\bun-sidecar\src\session-bridge.ts`:

old_string (unique block covering both lines):
```ts
      thinkingFormat: "disabled" as const,
      reasoningDisableMode: "off" as const,
```

new_string:
```ts
      thinkingFormat: "openai" as const,
      reasoningDisableMode: "omit" as const,
```

- [ ] **Step 3: Verify the edit landed**

`Read` lines 105–115 of the file and confirm both literals are now `"openai"` / `"omit"`.

---

### Task 2: Verify `tsc` reports zero `src/` errors

- [ ] **Step 1: Run the type checker**

Run:
```
cd d:\Maxma\MaxmaHere\bun-sidecar && bunx tsc --noEmit
```

Expected: the `src/session-bridge.ts(94,10)` error is gone. The only remaining errors (exit code 1) are under `node_modules/@oh-my-pi/...` (pre-existing dependency type-definition issues, out of scope).

- [ ] **Step 2: Confirm no `src/` lines in the output**

Grep the tsc output for `^src/`. Expected: zero matches.

---

### Task 3: Verify tests still pass

- [ ] **Step 1: Run the sidecar test suite**

Run:
```
cd d:\Maxma\MaxmaHere\bun-sidecar && bun test
```

Expected: all tests pass (exit code 0). The edit only changes two string literals in a rarely-hit fallback branch; no test should regress. If a test asserts the literal `"disabled"` / `"off"` values, update that assertion to `"openai"` / `"omit"` (allowed exception per task constraints).

---

### Task 4: Verify `bun build` compiles

- [ ] **Step 1: Build the entry point**

Run:
```
cd d:\Maxma\MaxmaHere\bun-sidecar && bun build src/session-bridge.ts --no-bundle
```

Expected: build succeeds with no errors (`session-bridge.js` written, exit code 0).

---

### Task 5: Commit

- [ ] **Step 1: Stage and commit only the source change**

Run:
```
cd d:\Maxma\MaxmaHere && git add bun-sidecar/src/session-bridge.ts && git commit -m "fix(sidecar): correct invalid thinkingFormat/reasoningDisableMode literals in fallback Model"
```

Expected: commit succeeds. Do NOT stage `bun-sidecar/dist/` output or any other file.

- [ ] **Step 2: Verify the commit**

Run `git log --oneline -1` and confirm the new commit is on top with the expected message and only `bun-sidecar/src/session-bridge.ts` in the diff (`git show --stat HEAD`).

---

## Self-Review

**Spec coverage:** The task's Step 1 (confirm tsc errors) → Task 2. Step 2 (read code) → done in investigation. Step 3 (research Model type) → done; findings recorded under "Root cause". Step 4 (implement fix) → Task 1. Step 5 (verify tsc + bun test + bun build + commit) → Tasks 2–5. All covered.

**Placeholder scan:** No TBD/TODO. Each step has exact file paths, exact old/new strings, exact commands, and expected outputs.

**Type consistency:** Field names (`thinkingFormat`, `reasoningDisableMode`), union names (`OpenAIReasoningFormat`, `OpenAIReasoningDisableMode`), and replacement values (`"openai"`, `"omit"`) are consistent with the `@oh-my-pi/pi-catalog` `.d.ts` sources cited under "Root cause".
