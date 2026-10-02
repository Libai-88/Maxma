import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-usage-ledger-"));
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("LLM usage ledger", () => {
  test("stores each provider call and leaves unavailable usage and cost unknown", async () => {
    const ledger = await import("../src/llm-usage-ledger");
    const first = ledger.recordLlmUsageCall({
      sessionId: "session-a",
      turnId: "turn-a",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "openai",
      model: "gpt-test",
      usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 0, cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 } },
      priceStatus: "catalog_estimate",
      cacheStatus: "catalog",
      durationMs: 840,
    });
    const missing = ledger.recordLlmUsageCall({
      sessionId: "session-a",
      turnId: "turn-a",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "custom-free",
      model: "free-model",
      usage: null,
      priceStatus: "unknown",
    });
    ledger.recordLlmUsageCall({
      sessionId: "session-a",
      turnId: "turn-a",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "other-provider",
      model: "gpt-test",
      usage: { output: 3, cacheRead: 20, cacheWrite: 0 },
      priceStatus: "unknown",
    });

    const rows = ledger.getRecentLlmUsageCalls({ windowSeconds: 86_400 });
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      input_tokens: 100,
      cache_read_tokens: 40,
      usage_status: "reported",
      cache_observation_status: "catalog",
      cost_status: "catalog_estimate",
      cost_total: 0.0031,
    });
    expect(rows.find((row) => row.id === missing.id)).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      usage_status: "missing",
      cost_total: null,
      cost_status: "unknown",
    });

    const summary = ledger.getLlmUsageSummary({ windowSeconds: 86_400 });
    expect(summary).toMatchObject({
      calls: 3,
      reported_usage_calls: 1,
      partial_usage_calls: 1,
      missing_usage_calls: 1,
      cost_known_calls: 1,
      cost_unknown_calls: 2,
    });
    expect(summary.cache_hit_rate).toBeNull();
    expect(summary.by_provider["openai"]?.calls).toBe(1);
    expect(summary.by_provider["custom-free"]?.calls).toBe(1);
    expect(summary.by_model["openai/gpt-test"]?.calls).toBe(1);
    expect(summary.by_model["other-provider/gpt-test"]?.calls).toBe(1);
  });

  test("aggregates a fully observed cache rate and supports cache-warm records outside a turn", async () => {
    const ledger = await import("../src/llm-usage-ledger");
    ledger.recordLlmUsageCall({
      sessionId: "session-b",
      turnId: "turn-b",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "anthropic",
      model: "claude-test",
      usage: { input: 80, output: 10, cacheRead: 20, cacheWrite: 0 },
      priceStatus: "unknown",
    });
    ledger.recordLlmUsageCall({
      sessionId: "session-b",
      turnId: null,
      kind: "cache_warm",
      usageSource: "pi_usage_entry",
      provider: "anthropic",
      model: "claude-test",
      usage: { input: 0, output: 0, cacheRead: 80, cacheWrite: 0 },
      priceStatus: "catalog_estimate",
      cacheStatus: "catalog",
    });

    const summary = ledger.getLlmUsageSummary({ windowSeconds: 86_400 });
    expect(summary.calls).toBe(2);
    expect(summary.cache_hit_rate).toBeCloseTo(20 / 100);
    expect(summary.cache_warm_calls).toBe(1);
    expect(summary.daily).toHaveLength(1);
  });

  test("purges records older than the 90-day retention window", async () => {
    const ledger = await import("../src/llm-usage-ledger");
    ledger.recordLlmUsageCall({
      sessionId: "session-c",
      turnId: "turn-c",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "openai",
      model: "gpt-test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      priceStatus: "unknown",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    ledger.recordLlmUsageCall({
      sessionId: "session-c",
      turnId: "turn-c",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "openai",
      model: "gpt-test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      priceStatus: "unknown",
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(ledger.pruneExpiredLlmUsage(new Date("2026-10-02T00:00:00.000Z"))).toBe(1);
    expect(ledger.getRecentLlmUsageCalls({ windowSeconds: 90 * 86_400 })).toHaveLength(1);
  });
});
