/**
 * RPC handler tests: exercise handleRpcRequest against a fake io + fake
 * sessions, covering the previously-untested branches:
 *   create_session / prompt queueing / cancel / undo / compact /
 *   user_response / get_messages / destroy_session / get_health /
 *   unknown method / missing session.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  handleRpcRequest,
  type BridgeIo,
  createDoneGuard,
  bridgeState,
} from "../src/session-bridge";

interface FakeSession {
  subscribe: () => () => void;
  prompt: (msg: string) => Promise<void>;
  dispose: () => Promise<void>;
  agent: {
    abort: (reason: string) => void;
    replaceMessages: (msgs: unknown[]) => void;
    appendMessage: (msg: unknown) => void;
  };
  state: { messages: { role: string; content?: unknown }[] };
  refreshMCPTools: (tools: unknown[]) => Promise<void>;
  settings: unknown;
  extensionRunner: unknown;
}

function makeFakeSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    subscribe: () => () => {},
    prompt: async () => {},
    dispose: async () => {},
    agent: { abort: () => {}, replaceMessages: () => {}, appendMessage: () => {} },
    state: { messages: [] },
    refreshMCPTools: async () => {},
    settings: { get: () => undefined, set: () => {} },
    extensionRunner: null,
    ...overrides,
  } as FakeSession;
}

function makeIo(overrides: Partial<BridgeIo> = {}): {
  io: BridgeIo;
  results: { id: number | null; result?: unknown; error?: string }[];
  events: { sid: string; event: Record<string, unknown> }[];
} {
  const results: { id: number | null; result?: unknown; error?: string }[] = [];
  const events: { sid: string; event: Record<string, unknown> }[] = [];
  const io: BridgeIo = {
    send: (id, result) => results.push({ id, result }),
    sendError: (id, message) => results.push({ id, error: message }),
    sendEvent: (sid, event) => events.push({ sid, event }),
    getSharedAuthStorage: async () => ({ setRuntimeApiKey: () => {} }),
    ensureSettings: async () => {
      throw new Error("ensureSettings should not be called in these tests");
    },
    ...overrides,
  };
  return { io, results, events };
}

function registerSession(
  sessionId: string,
  session: FakeSession,
  extras: Partial<{
    currentGuard: { done: boolean } | null;
    mcpManager: { disconnectAll: () => Promise<void> };
    unsubLifecycle: () => void;
  }> = {},
): void {
  bridgeState.sessions.set(sessionId, {
    session: session as never,
    unsubscribe: () => {},
    promptQueue: Promise.resolve(),
    currentGuard: extras.currentGuard ?? null,
    mcpManager: extras.mcpManager as never,
    unsubLifecycle: extras.unsubLifecycle,
    settings: session.settings as never,
  } as never);
}

beforeEach(() => {
  bridgeState.sessions.clear();
  bridgeState.pendingApprovals.clear();
});

// ── create_session ──────────────────────────────────────────────────────────

describe("handleRpcRequest — create_session", () => {
  test("creates a session and returns a session_id", async () => {
    const created: { options?: Record<string, unknown> } = {};
    const fakeSession = makeFakeSession();
    const { io, results } = makeIo({
      createAgentSession: async (options) => {
        created.options = options as Record<string, unknown>;
        return { session: fakeSession as never, setToolUIContext: undefined, eventBus: undefined };
      },
    });
    await handleRpcRequest(
      { method: "create_session", id: 1, params: { model: "openai/gpt-4o", cwd: "/tmp", permission_mode: "auto" } },
      io,
    );
    expect(results[0]?.id).toBe(1);
    const sid = (results[0]?.result as { session_id?: string })?.session_id;
    expect(typeof sid).toBe("string");
    expect(sid?.length).toBeGreaterThan(0);
    // registered in the sessions map
    expect(bridgeState.sessions.has(sid!)).toBe(true);
    // auto-approve mode passes autoApprove: true
    expect(created.options?.autoApprove).toBe(true);
  });

  test("session creation failure cleans up MCP and propagates error", async () => {
    const { io, results } = makeIo({
      createAgentSession: async () => {
        throw new Error("provider unavailable");
      },
    });
    await handleRpcRequest(
      { method: "create_session", id: 2, params: { model: "x/y", permission_mode: "auto" } },
      io,
    );
    expect(results[0]?.error).toContain("provider unavailable");
  });
});

// ── prompt / cancel ─────────────────────────────────────────────────────────

describe("handleRpcRequest — prompt & cancel", () => {
  test("prompt on missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "prompt", id: 1, params: { session_id: "nope", message: "hi" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });

  test("prompt queues onto the session's promptQueue and streams events", async () => {
    const prompted: string[] = [];
    const fakeSession = makeFakeSession({ prompt: async (m) => { prompted.push(m); } });
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "prompt", id: 1, params: { session_id: "s1", message: "hello" } }, io);
    expect(results[0]?.result).toEqual({ ok: true });
    // let the queued prompt run
    await new Promise((r) => setTimeout(r, 10));
    expect(prompted).toEqual(["hello"]);
  });

  test("cancel on missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "cancel", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });

  test("cancel with active guard marks done and emits done event", async () => {
    const guard = createDoneGuard();
    const abortCalls: string[] = [];
    const fakeSession = makeFakeSession({
      agent: { ...makeFakeSession().agent, abort: (r) => abortCalls.push(r) },
    });
    registerSession("s1", fakeSession, { currentGuard: guard });
    const { io, events, results } = makeIo();
    await handleRpcRequest({ method: "cancel", id: 1, params: { session_id: "s1" } }, io);
    expect(abortCalls).toEqual(["Cancelled by user"]);
    expect(guard.done).toBe(true);
    expect(events.some((e) => e.event.type === "done")).toBe(true);
    expect(results[0]?.result).toEqual({ ok: true });
  });

  test("cancel with no active prompt still emits done (legacy compat)", async () => {
    const fakeSession = makeFakeSession();
    registerSession("s1", fakeSession, { currentGuard: null });
    const { io, events } = makeIo();
    await handleRpcRequest({ method: "cancel", id: 1, params: { session_id: "s1" } }, io);
    expect(events.some((e) => e.event.type === "done")).toBe(true);
  });
});

// ── undo ────────────────────────────────────────────────────────────────────

describe("handleRpcRequest — undo", () => {
  function historySession() {
    return makeFakeSession({
      state: {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "u2" },
          { role: "assistant", content: "a2" },
        ],
      },
    });
  }

  test("undo removes one turn", async () => {
    const replaced: unknown[][] = [];
    const fakeSession = historySession();
    fakeSession.agent.replaceMessages = (m) => replaced.push(m);
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "undo", id: 1, params: { session_id: "s1", steps: 1 } }, io);
    const r = results[0]?.result as { removed?: number };
    expect(r?.removed).toBe(2);
    expect(replaced[0]?.length).toBe(3); // system + u1 + a1
  });

  test("undo refuses when not enough turns (no wipe)", async () => {
    const replaced: unknown[][] = [];
    const fakeSession = historySession();
    fakeSession.agent.replaceMessages = (m) => replaced.push(m);
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "undo", id: 1, params: { session_id: "s1", steps: 99 } }, io);
    const r = results[0]?.result as { removed?: number; detail?: string };
    expect(r?.removed).toBe(0);
    expect(r?.detail).toBe("no turns to undo");
    expect(replaced.length).toBe(0); // replaceMessages never called
  });

  test("undo on missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "undo", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

// ── compact ─────────────────────────────────────────────────────────────────

describe("handleRpcRequest — compact", () => {
  test("compact preserves leading system message", async () => {
    const replaced: unknown[][] = [];
    const fakeSession = makeFakeSession({
      state: {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "u2" },
          { role: "assistant", content: "a2" },
        ],
      },
    });
    fakeSession.agent.replaceMessages = (m) => replaced.push(m);
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "compact", id: 1, params: { session_id: "s1", keep_last: 2 } }, io);
    const r = results[0]?.result as { compressed?: boolean; removed_count?: number };
    expect(r?.compressed).toBe(true);
    expect(r?.removed_count).toBe(2);
    const kept = replaced[0] as { role?: string }[];
    expect(kept[0]?.role).toBe("system");
    expect(kept.length).toBe(3);
  });

  test("compact with nothing to remove reports not compressed", async () => {
    const fakeSession = makeFakeSession({ state: { messages: [{ role: "user", content: "x" }] } });
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "compact", id: 1, params: { session_id: "s1", keep_last: 100 } }, io);
    const r = results[0]?.result as { compressed?: boolean; removed_count?: number };
    expect(r?.compressed).toBe(false);
    expect(r?.removed_count).toBe(0);
  });
});

// ── user_response ───────────────────────────────────────────────────────────

describe("handleRpcRequest — user_response", () => {
  test("'yes' resolves pending approval with 'Approve'", async () => {
    let resolved: string | undefined;
    bridgeState.pendingApprovals.set("approval-1", {
      resolve: (c) => { resolved = c; },
      reject: () => {},
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    });
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "user_response", id: 1, params: { interaction_id: "approval-1", response: "yes" } },
      io,
    );
    expect(resolved).toBe("Approve");
    expect(results[0]?.result).toEqual({ ok: true });
    expect(bridgeState.pendingApprovals.size).toBe(0);
  });

  test("'no' resolves pending approval with 'Deny'", async () => {
    let resolved: string | undefined;
    bridgeState.pendingApprovals.set("approval-1", {
      resolve: (c) => { resolved = c; },
      reject: () => {},
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    });
    const { io } = makeIo();
    await handleRpcRequest(
      { method: "user_response", id: 1, params: { interaction_id: "approval-1", response: "no" } },
      io,
    );
    expect(resolved).toBe("Deny");
  });

  test("unknown interaction_id responds ok without crashing", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "user_response", id: 1, params: { interaction_id: "ghost", response: "yes" } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true });
  });
});

// ── get_messages ────────────────────────────────────────────────────────────

describe("handleRpcRequest — get_messages", () => {
  const fakeSession = makeFakeSession({
    state: {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        { role: "assistant", content: "world" },
      ],
    },
  });

  test("returns messages with normalized text content", async () => {
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "get_messages", id: 1, params: { session_id: "s1", limit: 50 } }, io);
    const r = results[0]?.result as { messages?: { role: string; content: string }[]; total?: number };
    expect(r?.total).toBe(3);
    expect(r?.messages?.[1]?.content).toBe("hello"); // array content flattened
  });

  test("limit<=0 returns empty messages (A4 probe semantics)", async () => {
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "get_messages", id: 1, params: { session_id: "s1", limit: 0 } }, io);
    const r = results[0]?.result as { messages?: unknown[]; total?: number };
    expect(r?.messages).toEqual([]);
    expect(r?.total).toBe(3);
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "get_messages", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

// ── destroy_session ─────────────────────────────────────────────────────────

describe("handleRpcRequest — destroy_session", () => {
  test("disposes session, unsubscribes lifecycle, disconnects MCP", async () => {
    let disposed = false;
    let disconnected = false;
    let unsubbed = false;
    const fakeSession = makeFakeSession({ dispose: async () => { disposed = true; } });
    registerSession("s1", fakeSession, {
      unsubLifecycle: () => { unsubbed = true; },
      mcpManager: { disconnectAll: async () => { disconnected = true; } },
    });
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "destroy_session", id: 1, params: { session_id: "s1" } }, io);
    expect(disposed).toBe(true);
    expect(unsubbed).toBe(true);
    expect(disconnected).toBe(true);
    expect(results[0]?.result).toEqual({ ok: true });
    expect(bridgeState.sessions.has("s1")).toBe(false);
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "destroy_session", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

// ── misc RPCs ───────────────────────────────────────────────────────────────

describe("handleRpcRequest — misc", () => {
  test("get_health responds ok", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "get_health", id: 1, params: {} }, io);
    expect(results[0]?.result).toEqual({ status: "ok", message: "sidecar running" });
  });

  test("reload_mcp requires an existing session", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "reload_mcp", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });

  test("unknown method → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "frobnicate", id: 1, params: {} }, io);
    expect(results[0]?.error).toContain("Unknown method");
  });

  test("missing session_id on prompt-like methods is a clean error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "undo", id: 1, params: {} }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

// ── parseModel via create_session ───────────────────────────────────────────

describe("handleRpcRequest — model resolution", () => {
  test("provider/model string is parsed into a Model object", async () => {
    let received: Record<string, unknown> | undefined;
    const fakeSession = makeFakeSession();
    const { io } = makeIo({
      createAgentSession: async (options) => {
        received = options as Record<string, unknown>;
        return { session: fakeSession as never, setToolUIContext: undefined, eventBus: undefined };
      },
    });
    await handleRpcRequest(
      { method: "create_session", id: 1, params: { model: "openai/gpt-4o", cwd: "/tmp", permission_mode: "auto" } },
      io,
    );
    const model = received?.model as { id?: string; provider?: string; baseUrl?: string };
    expect(model?.id).toBe("gpt-4o");
    expect(model?.provider).toBe("openai");
    expect(typeof model?.baseUrl).toBe("string");
  });

  test("options.provider overrides the provider parsed from the model string", async () => {
    let received: Record<string, unknown> | undefined;
    const fakeSession = makeFakeSession();
    const { io } = makeIo({
      createAgentSession: async (options) => {
        received = options as Record<string, unknown>;
        return { session: fakeSession as never, setToolUIContext: undefined, eventBus: undefined };
      },
    });
    await handleRpcRequest(
      {
        method: "create_session",
        id: 1,
        params: { model: "custom-model", provider: "deepseek", cwd: "/tmp", permission_mode: "auto" },
      },
      io,
    );
    const model = received?.model as { id?: string; provider?: string };
    expect(model?.provider).toBe("deepseek");
    expect(model?.id).toBe("custom-model");
  });

  test("runtime api key is applied to auth storage when both provider and key given", async () => {
    let applied: { provider: string; key: string } | undefined;
    const fakeSession = makeFakeSession();
    const { io } = makeIo({
      getSharedAuthStorage: async () => ({
        setRuntimeApiKey: (p: string, k: string) => { applied = { provider: p, key: k }; },
      }),
      createAgentSession: async (options) => {
        void options;
        return { session: fakeSession as never, setToolUIContext: undefined, eventBus: undefined };
      },
    });
    await handleRpcRequest(
      {
        method: "create_session",
        id: 1,
        params: { model: "openai/gpt-4o", provider: "openai", api_key: "sk-test", cwd: "/tmp", permission_mode: "auto" },
      },
      io,
    );
    expect(applied).toEqual({ provider: "openai", key: "sk-test" });
  });
});

// ── runtime approval / plan / workflow ──────────────────────────────────────

describe("handleRpcRequest — set_auto_approve", () => {
  test("toggles approval mode on the session settings", async () => {
    const sets: [string, unknown][] = [];
    const fakeSession = makeFakeSession({
      settings: { get: () => undefined, set: (p: string, v: unknown) => sets.push([p, v]) },
    });
    registerSession("s1", fakeSession);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "set_auto_approve", id: 1, params: { session_id: "s1", auto_approve: true } }, io);
    expect(sets).toContainEqual(["tools.approvalMode", "yolo"]);
    expect(results[0]?.result).toEqual({ ok: true });
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "set_auto_approve", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — plan_action", () => {
  function planSession() {
    const appended: unknown[] = [];
    const fakeSession = makeFakeSession({
      agent: { ...makeFakeSession().agent, appendMessage: (m) => appended.push(m) },
    });
    registerSession("s1", fakeSession);
    return { appended };
  }

  test("approve without modified plan appends a generic approval message", async () => {
    const { appended } = planSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "plan_action", id: 1, params: { session_id: "s1", action: "approve", plan_id: "p1" } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true });
    expect(appended.length).toBe(1);
    expect((appended[0] as { content?: string }).content).toContain("[Plan Approved]");
  });

  test("approve with modified plan embeds the revised plan", async () => {
    const { appended } = planSession();
    const { io } = makeIo();
    await handleRpcRequest(
      {
        method: "plan_action",
        id: 1,
        params: { session_id: "s1", action: "approve", plan_id: "p1", modified_plan: "STEP 1: do X" },
      },
      io,
    );
    expect((appended[0] as { content?: string }).content).toContain("STEP 1: do X");
  });

  test("reject appends a rejection message", async () => {
    const { appended } = planSession();
    const { io } = makeIo();
    await handleRpcRequest(
      { method: "plan_action", id: 1, params: { session_id: "s1", action: "reject", plan_id: "p1" } },
      io,
    );
    expect((appended[0] as { content?: string }).content).toContain("[Plan Rejected]");
  });

  test("modify without plan text is a no-op append", async () => {
    const { appended } = planSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "plan_action", id: 1, params: { session_id: "s1", action: "modify", plan_id: "p1" } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true });
    expect(appended.length).toBe(0);
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "plan_action", id: 1, params: { session_id: "nope", action: "approve" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — set_plan_mode", () => {
  function planModeSession() {
    const calls: { op: string; arg?: unknown }[] = [];
    const settings = { get: () => undefined, set: () => {} };
    const fakeSession = makeFakeSession({
      settings,
      agent: { ...makeFakeSession().agent },
      getActiveToolNames: () => ["read", "bash"],
      setActiveToolsByName: async (names: string[]) => {
        calls.push({ op: "setActiveToolsByName", arg: names });
      },
      setPlanModeState: (state: unknown) => {
        calls.push({ op: "setPlanModeState", arg: state });
      },
      sendPlanModeContext: async () => {
        calls.push({ op: "sendPlanModeContext" });
      },
      isStreaming: false,
    } as never);
    registerSession("s1", fakeSession as never);
    return { calls, settings };
  }

  test("enable installs resolve tool + plan state + context steer", async () => {
    const { calls } = planModeSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "set_plan_mode", id: 1, params: { session_id: "s1", enabled: true } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true, enabled: true });
    const toolCall = calls.find((c) => c.op === "setActiveToolsByName");
    expect(toolCall?.arg).toContain("resolve");
    const stateCall = calls.find((c) => c.op === "setPlanModeState");
    expect(stateCall?.arg).toMatchObject({ enabled: true, planFilePath: "local://PLAN.md" });
    expect(calls.some((c) => c.op === "sendPlanModeContext")).toBe(true);
  });

  test("enable does not duplicate an already-active resolve tool", async () => {
    const calls: { op: string; arg?: unknown }[] = [];
    const fakeSession = makeFakeSession({
      settings: { get: () => undefined, set: () => {} },
      getActiveToolNames: () => ["read", "resolve"],
      setActiveToolsByName: async (names: string[]) => {
        calls.push({ op: "setActiveToolsByName", arg: names });
      },
      setPlanModeState: () => {},
      isStreaming: true,
    } as never);
    registerSession("s1", fakeSession as never);
    const { io } = makeIo();
    await handleRpcRequest(
      { method: "set_plan_mode", id: 1, params: { session_id: "s1", enabled: true } },
      io,
    );
    // resolve 已在活跃列表 → 不重复调用 setActiveToolsByName
    expect(calls.filter((c) => c.op === "setActiveToolsByName").length).toBe(0);
    // 流式中不注入 steer 上下文
    expect(calls.some((c) => c.op === "sendPlanModeContext")).toBe(false);
  });

  test("disable clears plan state and does not re-add tools", async () => {
    const { calls } = planModeSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "set_plan_mode", id: 1, params: { session_id: "s1", enabled: false } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true, enabled: false });
    const stateCall = calls.find((c) => c.op === "setPlanModeState");
    expect(stateCall?.arg).toBeUndefined();
    expect(calls.some((c) => c.op === "setActiveToolsByName")).toBe(false);
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "set_plan_mode", id: 1, params: { session_id: "nope", enabled: true } },
      io,
    );
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — checkpoint_action", () => {
  function checkpointSession() {
    const appended: unknown[] = [];
    const fakeSession = makeFakeSession({
      agent: { ...makeFakeSession().agent, appendMessage: (m) => appended.push(m) },
    });
    registerSession("s1", fakeSession);
    return { appended };
  }

  test("save appends a checkpoint request message", async () => {
    const { appended } = checkpointSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "checkpoint_action", id: 1, params: { session_id: "s1", action: "save", goal: "before refactor" } },
      io,
    );
    expect(results[0]?.result).toEqual({ ok: true, action: "save" });
    expect(appended.length).toBe(1);
    const msg = appended[0] as { content?: string; role?: string };
    expect(msg.role).toBe("user");
    expect(msg.content).toContain("[Checkpoint Request]");
    expect(msg.content).toContain("before refactor");
  });

  test("restore appends a rewind request message", async () => {
    const { appended } = checkpointSession();
    const { io } = makeIo();
    await handleRpcRequest(
      { method: "checkpoint_action", id: 1, params: { session_id: "s1", action: "restore" } },
      io,
    );
    const msg = appended[0] as { content?: string };
    expect(msg.content).toContain("[Rewind Request]");
    expect(msg.content).toContain("rewind tool");
  });

  test("missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "checkpoint_action", id: 1, params: { session_id: "nope", action: "save" } },
      io,
    );
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — goal_action / get_goal_state", () => {
  function goalSession() {
    const calls: { op: string; arg?: unknown }[] = [];
    const goalRuntime = {
      createGoal: async (input: unknown) => {
        calls.push({ op: "createGoal", arg: input });
        return { enabled: true, mode: "active", goal: { id: "g1", objective: (input as { objective: string }).objective, status: "active" } };
      },
      replaceGoal: async (input: unknown) => {
        calls.push({ op: "replaceGoal", arg: input });
        return { enabled: true, mode: "active", goal: { id: "g1", objective: (input as { objective: string }).objective, status: "active" } };
      },
      pauseGoal: async () => {
        calls.push({ op: "pauseGoal" });
        return { enabled: true, mode: "active", goal: { id: "g1", status: "paused" } };
      },
      resumeGoal: async () => {
        calls.push({ op: "resumeGoal" });
        return { enabled: true, mode: "active", goal: { id: "g1", status: "active" } };
      },
      dropGoal: async () => {
        calls.push({ op: "dropGoal" });
        return { id: "g1", status: "dropped" };
      },
    };
    const fakeSession = makeFakeSession({
      settings: { get: () => undefined, set: () => {} },
      goalRuntime,
      getGoalModeState: () => ({ enabled: true, mode: "active", goal: { id: "g1", objective: "x", status: "active", tokensUsed: 0, timeUsedSeconds: 0, createdAt: 0, updatedAt: 0 } }),
    } as never);
    registerSession("s1", fakeSession as never);
    return { calls };
  }

  test("set creates a goal with objective and enables goal mode", async () => {
    const { calls } = goalSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "goal_action", id: 1, params: { session_id: "s1", action: "set", objective: "完成文档" } },
      io,
    );
    expect(results[0]?.result?.ok).toBe(true);
    expect(calls.find((c) => c.op === "createGoal")?.arg).toMatchObject({ objective: "完成文档" });
    expect(results[0]?.result?.state?.goal?.status).toBe("active");
  });

  test("replace uses replaceGoal", async () => {
    const { calls } = goalSession();
    const { io } = makeIo();
    await handleRpcRequest(
      { method: "goal_action", id: 1, params: { session_id: "s1", action: "replace", objective: "新目标", token_budget: 50000 } },
      io,
    );
    expect(calls.find((c) => c.op === "replaceGoal")?.arg).toMatchObject({ objective: "新目标", tokenBudget: 50000 });
  });

  test("set without objective → error", async () => {
    goalSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "goal_action", id: 1, params: { session_id: "s1", action: "set" } },
      io,
    );
    expect(results[0]?.error).toContain("objective is required");
  });

  test("pause / resume / drop dispatch correctly", async () => {
    const { calls } = goalSession();
    const { io } = makeIo();
    await handleRpcRequest({ method: "goal_action", id: 1, params: { session_id: "s1", action: "pause" } }, io);
    await handleRpcRequest({ method: "goal_action", id: 1, params: { session_id: "s1", action: "resume" } }, io);
    await handleRpcRequest({ method: "goal_action", id: 1, params: { session_id: "s1", action: "drop" } }, io);
    expect(calls.map((c) => c.op)).toEqual(["pauseGoal", "resumeGoal", "dropGoal"]);
  });

  test("unknown action → error", async () => {
    goalSession();
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "goal_action", id: 1, params: { session_id: "s1", action: "explode" } },
      io,
    );
    expect(results[0]?.error).toContain("Unknown goal action");
  });

  test("get_goal_state returns current state", async () => {
    goalSession();
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "get_goal_state", id: 1, params: { session_id: "s1" } }, io);
    expect(results[0]?.result?.state?.goal?.status).toBe("active");
  });

  test("goal action on missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest(
      { method: "goal_action", id: 1, params: { session_id: "nope", action: "set", objective: "x" } },
      io,
    );
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — session_recap", () => {
  test("chains a recap prompt and returns the captured answer", async () => {
    const listeners: Array<(e: { type?: string; payload?: { content?: string }; content?: string }) => void> = [];
    const fakeSession = makeFakeSession({
      subscribe: (fn: (e: unknown) => void) => {
        listeners.push(fn as never);
        return () => {};
      },
      prompt: async (msg: string) => {
        // 模拟 OMP 在 prompt 期间发出 answer 事件
        for (const l of listeners) l({ type: "answer", payload: { content: "回顾：已完成 A，待办 B。" } });
        return true;
      },
      waitForIdle: async () => {},
    } as never);
    registerSession("s1", fakeSession as never);
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "session_recap", id: 1, params: { session_id: "s1" } }, io);
    expect(results[0]?.result?.answer).toContain("回顾");
  });

  test("recap on missing session → error", async () => {
    const { io, results } = makeIo();
    await handleRpcRequest({ method: "session_recap", id: 1, params: { session_id: "nope" } }, io);
    expect(results[0]?.error).toContain("Session not found");
  });
});

describe("handleRpcRequest — execute_workflow_step", () => {
  test("prompts the agent and emits start/end events", async () => {
    const prompted: string[] = [];
    const fakeSession = makeFakeSession({ prompt: async (m) => { prompted.push(m); } });
    registerSession("s1", fakeSession);
    const { io, results, events } = makeIo();
    await handleRpcRequest(
      {
        method: "execute_workflow_step",
        id: 1,
        params: {
          session_id: "s1",
          step_definition: { step_id: "st1", tool: "bash", args: { command: "ls" } },
        },
      },
      io,
    );
    expect(events[0]?.event.type).toBe("workflow_step_start");
    expect(events[1]?.event.type).toBe("workflow_step_end");
    expect(results[0]?.result).toEqual({ ok: true, step_id: "st1" });
    expect(prompted[0]).toContain("bash");
  });

  test("prompt failure emits step error and error response", async () => {
    const fakeSession = makeFakeSession({
      prompt: async () => { throw new Error("tool crashed"); },
    });
    registerSession("s1", fakeSession);
    const { io, results, events } = makeIo();
    await handleRpcRequest(
      {
        method: "execute_workflow_step",
        id: 1,
        params: { session_id: "s1", step_definition: { step_id: "st1", tool: "x" } },
      },
      io,
    );
    expect(events.some((e) => e.event.type === "workflow_step_error")).toBe(true);
    expect(results[0]?.error).toContain("Workflow step failed");
  });
});
