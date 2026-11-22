/**
 * cowork_update_steps：只上报步骤，不写文件、不改任务表。
 *
 * 这条工具是 Cowork 任务进度的事实来源之一；如果它把非法项静默放过，
 * UI 会看到“完成了不存在的一步”，所以负例也必须锁住。
 */

import { describe, expect, test } from "bun:test";

import { coworkUpdateStepsTool } from "../src/tools/cowork";

interface SentEvent {
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
}

function toolWithEvents(): { tool: ReturnType<typeof coworkUpdateStepsTool>; events: SentEvent[] } {
  const events: SentEvent[] = [];
  const tool = coworkUpdateStepsTool({
    sessionId: "session-1",
    sendEvent: (sessionId, event) => events.push({ sessionId, ...event }),
  });
  return { tool, events };
}

describe("cowork_update_steps", () => {
  test("合法步骤只发一次事件，按 seq 保留状态与截断字段", async () => {
    const { tool, events } = toolWithEvents();
    const result = await tool.execute("call-1", {
      steps: [
        { seq: 2, label: "  写初稿  ", status: "running", detail: "正在整理" },
        { seq: 1, label: "收集资料", status: "completed", detail: "x".repeat(1200) },
      ],
    });
    expect(result.details).toMatchObject({ ok: true });
    expect(events.length).toBe(1);
    expect(events[0]!.sessionId).toBe("session-1");
    expect(events[0]!.type).toBe("cowork.steps.updated");
    const payloadSteps = events[0]!.payload.steps as Array<Record<string, unknown>>;
    expect(payloadSteps.map((step) => step.seq)).toEqual([2, 1]);
    expect(payloadSteps[0]!.label).toBe("写初稿");
    expect((payloadSteps[1]!.detail as string).length).toBe(1000);
  });

  test("空数组、超过 20 项、全部非法都不发事件", async () => {
    const { tool, events } = toolWithEvents();
    const empty = await tool.execute("call-1", { steps: [] });
    expect(empty.details).toMatchObject({ ok: false });
    expect(events.length).toBe(0);

    const tooMany = await tool.execute("call-2", {
      steps: Array.from({ length: 21 }, (_, index) => ({
        seq: index + 1,
        label: `步骤 ${index + 1}`,
        status: "pending",
      })),
    });
    expect(tooMany.details).toMatchObject({ ok: false });
    expect(events.length).toBe(0);

    const invalid = await tool.execute("call-3", {
      steps: [
        { seq: 0, label: "零", status: "pending" },
        { seq: 1, label: "", status: "pending" },
        { seq: 2, label: "未知状态", status: "doing" },
      ],
    });
    expect(invalid.details).toMatchObject({ ok: false });
    expect(events.length).toBe(0);
  });

  test("混合输入只上报合法项；工具本身是只读审批", async () => {
    const { tool, events } = toolWithEvents();
    expect(tool.approval).toBe("read");
    const result = await tool.execute("call-4", {
      steps: [
        { seq: 1, label: "合法", status: "completed" },
        { seq: -1, label: "非法 seq", status: "pending" },
        { seq: 2, label: "合法但跳状态", status: "skipped", detail: "不需要" },
      ],
    });
    expect(result.details).toMatchObject({ ok: true });
    expect(events.length).toBe(1);
    const payloadSteps = events[0]!.payload.steps as Array<Record<string, unknown>>;
    expect(payloadSteps.map((step) => step.seq)).toEqual([1, 2]);
    expect(payloadSteps.map((step) => step.status)).toEqual(["completed", "skipped"]);
  });
});
