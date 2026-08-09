/**
 * Pure-logic tests: parseApprovalTitle, computeUndoTurnCut, compactMessages,
 * resolveUserResponse, filterMcpTools, createApprovalUiContext.
 *
 * These cover the previously-untested branches of session-bridge.ts:
 * approval lifecycle, undo BC-002 wipe protection, compact leading-system
 * preservation, and MCP allow/block filtering.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  parseApprovalTitle,
  computeUndoTurnCut,
  compactMessages,
  resolveUserResponse,
  filterMcpTools,
  createApprovalUiContext,
  bridgeState,
} from "../src/session-bridge";

// ── parseApprovalTitle ──────────────────────────────────────────────────────

describe("parseApprovalTitle", () => {
  const TITLE =
    "Allow tool: bash\n\nArgs:\n{\"command\":\"rm -rf /\"}\n\nReason: delete files";

  test("extracts tool name from 'Allow tool: ' prefix", () => {
    const { toolName } = parseApprovalTitle(TITLE);
    expect(toolName).toBe("bash");
  });

  test("falls back to whole first line when no prefix", () => {
    const { toolName } = parseApprovalTitle("write_file");
    expect(toolName).toBe("write_file");
  });

  test("parses JSON Args block into tool_input", () => {
    const { toolInput } = parseApprovalTitle(TITLE);
    expect(toolInput).toEqual({ command: "rm -rf /" });
  });

  test("keeps raw text when Args is not valid JSON", () => {
    const { toolInput } = parseApprovalTitle(
      "Allow tool: bash\n\nArgs:\nnot-json",
    );
    expect(toolInput).toEqual({ raw: "not-json" });
  });

  test("empty Args block yields undefined tool_input", () => {
    const { toolInput } = parseApprovalTitle("Allow tool: bash\n\nReason: none");
    expect(toolInput).toBeUndefined();
  });

  test("risk level high on destructive keywords", () => {
    const { riskLevel } = parseApprovalTitle(
      "Allow tool: bash\n\nReason: force remove directory",
    );
    expect(riskLevel).toBe("high");
  });

  test("risk level high on destructive tool name", () => {
    const { riskLevel } = parseApprovalTitle("Allow tool: delete_file\n\nReason: cleanup");
    expect(riskLevel).toBe("high");
  });

  test("risk level medium on write/execute keywords", () => {
    const { riskLevel } = parseApprovalTitle(
      "Allow tool: bash\n\nReason: run tests",
    );
    expect(riskLevel).toBe("medium");
  });

  test("risk level low on benign reason", () => {
    const { riskLevel } = parseApprovalTitle(
      "Allow tool: read_file\n\nReason: inspect config",
    );
    expect(riskLevel).toBe("low");
  });
});

// ── computeUndoTurnCut (BC-002) ─────────────────────────────────────────────

function msg(role: string): { role: string } {
  return { role };
}

describe("computeUndoTurnCut", () => {
  const history = [
    msg("system"),
    msg("user"),
    msg("assistant"),
    msg("user"),
    msg("assistant"),
    msg("user"),
    msg("assistant"),
  ];

  test("cuts exactly `steps` user turns from the end", () => {
    const r = computeUndoTurnCut(history, 1);
    expect(r.canUndo).toBe(true);
    expect(r.turnsRemoved).toBe(1);
    expect(r.cutIndex).toBe(5); // last user message sits at index 5
  });

  test("removes multiple turns with steps > 1", () => {
    const r = computeUndoTurnCut(history, 2);
    expect(r.canUndo).toBe(true);
    expect(r.turnsRemoved).toBe(2);
    expect(r.cutIndex).toBe(3); // second-to-last user message at index 3
  });

  test("leading system message survives (BC-002)", () => {
    const r = computeUndoTurnCut(history, 3);
    expect(r.canUndo).toBe(true);
    expect(r.cutIndex).toBe(1); // never wipes index 0 system message
  });

  test("refuses undo when not enough turns", () => {
    const r = computeUndoTurnCut(history, 10);
    expect(r.canUndo).toBe(false);
    expect(r.turnsRemoved).toBe(0);
  });

  test("refuses undo that would wipe the whole conversation (no system)", () => {
    const noSystem = [msg("user"), msg("assistant")];
    const r = computeUndoTurnCut(noSystem, 1);
    expect(r.canUndo).toBe(false);
  });

  test("empty history → cannot undo", () => {
    const r = computeUndoTurnCut([], 1);
    expect(r.canUndo).toBe(false);
  });

  test("single user message with system → undo keeps only system (index 1)", () => {
    const r = computeUndoTurnCut([msg("system"), msg("user")], 1);
    expect(r.canUndo).toBe(true);
    expect(r.cutIndex).toBe(1);
  });
});

// ── compactMessages ─────────────────────────────────────────────────────────

describe("compactMessages", () => {
  test("keeps last N entries", () => {
    const history = [msg("u1"), msg("a1"), msg("u2"), msg("a2")];
    const r = compactMessages(history, 2);
    expect(r.remaining.map((m) => m.role)).toEqual(["u2", "a2"]);
    expect(r.removed).toBe(2);
  });

  test("always preserves a leading system message", () => {
    const history = [msg("system"), msg("u1"), msg("a1"), msg("u2"), msg("a2")];
    const r = compactMessages(history, 2);
    expect(r.remaining[0]?.role).toBe("system");
    expect(r.remaining.length).toBe(3);
    expect(r.remaining[1]?.role).toBe("u2");
  });

  test("keepLast=0 empties non-system history but keeps system", () => {
    const r = compactMessages([msg("system"), msg("u1")], 0);
    expect(r.remaining).toEqual([{ role: "system" }]);
  });

  test("negative keepLast behaves like 0", () => {
    const r = compactMessages([msg("u1"), msg("a1")], -5);
    expect(r.remaining).toEqual([]);
  });

  test("empty input → nothing removed", () => {
    const r = compactMessages([], 10);
    expect(r.removed).toBe(0);
  });
});

// ── resolveUserResponse ─────────────────────────────────────────────────────

describe("resolveUserResponse", () => {
  test("'yes' maps to 'Approve'", () => {
    expect(resolveUserResponse("yes")).toBe("Approve");
  });

  test("'no' maps to 'Deny'", () => {
    expect(resolveUserResponse("no")).toBe("Deny");
  });

  test("anything else maps to 'Deny' (OMP wrapper deny-by-default)", () => {
    expect(resolveUserResponse("maybe")).toBe("Deny");
    expect(resolveUserResponse("")).toBe("Deny");
  });
});

// ── filterMcpTools ──────────────────────────────────────────────────────────

function mcpTool(server: string | undefined, name: string) {
  return { mcpServerName: server, mcpToolName: name, name };
}

describe("filterMcpTools", () => {
  const tools = [
    mcpTool("server-a", "fetch"),
    mcpTool("server-b", "puppeteer_navigate"),
    mcpTool(undefined, "read"),
  ];

  test("no rules → all tools pass", () => {
    expect(filterMcpTools(tools, {})).toHaveLength(3);
  });

  test("allow list keeps only listed tools of that server (per-server scoping)", () => {
    const r = filterMcpTools(tools, { "server-a": { allow: ["fetch"] } });
    // server-a 的 allow 只约束 server-a；其他 server 与无 server 工具不受影响
    expect(r).toHaveLength(3);
    expect(r.map((t) => t.mcpToolName)).toEqual(["fetch", "puppeteer_navigate", "read"]);
  });

  test("block list removes blocked tools", () => {
    const r = filterMcpTools(tools, { "server-b": { block: ["puppeteer_navigate"] } });
    expect(r).toHaveLength(2);
    expect(r.some((t) => t.mcpToolName === "puppeteer_navigate")).toBe(false);
  });

  test("block wins over allow when both present", () => {
    const r = filterMcpTools(
      tools,
      { "server-a": { allow: ["fetch"], block: ["fetch"] } },
    );
    expect(r.some((t) => t.mcpToolName === "fetch")).toBe(false);
  });

  test("requestedToolNames filters only non-MCP tools (B-014 regression)", () => {
    // 内置工具名列表不得排掉 MCP 工具（历史 bug B-014）
    const r = filterMcpTools(tools, {}, ["read"]);
    expect(r.map((t) => t.mcpToolName)).toEqual(["fetch", "puppeteer_navigate", "read"]);
  });
});

// ── createApprovalUiContext ─────────────────────────────────────────────────

describe("createApprovalUiContext (approval lifecycle)", () => {
  const events: Record<string, unknown>[] = [];
  const approvals = new Map<string, { resolve: (c?: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let uuidCounter = 0;

  function makeCtx(overrides: { timeoutMs?: number } = {}) {
    uuidCounter = 0;
    return createApprovalUiContext("session-1", {
      sendEvent: (_sid, event) => events.push(event),
      pendingApprovals: approvals,
      timeoutMs: overrides.timeoutMs ?? 600_000,
      uuidFn: () => `id-${++uuidCounter}`,
    });
  }

  beforeEach(() => {
    events.length = 0;
    approvals.clear();
  });

  test("emits ask_user event with parsed tool name and risk", async () => {
    const ctx = makeCtx();
    const promise = ctx.select("Allow tool: bash\n\nReason: run tests", [], {});
    const event = events[0] as Record<string, unknown>;
    const payload = event.payload as Record<string, unknown>;
    expect(event.type).toBe("ask_user");
    expect(payload.tool_name).toBe("bash");
    expect(payload.interaction_id).toBe("id-1");
    expect(payload.risk_level).toBe("medium");
    expect(payload.options).toEqual(["Approve", "Deny"]);
    // register a responder so the promise settles
    approvals.get("id-1")!.resolve("Approve");
    await expect(promise).resolves.toBe("Approve");
  });

  test("timeout auto-denies (resolves undefined)", async () => {
    const ctx = makeCtx({ timeoutMs: 5 });
    const promise = ctx.select("Allow tool: bash\n\nReason: cleanup", [], {});
    await expect(promise).resolves.toBeUndefined();
    expect(approvals.size).toBe(0); // cleaned up on timeout
  });

  test("user_response approval resolves with 'Approve'", async () => {
    const ctx = makeCtx();
    const promise = ctx.select("Allow tool: write\n\nReason: edit file", [], {});
    const id = "id-1";
    approvals.get(id)!.resolve("Approve");
    await expect(promise).resolves.toBe("Approve");
    expect(approvals.size).toBe(0); // consumed
  });

  test("timeout after approval does not double-resolve (Map guard)", async () => {
    const ctx = makeCtx({ timeoutMs: 5 });
    const promise = ctx.select("Allow tool: read\n\nReason: inspect", [], {});
    approvals.get("id-1")!.resolve("Approve"); // respond before timeout fires
    await expect(promise).resolves.toBe("Approve");
    // give the timer a chance to fire; guard checks Map membership
    await new Promise((r) => setTimeout(r, 10));
    expect(approvals.size).toBe(0);
  });

  test("reject propagates the error", async () => {
    const ctx = makeCtx();
    const promise = ctx.select("Allow tool: read\n\nReason: inspect", [], {});
    const err = new Error("connection lost");
    approvals.get("id-1")!.reject(err);
    await expect(promise).rejects.toThrow("connection lost");
  });
});

// ── bridgeState container sanity ────────────────────────────────────────────

describe("bridgeState", () => {
  test("exposes resettable maps", () => {
    bridgeState.sessions.set("x", {} as never);
    bridgeState.pendingApprovals.set("y", {} as never);
    expect(bridgeState.sessions.size).toBe(1);
    expect(bridgeState.pendingApprovals.size).toBe(1);
    bridgeState.sessions.clear();
    bridgeState.pendingApprovals.clear();
    expect(bridgeState.sessions.size).toBe(0);
  });
});
