/**
 * tests/event-tool-timing.test.ts — tool_execution_start/end 的耗时测算与**容量上限**。
 *
 * 为什么单独测这一条：
 * `kernel/events.ts` 的 toolStartTimestamps 是模块级 Map，只在 end 时删除。
 * 若上游丢了 end（工具崩溃、会话中断），条目会永久滞留；侧车进程长驻并连续
 * 服务多个会话，这就是一个只增不减的跨会话增长点。这里用可控时钟把
 * "配对仍然精确" 与 "超限后淘汰最早一条" 两件事分开断言——两条断言在
 * 旧实现（无上限）下会得到相反结果，因此能区分修复前后。
 */

import { describe, expect, test } from "bun:test";
import { mapPiAgentEventToMaxma } from "../src/kernel/events";

/** 取 tool_end / tool_error 事件里的 elapsed 秒数。 */
function elapsedOf(ev: unknown): number {
  const mapped = mapPiAgentEventToMaxma(ev) as { type: string; payload: Record<string, unknown> } | null;
  expect(mapped).not.toBeNull();
  expect(typeof mapped!.payload.elapsed).toBe("number");
  return mapped!.payload.elapsed as number;
}

/** 在可控时钟下执行，结束后一定还原 Date.now。 */
function withClock<T>(clockMs: number, fn: () => T): T {
  const realNow = Date.now;
  Date.now = () => clockMs;
  try {
    return fn();
  } finally {
    Date.now = realNow;
  }
}

function start(id: string) {
  return { type: "tool_execution_start", toolCallId: id, toolName: "bash", args: {} };
}

function end(id: string, isError = false) {
  return { type: "tool_execution_end", toolCallId: id, toolName: "bash", isError, result: {} };
}

describe("tool 耗时测算", () => {
  test("正常配对：start 与 end 之间的秒数被正确计算", () => {
    withClock(1000, () => {
      mapPiAgentEventToMaxma(start("tm-pair"));
    });
    const elapsed = withClock(6000, () => elapsedOf(end("tm-pair")));
    expect(elapsed).toBe(5);
  });

  test("end 之后条目被删除：同一 id 再来一次 end 不会沿用旧起点", () => {
    withClock(1000, () => {
      mapPiAgentEventToMaxma(start("tm-cleanup"));
    });
    expect(withClock(9000, () => elapsedOf(end("tm-cleanup")))).toBe(8);
    // 第二次 end 没有对应 start，只能是 0（若旧起点还在，这里会是 8）
    expect(withClock(9000, () => elapsedOf(end("tm-cleanup")))).toBe(0);
  });

  test("容量上限：超过上限后最早插入的起点被淘汰，最近的仍精确", () => {
    const LIMIT = 512;
    withClock(1000, () => {
      mapPiAgentEventToMaxma(start("tm-first"));
      for (let i = 0; i < LIMIT + 88; i++) mapPiAgentEventToMaxma(start(`tm-flood-${i}`));
    });
    const firstElapsed = withClock(6000, () => elapsedOf(end("tm-first")));
    // 旧实现（无上限）这里会是 5；有上限时最早的条目已被淘汰 → 0
    expect(firstElapsed).toBe(0);

    // 最近插入的那条仍在，说明淘汰的是"最早"而不是"全部"
    const lastId = `tm-flood-${LIMIT + 87}`;
    expect(withClock(6000, () => elapsedOf(end(lastId)))).toBe(5);
  });

  test("isError 的 end 同样清理条目", () => {
    withClock(1000, () => {
      mapPiAgentEventToMaxma(start("tm-err"));
    });
    const mapped = withClock(4000, () => mapPiAgentEventToMaxma(end("tm-err", true)) as any);
    expect(mapped.type).toBe("tool_error");
    expect(mapped.payload.elapsed).toBe(3);
    expect(withClock(4000, () => elapsedOf(end("tm-err")))).toBe(0);
  });

  test("没有 toolCallId 的事件不参与耗时测算，elapsed 恒为 0", () => {
    const mapped = mapPiAgentEventToMaxma({
      type: "tool_execution_end",
      toolName: "bash",
      isError: false,
      result: {},
    }) as any;
    expect(mapped.payload.elapsed).toBe(0);
    expect(mapped.payload.tool_call_id).toBeUndefined();
  });
});
