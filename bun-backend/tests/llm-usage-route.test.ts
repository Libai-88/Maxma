import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-llm-usage-route-"));
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("LLM usage metrics route", () => {
  test("filters by provider and model and bounds queries to the retention window", async () => {
    const { createMetricsRoutes } = await import("../src/routes/metrics-route");
    const { recordLlmUsageCall } = await import("../src/llm-usage-ledger");
    const app = createMetricsRoutes();
    recordLlmUsageCall({
      sessionId: "route-session",
      turnId: "turn-1",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "openai",
      model: "gpt-test",
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 } },
      priceStatus: "catalog_estimate",
      cacheStatus: "catalog",
    });
    recordLlmUsageCall({
      sessionId: "route-session",
      turnId: "turn-1",
      kind: "model_request",
      usageSource: "pi_message_end",
      provider: "custom-free",
      model: "free-test",
      usage: null,
      priceStatus: "unknown",
    });

    const response = await app.request("/api/metrics/llm-usage?window=86400&provider=openai&model=gpt-test");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.calls).toBe(1);
    expect(body.cache_hit_rate).toBeCloseTo(30 / 130);
    expect(body.cost_total).toBe(0.0031);
    expect(body.recent_calls).toHaveLength(1);
    expect(body.recent_calls[0].session_id).toBe("route-session");

    const capped = await app.request("/api/metrics/llm-usage?window=999999999");
    expect((await capped.json() as { window_seconds: number }).window_seconds).toBe(90 * 86_400);
    expect((await app.request("/api/metrics/llm-usage?from=not-a-date")).status).toBe(400);
  });
});
