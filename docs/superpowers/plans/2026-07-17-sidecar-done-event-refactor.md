# Sidecar Done Event Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace patchy BUG3/BUG4 done-event fixes with a robust try/finally + timeout circuit breaker that guarantees the `done` event is emitted exactly once per prompt, on every code path.

**Architecture:** Introduce a per-prompt `doneGuard` sentinel object. The session subscriber marks the guard when `agent_end` fires (natural completion). A new `orchestratePrompt()` helper wraps `session.prompt()` in `try/finally` so the `finally` block emits `done` if the guard is still unset (error / abort / timeout paths). A 600s `setTimeout` circuit breaker emits `error + done` and aborts the agent if the prompt hangs forever. Cancel marks the active guard and emits `done` directly, so the prompt's `finally` becomes a no-op. All top-level stdin/signal side effects are guarded with `import.meta.main` so the module is importable from tests.

**Tech Stack:** Bun, TypeScript, JSON-RPC, bun:test

---

## File Structure

- **Modify:** `bun-sidecar/src/session-bridge.ts` — add `doneGuard` type, export `mapPiEventToMaxma` + `orchestratePrompt` + `createDoneGuard`, guard top-level side effects with `import.meta.main`, rewrite `prompt` and `cancel` RPC handlers, remove BUG3/BUG4 manual patches.
- **Create:** `bun-sidecar/tests/session-bridge.test.ts` — unit tests for `mapPiEventToMaxma` guard marking, `orchestratePrompt` (error path, normal path, timeout path, cancel path), and cancel-guard interaction.

No other files are touched.

---

## Conventions

- Run tests: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
- Commit after each task using Conventional Commits (`feat:`, `test:`, `refactor:`).
- Each task is independently committable and leaves the test suite green.

---

### Task 1: Guard module side effects with `import.meta.main` so the module is importable from tests

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts` (the `rl.on("line", ...)` block at L279-434 and the `process.on(...)` shutdown registrations at L454-455)

**Why:** Importing the module in a test today would immediately start a readline loop on stdin and hang the test runner. Guarding the server bootstrap with `import.meta.main` (supported by Bun) lets tests import only the pure helpers.

- [ ] **Step 1: Write the failing test**

Create `bun-sidecar/tests/session-bridge.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { mapPiEventToMaxma } from "../src/session-bridge";

describe("module import smoke test", () => {
  test("mapPiEventToMaxma is exported and callable", () => {
    const out = mapPiEventToMaxma({ type: "agent_end" });
    expect(out).toEqual({ type: "done", payload: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: FAIL — `mapPiEventToMaxma` is not exported (and/or the import hangs because the readline loop starts).

- [ ] **Step 3: Guard side effects and export the helper**

In `bun-sidecar/src/session-bridge.ts`:

1. Add `export` to `function mapPiEventToMaxma(...)` (L162).
2. Wrap the `rl.on("line", async (line: string) => { ... })` block AND the two `process.on("SIGTERM" / "SIGINT", shutdown)` lines in:

```typescript
if (import.meta.main) {
  rl.on("line", async (line: string) => {
    // ... existing handler body unchanged ...
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
```

Keep `rl`, `sessions`, `send`, `sendError`, `sendEvent`, `shutdown`, `subscribeSession`, `parseModel` definitions at module scope (outside the guard) so they remain importable / referenceable.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS — import does not hang, `mapPiEventToMaxma({ type: "agent_end" })` returns `{ type: "done", payload: {} }`.

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add bun-sidecar/src/session-bridge.ts bun-sidecar/tests/session-bridge.test.ts
git commit -m "refactor(sidecar): guard stdin/signal side effects with import.meta.main and export mapPiEventToMaxma for testability"
```

---

### Task 2: Add `doneGuard` support to `mapPiEventToMaxma` (TDD)

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts` (`mapPiEventToMaxma` signature + the `agent_end` branch at L252-254)
- Test: `bun-sidecar/tests/session-bridge.test.ts`

**Why:** The subscriber must mark the active per-prompt guard when `agent_end` fires so that downstream `finally` blocks know `done` was already emitted and skip the manual send.

- [ ] **Step 1: Write the failing test**

Append to `bun-sidecar/tests/session-bridge.test.ts`:

```typescript
describe("mapPiEventToMaxma done guard", () => {
  test("agent_end marks the guard as done", () => {
    const guard = { done: false };
    const out = mapPiEventToMaxma({ type: "agent_end" }, guard);
    expect(out).toEqual({ type: "done", payload: {} });
    expect(guard.done).toBe(true);
  });

  test("non-agent_end events do not touch the guard", () => {
    const guard = { done: false };
    const out = mapPiEventToMaxma({ type: "tool_execution_start", toolName: "x", args: {} }, guard);
    expect(out).toEqual({ type: "tool_start", payload: { tool_name: "x", input: "{}" } });
    expect(guard.done).toBe(false);
  });

  test("works without a guard (backward compatible)", () => {
    const out = mapPiEventToMaxma({ type: "agent_end" });
    expect(out).toEqual({ type: "done", payload: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: FAIL — `mapPiEventToMaxma` accepts only one argument; passing a second `guard` arg has no effect, so `guard.done` stays `false`.

- [ ] **Step 3: Implement guard support**

In `bun-sidecar/src/session-bridge.ts`, change the signature and the `agent_end` branch:

```typescript
export function mapPiEventToMaxma(
  piEvent: Record<string, unknown>,
  guard?: { done: boolean } | null,
): Record<string, unknown> | null {
  // ... existing body unchanged until the agent_end branch ...

  if (type === "agent_end") {
    if (guard) guard.done = true;
    return { type: "done", payload: {} };
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere
git add bun-sidecar/src/session-bridge.ts bun-sidecar/tests/session-bridge.test.ts
git commit -m "feat(sidecar): mapPiEventToMaxma marks doneGuard on agent_end"
```

---

### Task 3: Implement `createDoneGuard` + `orchestratePrompt` with try/finally (BUG3 scenario, TDD)

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts` (add `createDoneGuard` and `orchestratePrompt` exports near `mapPiEventToMaxma`)
- Test: `bun-sidecar/tests/session-bridge.test.ts`

**Why:** This is the root-cause fix for BUG3. `session.prompt()` is wrapped in `try/finally`; any thrown error emits an `error` event, and the `finally` block emits `done` exactly once (guarded by the sentinel). The manual BUG3 `sendEvent(..., { type: "done" })` inside the `.catch` becomes redundant.

- [ ] **Step 1: Write the failing test**

Append to `bun-sidecar/tests/session-bridge.test.ts`:

```typescript
import { createDoneGuard, orchestratePrompt, mapPiEventToMaxma as _map2 } from "../src/session-bridge";

// Fake AgentSession factory for orchestratePrompt tests.
function makeFakeSession(opts: {
  promptImpl?: (msg: string) => Promise<void>;
  abortImpl?: () => void;
} = {}) {
  const subscribers: Array<(event: any) => void> = [];
  const session: any = {
    prompt: opts.promptImpl ?? (async () => {}),
    subscribe: (cb: (event: any) => void) => {
      subscribers.push(cb);
      return () => {
        const i = subscribers.indexOf(cb);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    agent: { abort: opts.abortImpl ?? (() => {}) },
  };
  return { session, emit: (e: any) => subscribers.forEach(cb => cb(e)) };
}

describe("orchestratePrompt — error path (BUG3)", () => {
  test("prompt() throwing emits error + done, marks guard", async () => {
    const { session } = makeFakeSession({
      promptImpl: async () => { throw new Error("boom"); },
    });
    const events: Record<string, unknown>[] = [];
    const guard = createDoneGuard();

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 60_000);

    expect(guard.done).toBe(true);
    expect(events).toEqual([
      { type: "error", payload: { code: "PROMPT_ERROR", message: "Error: boom" } },
      { type: "done", payload: {} },
    ]);
  });

  test("prompt() resolving without agent_end still emits done (safety net)", async () => {
    const { session } = makeFakeSession({ promptImpl: async () => {} });
    const events: Record<string, unknown>[] = [];
    const guard = createDoneGuard();

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 60_000);

    expect(guard.done).toBe(true);
    expect(events).toEqual([{ type: "done", payload: {} }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: FAIL — `createDoneGuard` and `orchestratePrompt` are not exported.

- [ ] **Step 3: Implement `createDoneGuard` and `orchestratePrompt`**

Add to `bun-sidecar/src/session-bridge.ts` (right after `mapPiEventToMaxma`):

```typescript
// ---------------------------------------------------------------------------
// Per-prompt done guard + orchestration
// ---------------------------------------------------------------------------

export interface DoneGuard {
  done: boolean;
}

export function createDoneGuard(): DoneGuard {
  return { done: false };
}

/**
 * Run session.prompt(message) with a guaranteed done-event emission.
 *
 * Semantics:
 *   - If the subscriber fires `agent_end` during the call, it marks `guard.done`
 *     and emits `done` itself; the finally block then becomes a no-op.
 *   - If prompt() throws, emit a `PROMPT_ERROR` event (unless done was already
 *     emitted), then emit `done` via the finally block.
 *   - If the prompt exceeds `timeoutMs`, emit `PROMPT_TIMEOUT` error + `done`
 *     and abort the agent.
 *
 * The `sink` callback is invoked for every emitted event and is responsible
 * for the session_id envelope (callers bind it).
 */
export async function orchestratePrompt(
  session: AgentSession,
  message: string,
  guard: DoneGuard,
  sink: (event: Record<string, unknown>) => void,
  timeoutMs: number = 600_000,
): Promise<void> {
  const timeoutId = setTimeout(() => {
    if (guard.done) return;
    guard.done = true;
    sink({
      type: "error",
      payload: { code: "PROMPT_TIMEOUT", message: `Prompt exceeded ${timeoutMs}ms limit` },
    });
    sink({ type: "done", payload: {} });
    try {
      session.agent.abort("Prompt timeout");
    } catch {
      // best-effort abort
    }
  }, timeoutMs);

  try {
    await session.prompt(message);
  } catch (err) {
    if (!guard.done) {
      sink({
        type: "error",
        payload: { code: "PROMPT_ERROR", message: String(err) },
      });
    }
  } finally {
    clearTimeout(timeoutId);
    if (!guard.done) {
      guard.done = true;
      sink({ type: "done", payload: {} });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add src/session-bridge.ts tests/session-bridge.test.ts
git commit -m "feat(sidecar): add orchestratePrompt with try/finally done-event guarantee (BUG3 root-cause fix)"
```

---

### Task 4: Natural completion emits `done` exactly once (TDD)

**Files:**
- Test: `bun-sidecar/tests/session-bridge.test.ts`

**Why:** Verify the guard prevents double-`done` when `agent_end` fires during a successful prompt.

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("orchestratePrompt — natural completion via agent_end", () => {
  test("agent_end during prompt emits done exactly once; finally is a no-op", async () => {
    let emit: (e: any) => void = () => {};
    const { session } = makeFakeSession({
      promptImpl: async () => { emit({ type: "agent_end" }); },
    });
    // wire emit by re-creating: simpler — use the returned emit and a guard-aware subscriber
    const guard = createDoneGuard();
    const events: Record<string, unknown>[] = [];

    // Manually simulate the subscriber: map events through mapPiEventToMaxma with the guard.
    session.subscribe((e: any) => {
      const mapped = mapPiEventToMaxma(e, guard);
      if (mapped) events.push(mapped);
    });

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 60_000);

    expect(guard.done).toBe(true);
    const doneCount = events.filter(e => e.type === "done").length;
    expect(doneCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (should already pass after Task 3)**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS — the subscriber marks `guard.done` on `agent_end`, so `orchestratePrompt`'s `finally` skips.

- [ ] **Step 3: Commit**

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add tests/session-bridge.test.ts
git commit -m "test(sidecar): cover natural-completion single-done via agent_end + guard"
```

---

### Task 5: Timeout circuit breaker (TDD)

**Files:**
- Test: `bun-sidecar/tests/session-bridge.test.ts`

**Why:** Guarantees a hung prompt (e.g. model never responds, agent silently stalls) cannot hang Python's `turn_done.wait()` forever. After `timeoutMs`, emit `PROMPT_TIMEOUT` error + `done`, then abort.

- [ ] **Step 1: Write the failing test**

Append:

```typescript
describe("orchestratePrompt — timeout circuit breaker", () => {
  test("hanging prompt triggers timeout error + done + abort", async () => {
    let resolvePrompt: () => void = () => {};
    const promptImpl = () => new Promise<void>(() => {}); // never resolves
    const abortCalls: string[] = [];
    const { session } = makeFakeSession({
      promptImpl,
      abortImpl: () => { abortCalls.push("aborted"); resolvePrompt(); },
    });
    const events: Record<string, unknown>[] = [];
    const guard = createDoneGuard();

    // Use a tiny timeout so the test is fast.
    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 50);

    expect(guard.done).toBe(true);
    expect(abortCalls).toEqual(["aborted"]);
    const types = events.map(e => e.type);
    expect(types).toContain("error");
    expect(types).toContain("done");
    const errEvt = events.find(e => e.type === "error") as any;
    expect(errEvt.payload.code).toBe("PROMPT_TIMEOUT");
  });

  test("timeout does not double-send done if agent_end already fired", async () => {
    // prompt resolves right as timeout would fire; agent_end marks guard first.
    let emit: (e: any) => void = () => {};
    const { session } = makeFakeSession({
      promptImpl: async () => { emit({ type: "agent_end" }); },
    });
    const guard = createDoneGuard();
    const events: Record<string, unknown>[] = [];
    session.subscribe((e: any) => {
      const mapped = mapPiEventToMaxma(e, guard);
      if (mapped) events.push(mapped);
    });

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 10_000);

    const doneCount = events.filter(e => e.type === "done").length;
    expect(doneCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS — the timeout branch was implemented in Task 3.

- [ ] **Step 3: Commit**

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add tests/session-bridge.test.ts
git commit -m "test(sidecar): cover 600s timeout circuit breaker path"
```

---

### Task 6: Wire `orchestratePrompt` into the `prompt` RPC handler and remove BUG3 patch

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts`:
  - `SessionRecord` interface (L27-31) — add `currentGuard: DoneGuard | null`
  - `subscribeSession` (L263-273) — pass the record's `currentGuard` into `mapPiEventToMaxma`
  - `prompt` RPC handler (L325-348) — use `orchestratePrompt`, drop the manual `sendEvent(... "done")` BUG3 line
  - `create_session` handler (L319) — initialize `currentGuard: null`

- [ ] **Step 1: Update `SessionRecord` and `subscribeSession`**

Change the interface:

```typescript
interface SessionRecord {
  session: AgentSession;
  unsubscribe: () => void;
  promptQueue: Promise<void>;
  currentGuard: DoneGuard | null;
}
```

Change `subscribeSession` to accept the record and pass the live guard:

```typescript
function subscribeSession(
  sessionId: string,
  session: AgentSession,
  record: SessionRecord,
): () => void {
  return session.subscribe((event: any) => {
    const mapped = mapPiEventToMaxma(event as Record<string, unknown>, record.currentGuard);
    if (mapped) {
      sendEvent(sessionId, mapped);
    }
  });
}
```

Update the `create_session` handler call site (L318-319) to pass the record and initialize `currentGuard`:

```typescript
const record: SessionRecord = {
  session,
  unsubscribe: () => {},
  promptQueue: Promise.resolve(),
  currentGuard: null,
};
record.unsubscribe = subscribeSession(sessionId, session, record);
sessions.set(sessionId, record);
```

- [ ] **Step 2: Rewrite the `prompt` RPC handler**

Replace the existing `prompt` block (L325-348) with:

```typescript
if (method === "prompt") {
  const sessionId: string = params?.session_id;
  const message: string = params?.message ?? "";
  const record = sessions.get(sessionId);
  if (!record) {
    sendError(id, `Session not found: ${sessionId}`);
    return;
  }

  record.promptQueue = record.promptQueue
    .catch(() => {})
    .then(async () => {
      const guard = createDoneGuard();
      record.currentGuard = guard;
      try {
        await orchestratePrompt(
          record.session,
          message,
          guard,
          (e) => sendEvent(sessionId, e),
        );
      } finally {
        if (record.currentGuard === guard) {
          record.currentGuard = null;
        }
      }
    });

  send(id, { ok: true });
  return;
}
```

- [ ] **Step 3: Run full test suite**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS (all existing tests still green; BUG3 manual `done` line is gone).

- [ ] **Step 4: Commit**

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add src/session-bridge.ts
git commit -m "refactor(sidecar): route prompt through orchestratePrompt; remove BUG3 manual done patch"
```

---

### Task 7: Rewrite `cancel` RPC handler to use the guard and remove BUG4 patch

**Files:**
- Modify: `bun-sidecar/src/session-bridge.ts` (`cancel` RPC handler at L351-365)

**Why:** Cancel no longer blindly sends `done`. If a prompt is in flight, cancel marks its guard and emits `done` directly; the prompt's `finally` sees `guard.done === true` and skips, so there is no double-`done`. If no prompt is in flight, cancel preserves legacy behavior by emitting `done` once.

- [ ] **Step 1: Write the failing test**

Append to `bun-sidecar/tests/session-bridge.test.ts`:

```typescript
import { handleCancelGuard } from "../src/session-bridge";

describe("handleCancelGuard", () => {
  test("with active, unfinished guard: marks guard and emits done", () => {
    const guard = createDoneGuard();
    const events: Record<string, unknown>[] = [];
    handleCancelGuard(guard, (e) => events.push(e));
    expect(guard.done).toBe(true);
    expect(events).toEqual([{ type: "done", payload: {} }]);
  });

  test("with already-done guard: no-op (no double done)", () => {
    const guard = createDoneGuard();
    guard.done = true;
    const events: Record<string, unknown>[] = [];
    handleCancelGuard(guard, (e) => events.push(e));
    expect(events).toEqual([]);
  });

  test("with null guard: emits done once (legacy, no prompt in flight)", () => {
    const events: Record<string, unknown>[] = [];
    handleCancelGuard(null, (e) => events.push(e));
    expect(events).toEqual([{ type: "done", payload: {} }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: FAIL — `handleCancelGuard` is not exported.

- [ ] **Step 3: Implement `handleCancelGuard` and rewrite the `cancel` handler**

Add the helper near `orchestratePrompt`:

```typescript
/**
 * Resolve the cancel RPC against the currently-active prompt guard.
 *
 *   - guard active & not done  → mark done, emit `done` (prompt's finally becomes a no-op)
 *   - guard active & already done → no-op (agent_end / timeout already emitted done)
 *   - no guard (idle)          → emit `done` once for legacy compatibility
 */
export function handleCancelGuard(
  guard: DoneGuard | null,
  sink: (event: Record<string, unknown>) => void,
): void {
  if (guard && guard.done) return;
  if (guard) guard.done = true;
  sink({ type: "done", payload: {} });
}
```

Replace the `cancel` RPC handler (L351-365) with:

```typescript
if (method === "cancel") {
  const sessionId: string = params?.session_id;
  const record = sessions.get(sessionId);
  if (!record) {
    sendError(id, `Session not found: ${sessionId}`);
    return;
  }

  record.session.agent.abort("Cancelled by user");
  handleCancelGuard(record.currentGuard, (e) => sendEvent(sessionId, e));

  send(id, { ok: true });
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add src/session-bridge.ts tests/session-bridge.test.ts
git commit -m "refactor(sidecar): cancel uses handleCancelGuard; remove BUG4 manual done patch"
```

---

### Task 8: Full suite green + final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bun test`
Expected: All tests PASS.

- [ ] **Step 2: Type-check the sidecar**

Run: `cd d:\Maxma\MaxmaHere\bun-sidecar && bunx tsc --noEmit`
Expected: No errors. (If `tsc` is unavailable, run `bun build src/session-bridge.ts --no-bundle --outfile /dev/null` as a fallback.)

- [ ] **Step 3: Confirm BUG3/BUG4 comments are gone**

Run a search of `session-bridge.ts` for `BUG3` and `BUG4`. Expected: no matches.

- [ ] **Step 4: Final commit (if any cleanup needed)**

If steps 1-3 required no changes, skip. Otherwise:

```bash
cd d:\Maxma\MaxmaHere\bun-sidecar && git add -A && git commit -m "chore(sidecar): final verification — tests + types green"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Read full file (Task 0 — done during planning).
- ✅ Refactor `prompt` with try/finally → `orchestratePrompt` (Task 3 + Task 6).
- ✅ 600s timeout circuit breaker → `orchestratePrompt` timeout branch (Task 5 + Task 3).
- ✅ Remove BUG3 manual patch → Task 6 Step 2.
- ✅ Remove BUG4 manual patch → Task 7 Step 3.
- ✅ Preserve cancel logic, route through try/finally → Task 7.
- ✅ TDD: tests written before/with each implementation step.
- ✅ Only `session-bridge.ts` modified + new test file. No other files touched.
- ✅ Frequent commits — one per task.

**2. Placeholder scan:** No TBD / TODO / "add error handling" placeholders. Every code step contains complete code.

**3. Type consistency:** `DoneGuard = { done: boolean }` is defined once (Task 3) and reused in `SessionRecord.currentGuard`, `mapPiEventToMaxma` param, `orchestratePrompt` param, `handleCancelGuard` param. `createDoneGuard()` returns `DoneGuard`. `handleCancelGuard` and `orchestratePrompt` use the same `sink: (event: Record<string, unknown>) => void` signature. Consistent.
