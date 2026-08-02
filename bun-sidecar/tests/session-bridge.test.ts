import { describe, test, expect } from "bun:test";
import {
  mapPiEventToMaxma,
  createDoneGuard,
  orchestratePrompt,
  handleCancelGuard,
  buildCreateSessionOptions,
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

describe("mapPiEventToMaxma message_update", () => {
  test("text_delta → token", () => {
    const out = mapPiEventToMaxma({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    });
    expect(out).toEqual({ type: "token", payload: { token: "hello" } });
  });

  test("thinking_start", () => {
    const out = mapPiEventToMaxma({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start" },
    });
    expect(out).toEqual({ type: "thinking_start", payload: {} });
  });

  test("thinking_delta → independent event (not token)", () => {
    const out = mapPiEventToMaxma({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "reasoning..." },
    });
    expect(out).toEqual({ type: "thinking_delta", payload: { delta: "reasoning..." } });
  });

  test("thinking_end", () => {
    const out = mapPiEventToMaxma({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_end", content: "final thought" },
    });
    expect(out).toEqual({ type: "thinking_end", payload: { content: "final thought" } });
  });

  test("error in assistant message", () => {
    const out = mapPiEventToMaxma({
      type: "message_update",
      assistantMessageEvent: { type: "error", error: { content: [{ text: "API error" }] } },
    });
    expect(out).toEqual({ type: "error", payload: { code: "AGENT_ERROR", message: "API error" } });
  });
});

describe("mapPiEventToMaxma tool_execution", () => {
  test("tool_execution_start → tool_start", () => {
    const out = mapPiEventToMaxma({
      type: "tool_execution_start",
      toolName: "bash", args: { cmd: "ls" }, toolCallId: "c1",
    });
    expect(out).toMatchObject({
      type: "tool_start",
      payload: { tool_name: "bash", input: expect.stringContaining("ls") },
    });
  });

  test("tool_execution_update → tool_update", () => {
    const out = mapPiEventToMaxma({
      type: "tool_execution_update",
      toolName: "bash", partialResult: "line1\n", toolCallId: "c1",
    });
    expect(out).toEqual({
      type: "tool_update",
      payload: { tool_name: "bash", partial_result: "line1\n" },
    });
  });

  test("tool_execution_end (success) → tool_end", () => {
    const out = mapPiEventToMaxma({
      type: "tool_execution_end",
      toolName: "bash", result: { exitCode: 0 }, toolCallId: "c2",
    });
    expect(out).toMatchObject({
      type: "tool_end",
      payload: { tool_name: "bash", elapsed: expect.any(Number) },
    });
  });

  test("tool_execution_end (error) → tool_error", () => {
    const out = mapPiEventToMaxma({
      type: "tool_execution_end",
      toolName: "bash", result: { exitCode: 1 }, isError: true,
    });
    expect(out).toMatchObject({
      type: "tool_error",
      payload: { tool_name: "bash", elapsed: 0 },
    });
  });
});

describe("mapPiEventToMaxma message_end → answer", () => {
  test("string content", () => {
    const out = mapPiEventToMaxma({
      type: "message_end", message: { content: "Hello!" },
    });
    expect(out).toEqual({ type: "answer", payload: { content: "Hello!" } });
  });

  test("array content (text blocks)", () => {
    const out = mapPiEventToMaxma({
      type: "message_end",
      message: { content: [{ type: "text", text: "A " }, { type: "text", text: "B" }] },
    });
    expect(out).toEqual({ type: "answer", payload: { content: "A B" } });
  });
});

describe("mapPiEventToMaxma compaction", () => {
  test("auto_compaction_end → context_compressed", () => {
    const out = mapPiEventToMaxma({
      type: "auto_compaction_end", action: "snapcompact",
      result: { shortSummary: "done", tokensBefore: 50000 },
    });
    expect(out).toMatchObject({
      type: "context_compressed",
      payload: { action: "snapcompact", before_tokens: 50000 },
    });
  });

  test("auto_compaction_start → context_compressing", () => {
    const out = mapPiEventToMaxma({
      type: "auto_compaction_start", reason: "threshold", action: "snapcompact",
    });
    expect(out).toEqual({
      type: "context_compressing",
      payload: { reason: "threshold", action: "snapcompact" },
    });
  });
});

describe("mapPiEventToMaxma retry / todo / irc / notice", () => {
  test("auto_retry_start → retry_start", () => {
    const out = mapPiEventToMaxma({
      type: "auto_retry_start",
      attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: "err",
    });
    expect(out).toEqual({
      type: "retry_start",
      payload: { attempt: 1, max_attempts: 3, delay_ms: 1000, error_message: "err" },
    });
  });

  test("todo_reminder", () => {
    const out = mapPiEventToMaxma({
      type: "todo_reminder",
      todos: [{ content: "task", status: "pending" }], attempt: 1, maxAttempts: 3,
    });
    expect(out).toEqual({
      type: "todo_reminder",
      payload: { todos: [{ content: "task", status: "pending" }], attempt: 1, max_attempts: 3 },
    });
  });

  test("irc_message", () => {
    const out = mapPiEventToMaxma({
      type: "irc_message",
      message: { from: "a", to: "b", body: "hi", id: "m1" },
    });
    expect(out).toEqual({
      type: "irc_message",
      payload: { from: "a", to: "b", body: "hi", id: "m1" },
    });
  });

  test("notice", () => {
    const out = mapPiEventToMaxma({
      type: "notice", level: "warning", message: "conn lost", source: "mcp",
    });
    expect(out).toEqual({
      type: "notice",
      payload: { level: "warning", message: "conn lost", source: "mcp" },
    });
  });
});

describe("mapPiEventToMaxma null returns", () => {
  test("unknown type → null", () => {
    expect(mapPiEventToMaxma({ type: "bogus" })).toBeNull();
  });
  test("message_update without assistantMessageEvent → null", () => {
    expect(mapPiEventToMaxma({ type: "message_update" })).toBeNull();
  });
  test("irc_message without message → null", () => {
    expect(mapPiEventToMaxma({ type: "irc_message" })).toBeNull();
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

describe("buildCreateSessionOptions — appendSystemPrompt", () => {
  function build(opts: Record<string, unknown> = {}) {
    return buildCreateSessionOptions(
      {
        model: { id: "openai/gpt-4o" } as any,
        cwd: "/tmp",
        authStorage: {} as any,
        permissionMode: "yolo",
        ...opts,
      },
      (async () => undefined) as any,
    );
  }

  test("appendSystemPrompt is passed through when systemPrompt is absent", async () => {
    const { options } = await build({ appendSystemPrompt: "始终使用中文" });
    expect(options.appendSystemPrompt).toBe("始终使用中文");
    expect(options.systemPrompt).toBeUndefined();
  });

  test("systemPrompt wins and appendSystemPrompt is ignored when both set", async () => {
    const { options } = await build({
      systemPrompt: "brand prompt",
      appendSystemPrompt: "native append",
    });
    expect(options.systemPrompt).toBe("brand prompt");
    expect(options.appendSystemPrompt).toBeUndefined();
  });

  test("neither set → no prompt fields", async () => {
    const { options } = await build({});
    expect(options.systemPrompt).toBeUndefined();
    expect(options.appendSystemPrompt).toBeUndefined();
  });
});

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



