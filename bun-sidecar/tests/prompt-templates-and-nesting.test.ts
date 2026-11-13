/**
 * tests/prompt-templates-and-nesting.test.ts — PROMPT-TPL-001 与 NEST-001。
 *
 * ## 两件事
 *
 * 1. **Prompt templates**：pi 的 ResourceLoader 本来就会扫 `~/.pi/agent/prompts/*.md`
 *    与 `.pi/prompts/`，`session.promptTemplates` 直接可读。此前 Maxma 既没暴露清单、
 *    前端斜杠补全也只认 10 条硬编码命令——用户放进去的模板等于不存在。
 *
 * 2. **嵌套工具调用**：pi 的工具可以经 `ctx.executeTool()` 发起子调用，事件带
 *    `parentToolCallId`。此前 Maxma 的事件映射只透传 `toolCallId`，子调用在前端
 *    与顶层调用并排显示——一次 codemode 调用会炸出十几条看不出关系的工具行。
 *
 * 这两项都是"引擎早就提供了、我们没接"，锁的是**接线**而不是引擎行为。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { createMaxmaSession } from "../src/kernel/pi-session";
import { mapPiAgentEventToMaxma } from "../src/kernel/events";

describe("prompt templates（PROMPT-TPL-001）", () => {
  test("放进 prompts/ 的模板会被发现，且带 name/description", async () => {
    const dir = getAgentDir();
    const promptsDir = path.join(dir, "prompts");
    const existed = fs.existsSync(promptsDir);
    fs.mkdirSync(promptsDir, { recursive: true });
    const file = path.join(promptsDir, "probe-tpl-test.md");
    fs.writeFileSync(file, "---\ndescription: 测试模板\n---\n请总结：${1:-全部}\n");

    try {
      const session = await createMaxmaSession({ inMemory: true, cwd: process.cwd(), tools: [] });
      try {
        const tpl = session.promptTemplates.find((t) => t.name === "probe-tpl-test");
        expect(tpl, "pi 没有发现刚放进去的模板").toBeDefined();
        expect(tpl!.description).toBe("测试模板");
        // 模板正文含参数占位符——前端只需展示 name/description，展开由引擎做。
        expect(tpl!.content).toContain("${1:-全部}");
      } finally {
        session.dispose();
      }
    } finally {
      fs.rmSync(file, { force: true });
      if (!existed) {
        try { fs.rmdirSync(promptsDir); } catch { /* 目录非空或不存在，忽略 */ }
      }
    }
  });

  test("模板名不含路径分隔符（前端把它当斜杠命令名用）", async () => {
    const session = await createMaxmaSession({ inMemory: true, cwd: process.cwd(), tools: [] });
    try {
      for (const t of session.promptTemplates) {
        expect(t.name).not.toContain("/");
        expect(t.name).not.toContain("\\");
        expect(t.name.length).toBeGreaterThan(0);
      }
    } finally {
      session.dispose();
    }
  });
});

describe("会话状态（STATE-001）", () => {
  test("会话暴露路由后的实际模型与思考档位", async () => {
    const session = await createMaxmaSession({ inMemory: true, cwd: process.cwd(), tools: [] });
    try {
      // 未选虚拟模型时 routedModel 为 undefined —— 这正是界面不显示箭头的原因。
      expect(session.routedModel).toBeUndefined();
      // 但 model / thinkingLevel / isIdle 必须有值，STATE-001 端点依赖它们。
      expect(session.model).toBeDefined();
      expect(typeof session.thinkingLevel).toBe("string");
      expect(typeof session.isIdle).toBe("boolean");
      expect(typeof session.isStreaming).toBe("boolean");
    } finally {
      session.dispose();
    }
  });
});

describe("嵌套工具调用（NEST-001）", () => {
  /** 构造一条引擎形状的 tool_execution_start 事件。 */
  const startEvent = (toolCallId: string, parentToolCallId?: string) => ({
    type: "tool_execution_start",
    toolCallId,
    toolName: "bash",
    args: { command: "ls" },
    ...(parentToolCallId ? { parentToolCallId } : {}),
  });

  test("顶层调用不带 parent_tool_call_id", () => {
    const mapped = mapPiAgentEventToMaxma(startEvent("call-a") as never);
    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe("tool_start");
    expect((mapped!.payload as Record<string, unknown>).tool_call_id).toBe("call-a");
    expect((mapped!.payload as Record<string, unknown>).parent_tool_call_id).toBeUndefined();
  });

  test("子调用透传 parent_tool_call_id（前端据此缩进）", () => {
    const mapped = mapPiAgentEventToMaxma(startEvent("call-a/1", "call-a") as never);
    expect(mapped).not.toBeNull();
    const payload = mapped!.payload as Record<string, unknown>;
    expect(payload.tool_call_id).toBe("call-a/1");
    expect(payload.parent_tool_call_id).toBe("call-a");
  });

  test("tool_execution_end / error 也透传父 id（否则结束时归不到同一个节点）", () => {
    const end = mapPiAgentEventToMaxma({
      type: "tool_execution_end",
      toolCallId: "call-a/1",
      toolName: "bash",
      result: { ok: true },
      isError: false,
      parentToolCallId: "call-a",
    } as never);
    expect((end!.payload as Record<string, unknown>).parent_tool_call_id).toBe("call-a");

    const err = mapPiAgentEventToMaxma({
      type: "tool_execution_end",
      toolCallId: "call-a/2",
      toolName: "bash",
      result: { message: "boom" },
      isError: true,
      parentToolCallId: "call-a",
    } as never);
    expect(err!.type).toBe("tool_error");
    expect((err!.payload as Record<string, unknown>).parent_tool_call_id).toBe("call-a");
  });
});

describe("队列可见性（QUEUE-001）", () => {
  test("queue_update 映射成前端可渲染的字符串数组快照", () => {
    const mapped = mapPiAgentEventToMaxma({
      type: "queue_update",
      steering: ["先看 A", "再看 B"],
      followUp: ["最后总结"],
    } as never);
    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe("queue_update");
    const payload = mapped!.payload as { steering: string[]; follow_up: string[] };
    expect(payload.steering).toEqual(["先看 A", "再看 B"]);
    expect(payload.follow_up).toEqual(["最后总结"]);
  });

  test("对象形态的消息也能取出文本；空队列给空数组", () => {
    const mapped = mapPiAgentEventToMaxma({
      type: "queue_update",
      steering: [{ text: "对象形态" }],
      followUp: [],
    } as never);
    const payload = mapped!.payload as { steering: string[]; follow_up: string[] };
    expect(payload.steering).toEqual(["对象形态"]);
    expect(payload.follow_up).toEqual([]);

    const empty = mapPiAgentEventToMaxma({ type: "queue_update" } as never);
    expect((empty!.payload as { steering: string[] }).steering).toEqual([]);
  });
});
