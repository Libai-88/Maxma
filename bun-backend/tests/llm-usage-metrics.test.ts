import { describe, expect, test } from "bun:test";
import { Metrics } from "../src/metrics";

describe("LLM request metrics", () => {
  test("separates cache warming from conversational cache rate and preserves unknowns", () => {
    const metrics = new Metrics();
    metrics.recordLlmUsageRequest("gpt-test", { input: 100, output: 20, cacheRead: 40, cacheWrite: 0 }, 300, {
      kind: "model_request",
      cacheStatus: "catalog",
    });
    metrics.recordLlmUsageRequest("gpt-test", { input: 0, output: 0, cacheRead: 80, cacheWrite: 0 }, null, {
      kind: "cache_warm",
      cacheStatus: "catalog",
    });
    const fullyObserved = metrics.getSnapshot().llm;
    expect(fullyObserved.total_calls).toBe(1);
    expect(fullyObserved.cache_warm_calls).toBe(1);
    expect(fullyObserved.cache_read_tokens).toBe(120);
    expect(fullyObserved.cache_hit_rate).toBeCloseTo(40 / 140);

    metrics.recordLlmUsageRequest("free-test", null, null);
    const withUnknown = metrics.getSnapshot().llm;
    expect(withUnknown.missing_usage_calls).toBe(1);
    expect(withUnknown.cache_unobserved_calls).toBe(1);
    expect(withUnknown.cache_hit_rate).toBeNull();
  });
});
