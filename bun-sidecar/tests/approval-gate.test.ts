/**
 * tests/approval-gate.test.ts — 审批门的在途放行语义。
 *
 * 覆盖两件事：
 *   1. `needsApprovalForMode` 四档判定（readOnlyHint / 执行类）；
 *   2. `approveAllPending()`：切到自动执行时必须把在途审批全部放行——
 *      否则用户看到「已切自动执行，却还卡着一张批准卡」（实测复现）。
 */
import { describe, expect, test } from "bun:test";

import {
  createMaxmaApprovalGate,
  needsApprovalForMode,
  permissionDecisionForMode,
} from "../src/kernel/approval-gate";
import type { MaxmaPermissionMode } from "../src/kernel/types";

describe("permissionDecisionForMode", () => {
  test("四档 × 读写执行矩阵", () => {
    const readOnly = { readOnlyHint: true };
    const write = { readOnlyHint: false };
    const destructive = { destructiveHint: true };

    expect(permissionDecisionForMode("auto", "bash", destructive)).toBe("allow");
    expect(permissionDecisionForMode("read_only", "read", readOnly)).toBe("allow");
    expect(permissionDecisionForMode("read_only", "bash", destructive)).toBe("deny");
    expect(permissionDecisionForMode("read_only", "write", write)).toBe("deny");
    expect(permissionDecisionForMode("ask", "read", readOnly)).toBe("allow");
    expect(permissionDecisionForMode("ask", "write", write)).toBe("ask");
    expect(permissionDecisionForMode("ask", "bash", destructive)).toBe("ask");
    expect(permissionDecisionForMode("operate", "read", readOnly)).toBe("allow");
    expect(permissionDecisionForMode("operate", "write", write)).toBe("allow");
    expect(permissionDecisionForMode("operate", "bash", undefined)).toBe("ask");
    expect(permissionDecisionForMode("operate", "deploy", destructive)).toBe("ask");
    // 未知档位 fail-closed，不允许落入 allow。
    expect(permissionDecisionForMode("god_mode" as MaxmaPermissionMode, "read", readOnly)).toBe("deny");
  });

  test("needsApproval 只是三值矩阵的 ask 投影", () => {
    const readOnly = { readOnlyHint: true };
    const destructive = { destructiveHint: true };
    expect(needsApprovalForMode("read_only", "read", readOnly)).toBe(false);
    expect(needsApprovalForMode("read_only", "bash", destructive)).toBe(false); // deny，不是 ask
    expect(needsApprovalForMode("ask", "write", undefined)).toBe(true);
    expect(needsApprovalForMode("operate", "write", undefined)).toBe(false);
    expect(needsApprovalForMode("operate", "bash", undefined)).toBe(true);
  });
});

describe("审批门在途请求", () => {
  function makeGate(mode: MaxmaPermissionMode = "ask") {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    let current: MaxmaPermissionMode = mode;
    const gate = createMaxmaApprovalGate({
      emit: (event) => { emitted.push(event as { type: string; payload: Record<string, unknown> }) },
      mode: () => current,
      timeoutMs: 60_000,
    });
    return { gate, emitted, setMode: (m: MaxmaPermissionMode) => { current = m } };
  }

  test("read_only 的写入直接 deny，不发 ask_user、不产生在途审批", () => {
    const { gate, emitted } = makeGate("read_only");
    const decision = gate.decision!({
      toolName: "write",
      input: { file_path: "a.txt" },
      annotations: { readOnlyHint: false },
    });
    expect(decision).toBe("deny");
    expect(gate.needsApproval({ toolName: "write", annotations: { readOnlyHint: false } })).toBe(false);
    expect(gate.pendingCount()).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  test("decide 发出 ask_user 并等待；approveAllPending 全部放行", async () => {
    const { gate, emitted } = makeGate();
    const p1 = gate.decide({ toolName: "bash", toolCallId: "c1", input: { command: "pwd" } });
    const p2 = gate.decide({ toolName: "bash", toolCallId: "c2", input: { command: "ls" } });
    expect(gate.pendingCount()).toBe(2);
    expect(emitted.map((e) => e.payload.tool_call_id)).toEqual(["c1", "c2"]);

    const released = gate.approveAllPending();
    expect(released).toBe(2);
    expect(gate.pendingCount()).toBe(0);
    expect(await p1).toEqual({ approved: true });
    expect(await p2).toEqual({ approved: true });
    // 放行后再来的 decide 照常排队（不是永久短路）
    const p3 = gate.decide({ toolName: "bash", toolCallId: "c3", input: { command: "whoami" } });
    expect(gate.pendingCount()).toBe(1);
    expect(gate.resolveUserApproval(emitted.at(-1)!.payload.interaction_id as string, "no")).toBe(true);
    expect(await p3).toEqual({ approved: false, reason: "denied by user" });
  });

  test("rejectAll 拒绝全部在途请求", async () => {
    const { gate } = makeGate();
    const p = gate.decide({ toolName: "write", toolCallId: "c9", input: {} });
    expect(gate.rejectAll("session destroyed")).toBeUndefined();
    expect(await p).toEqual({ approved: false, reason: "session destroyed" });
    expect(gate.pendingCount()).toBe(0);
  });
});