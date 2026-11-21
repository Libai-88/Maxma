/**
 * tests/task-graph.test.ts — A2 任务图的纯状态机回归。
 *
 * 重点不是"能排序"，而是三件会伤人的事：
 *   1. 依赖没成功前不许开跑（防止 B 读到 A 没写完的文件）；
 *   2. 一个任务失败只阻塞它的下游，独立任务继续（失败不拖垮整批）；
 *   3. 重试真的回到 pending 再跑，而不是只把错误藏起来。
 */

import { describe, expect, test } from "bun:test";

import { TaskGraphError, buildTaskGraph } from "../src/kernel/task-graph";

describe("任务图：依赖与调度", () => {
  test("依赖未成功前不 ready；成功后下游才 ready", () => {
    const graph = buildTaskGraph([
      { id: "a", prompt: "A" },
      { id: "b", prompt: "B", dependsOn: ["a"] },
      { id: "c", prompt: "C" },
    ]);

    expect(graph.ready(2).map((n) => n.id)).toEqual(["a", "c"]);
    graph.start("a");
    expect(graph.ready(2).map((n) => n.id)).toEqual(["c"]);
    graph.succeed("a");
    expect(graph.ready(2).map((n) => n.id)).toEqual(["b", "c"]);
    expect(graph.counts()).toEqual({ pending: 2, running: 0, succeeded: 1, failed: 0, blocked: 0, cancelled: 0 });
  });

  test("失败只阻塞下游，独立任务不受影响", () => {
    const graph = buildTaskGraph([
      { id: "a", prompt: "A" },
      { id: "b", prompt: "B", dependsOn: ["a"] },
      { id: "c", prompt: "C", dependsOn: ["b"] },
      { id: "d", prompt: "D" },
    ]);
    graph.start("a");
    const state = graph.fail("a", "boom");

    expect(state).toBe("failed");
    expect(graph.node("b")!.status).toBe("blocked");
    expect(graph.node("b")!.blockedBy).toBe("a");
    expect(graph.node("c")!.status).toBe("blocked");
    expect(graph.node("c")!.blockedBy).toBe("b");
    expect(graph.node("d")!.status).toBe("pending");
    expect(graph.ready(1).map((n) => n.id)).toEqual(["d"]);
  });

  test("retries 是额外尝试次数：失败先回 pending，额度用完才 failed", () => {
    const graph = buildTaskGraph([{ id: "a", prompt: "A", retries: 2 }]);
    graph.start("a");
    expect(graph.fail("a", "first")).toBe("pending");
    expect(graph.ready(1).map((n) => n.id)).toEqual(["a"]);
    graph.start("a");
    expect(graph.fail("a", "second")).toBe("pending");
    graph.start("a");
    expect(graph.fail("a", "third")).toBe("failed");
    expect(graph.node("a")!.attempts).toBe(3);
  });

  test("取消后 pending 全部 cancelled，ready 为空，isDone 为真", () => {
    const graph = buildTaskGraph([
      { id: "a", prompt: "A" },
      { id: "b", prompt: "B", dependsOn: ["a"] },
    ]);
    graph.cancelAll("parent abort");
    expect(graph.ready(2)).toEqual([]);
    expect(graph.counts().cancelled).toBe(2);
    expect(graph.isDone()).toBe(true);
  });
});

describe("任务图：非法输入整批拒绝", () => {
  test("重复 id", () => {
    expect(() => buildTaskGraph([{ id: "x", prompt: "1" }, { id: "x", prompt: "2" }]))
      .toThrow(TaskGraphError);
  });

  test("未知依赖", () => {
    expect(() => buildTaskGraph([{ id: "a", prompt: "A", dependsOn: ["missing"] }]))
      .toThrow(/不存在的任务/);
  });

  test("环", () => {
    expect(() => buildTaskGraph([
      { id: "a", prompt: "A", dependsOn: ["b"] },
      { id: "b", prompt: "B", dependsOn: ["a"] },
    ])).toThrow(/环/);
  });

  test("超过 16 个任务", () => {
    expect(() => buildTaskGraph(Array.from({ length: 17 }).map((_, i) => ({ prompt: `T${i}` }))))
      .toThrow(/上限/);
  });
});
