import { describe, expect, test } from "bun:test";
import { mapPiAgentEventToMaxma } from "../src/kernel/events";

describe("Pi usage event mapping", () => {
  test("preserves each assistant completion usage and measured request duration", () => {
    expect(mapPiAgentEventToMaxma({
      type: "message_end",
      message: {
        provider: "openai",
        model: "gpt-test",
        content: [{ type: "text", text: "done" }],
        usage: { input: 40, output: 8, cacheRead: 12, cacheWrite: 0 },
      },
    }, null, 321)).toEqual({
      type: "answer",
      payload: {
        content: "done",
        usage: { input: 40, output: 8, cacheRead: 12, cacheWrite: 0 },
        provider: "openai",
        model: "gpt-test",
        request_duration_ms: 321,
      },
    });
  });

  test("keeps missing usage explicit and maps Pi cache warming separately", () => {
    expect(mapPiAgentEventToMaxma({ type: "message_end", message: { content: [] } })?.payload.usage).toBeNull();
    expect(mapPiAgentEventToMaxma({
      type: "entry_appended",
      entry: {
        id: "warm-1",
        type: "usage",
        kind: "cache_warm",
        provider: "anthropic",
        model: "claude-test",
        timestamp: "2026-10-02T10:00:00.000Z",
        usage: { input: 0, output: 0, cacheRead: 12_000, cacheWrite: 0 },
      },
    })).toMatchObject({
      type: "llm_usage",
      payload: {
        kind: "cache_warm",
        usage_source: "pi_usage_entry",
        usage_entry_id: "warm-1",
        provider: "anthropic",
        model: "claude-test",
      },
    });
  });
});
