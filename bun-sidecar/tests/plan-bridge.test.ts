/**
 * plan-bridge 测试：步骤解析、在途审批清理、standing handler 审批闭环
 * （approve/reject/timeout 三路径，用真实临时 artifacts 目录驱动 OMP
 * resolveApprovedPlan 读取 local:// 计划文件）。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installPlanApprovalHandler,
  parsePlanSteps,
  rejectPendingPlansForSession,
  type PlanCapableSession,
} from "../src/plan-bridge";
import type { PendingPlan } from "../src/state";

const tmpDirs: string[] = [];

function makeArtifactsDir(planContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), "maxma-plan-"));
  tmpDirs.push(dir);
  mkdirSync(join(dir, "local"), { recursive: true });
  writeFileSync(join(dir, "local", "PLAN.md"), planContent, "utf8");
  return dir;
}

function makeSession(artifactsDir: string): PlanCapableSession & {
  emitted: unknown[];
  appended: unknown[];
} {
  const state = { enabled: true, planFilePath: "local://PLAN.md" };
  const s = {
    emitted: [] as unknown[],
    appended: [] as unknown[],
    standing: null as ((input: unknown) => Promise<unknown>) | null,
    getPlanModeState: () => state,
    setPlanModeState: (v: unknown) => {
      if (v === undefined) state.enabled = false;
    },
    setStandingResolveHandler: (h: ((input: unknown) => Promise<unknown>) | null) => {
      s.standing = h;
    },
    agent: { appendMessage: (m: unknown) => s.appended.push(m) },
    sessionManager: {
      getArtifactsDir: () => artifactsDir,
      getSessionId: () => "sess-test",
    },
  };
  return s as unknown as PlanCapableSession & {
    emitted: unknown[];
    appended: unknown[];
    standing: ((input: unknown) => Promise<unknown>) | null;
  };
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("parsePlanSteps", () => {
  test("extracts top-level list items", () => {
    const md = "# Plan\n\n- step one\n- step two\n  - nested\n1. numbered\n* star item\n\ntext";
    expect(parsePlanSteps(md)).toEqual(["step one", "step two", "numbered", "star item"]);
  });

  test("caps at 12 steps", () => {
    const md = Array.from({ length: 20 }, (_, i) => `- s${i}`).join("\n");
    expect(parsePlanSteps(md)).toHaveLength(12);
  });
});

describe("rejectPendingPlansForSession", () => {
  test("resolves only matching session entries and clears timers", () => {
    const cleared: unknown[] = [];
    const pending = new Map<string, PendingPlan>();
    let a: unknown, b: unknown;
    pending.set("a", {
      resolve: (d) => (a = d),
      timer: 1 as never,
      sessionId: "s1",
    });
    pending.set("b", {
      resolve: (d) => (b = d),
      timer: 2 as never,
      sessionId: "s2",
    });
    rejectPendingPlansForSession(pending, "s1", (t) => cleared.push(t));
    expect(pending.size).toBe(1);
    expect(a).toEqual({ action: "reject", reason: "session closed" });
    expect(b).toBeUndefined();
    expect(cleared).toEqual([1]);
  });
});

describe("installPlanApprovalHandler", () => {
  function makeDeps(session: ReturnType<typeof makeSession>, pendingPlans: Map<string, PendingPlan>) {
    return {
      sendEvent: (_sid: string, event: Record<string, unknown>) => {
        session.emitted.push(event);
      },
      pendingPlans,
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
      uuidFn: () => "plan-fixed-id",
      timeoutMs: 200,
    };
  }

  test("approve: emits plan_proposed, exits plan mode, injects execution message, emits plan_completed", async () => {
    const dir = makeArtifactsDir("# My Plan\n\n- do A\n- do B\n");
    const session = makeSession(dir);
    const pendingPlans = new Map<string, PendingPlan>();
    installPlanApprovalHandler("sess-1", session, makeDeps(session, pendingPlans));

    const resultPromise = session.standing!({ action: "apply", reason: "ready", extra: { title: "My Plan" } });
    // plan_proposed 已发出、审批条目在途
    await new Promise((r) => setTimeout(r, 0));
    const proposed = session.emitted.find((e) => (e as { type: string }).type === "plan_proposed") as {
      payload: { plan_id: string; steps: string[]; plan_text: string };
    };
    expect(proposed.payload.plan_id).toBe("plan-fixed-id");
    expect(proposed.payload.steps).toEqual(["do A", "do B"]);
    expect(proposed.payload.plan_text).toContain("My Plan");
    expect(pendingPlans.size).toBe(1);

    // 兑现批准
    const pending = pendingPlans.get("plan-fixed-id")!;
    pendingPlans.delete("plan-fixed-id");
    pending.resolve({ action: "approve" });

    const result = (await resultPromise) as { content: Array<{ text: string }>; details: Record<string, unknown> };
    expect(result.content[0].text).toContain("approved");
    // OMP normalizePlanTitle 将 "My Plan" 规范为 slug "My-Plan"
    expect(result.details.title).toBe("My-Plan");
    expect(session.appended[0]).toMatchObject({ role: "user" });
    expect((session.appended[0] as { content: string }).content).toContain("[Plan Approved]");
    expect(session.emitted.some((e) => (e as { type: string }).type === "plan_completed")).toBe(true);
    // 计划态已退出、handler 已卸载
    expect(session.getPlanModeState!()?.enabled).toBe(false);
    expect(session.standing).toBeNull();
  });

  test("reject: stays in plan mode and returns rejection to the agent", async () => {
    const dir = makeArtifactsDir("# P\n\n- x\n");
    const session = makeSession(dir);
    const pendingPlans = new Map<string, PendingPlan>();
    installPlanApprovalHandler("sess-1", session, makeDeps(session, pendingPlans));

    const resultPromise = session.standing!({ action: "apply", reason: "r" });
    await new Promise((r) => setTimeout(r, 0));
    const pending = pendingPlans.get("plan-fixed-id")!;
    pendingPlans.delete("plan-fixed-id");
    pending.resolve({ action: "reject" });

    const result = (await resultPromise) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("rejected");
    expect(session.getPlanModeState!()?.enabled).toBe(true);
    expect(session.emitted.some((e) => (e as { type: string }).type === "plan_completed")).toBe(false);
  });

  test("timeout auto-rejects", async () => {
    const dir = makeArtifactsDir("# P\n\n- x\n");
    const session = makeSession(dir);
    const pendingPlans = new Map<string, PendingPlan>();
    installPlanApprovalHandler("sess-1", session, makeDeps(session, pendingPlans));

    const result = (await session.standing!({ action: "apply", reason: "r" })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("rejected");
    expect(pendingPlans.size).toBe(0);
  });

  test("discard action returns without approval roundtrip", async () => {
    const dir = makeArtifactsDir("# P\n");
    const session = makeSession(dir);
    const pendingPlans = new Map<string, PendingPlan>();
    installPlanApprovalHandler("sess-1", session, makeDeps(session, pendingPlans));
    const result = (await session.standing!({ action: "discard", reason: "cancel" })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("discarded");
    expect(pendingPlans.size).toBe(0);
  });

  test("inactive plan mode returns without approval", async () => {
    const dir = makeArtifactsDir("# P\n");
    const session = makeSession(dir);
    (session as { getPlanModeState: () => { enabled: boolean } }).getPlanModeState = () => ({
      enabled: false,
    });
    const pendingPlans = new Map<string, PendingPlan>();
    installPlanApprovalHandler("sess-1", session, makeDeps(session, pendingPlans));
    const result = (await session.standing!({ action: "apply", reason: "r" })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("not active");
  });
});
