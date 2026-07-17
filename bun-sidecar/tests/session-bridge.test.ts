import { describe, test, expect } from "bun:test";
import {
  mapPiEventToMaxma,
  createDoneGuard,
  orchestratePrompt,
} from "../src/session-bridge";

describe("module import smoke test", () => {
  test("mapPiEventToMaxma is exported and callable", () => {
    const out = mapPiEventToMaxma({ type: "agent_end" });
    expect(out).toEqual({ type: "done", payload: {} });
  });
});

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
  return { session, emit: (e: any) => subscribers.forEach((cb) => cb(e)) };
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

describe("orchestratePrompt — natural completion via agent_end", () => {
  test("agent_end during prompt emits done exactly once; finally is a no-op", async () => {
    const { session, emit } = makeFakeSession({
      promptImpl: async () => { emit({ type: "agent_end" }); },
    });
    const guard = createDoneGuard();
    const events: Record<string, unknown>[] = [];

    // Simulate the real subscriber: map events through mapPiEventToMaxma with the guard.
    session.subscribe((e: any) => {
      const mapped = mapPiEventToMaxma(e, guard);
      if (mapped) events.push(mapped);
    });

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 60_000);

    expect(guard.done).toBe(true);
    const doneCount = events.filter((e) => e.type === "done").length;
    expect(doneCount).toBe(1);
  });
});

describe("orchestratePrompt — timeout circuit breaker", () => {
  test("hanging prompt triggers timeout error + done + abort", async () => {
    // Simulate real agent behavior: prompt never resolves on its own, but
    // agent.abort() causes the in-flight prompt to reject.
    let rejectPrompt!: (err: unknown) => void;
    const promptImpl = () =>
      new Promise<void>((_resolve, reject) => { rejectPrompt = reject; });
    const abortCalls: string[] = [];
    const { session } = makeFakeSession({
      promptImpl,
      abortImpl: () => {
        abortCalls.push("aborted");
        rejectPrompt(new Error("Aborted: Prompt timeout"));
      },
    });
    const events: Record<string, unknown>[] = [];
    const guard = createDoneGuard();

    // Use a tiny timeout so the test is fast.
    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 50);

    expect(guard.done).toBe(true);
    expect(abortCalls).toEqual(["aborted"]);
    const types = events.map((e) => e.type);
    expect(types).toContain("error");
    expect(types).toContain("done");
    const errEvt = events.find((e) => e.type === "error") as any;
    expect(errEvt.payload.code).toBe("PROMPT_TIMEOUT");
  });

  test("timeout does not double-send done if agent_end already fired", async () => {
    const { session, emit } = makeFakeSession({
      promptImpl: async () => { emit({ type: "agent_end" }); },
    });
    const guard = createDoneGuard();
    const events: Record<string, unknown>[] = [];
    session.subscribe((e: any) => {
      const mapped = mapPiEventToMaxma(e, guard);
      if (mapped) events.push(mapped);
    });

    await orchestratePrompt(session as any, "hi", guard, (e) => events.push(e), 10_000);

    const doneCount = events.filter((e) => e.type === "done").length;
    expect(doneCount).toBe(1);
  });
});


