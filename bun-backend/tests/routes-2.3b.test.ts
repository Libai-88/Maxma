/**
 * tests/routes-2.3b.test.ts — activity REST+SSE / chat-turns / chat-artifacts /
 * session-compress 单测（阶段 2.3b）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-r23b-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function authHeader(): Record<string, string> {
  const { Database } = require("bun:sqlite") as {
    Database: new (p: string, o?: object) => { query: (s: string) => { get: () => { token: string } | null } };
  };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

describe("activity REST（阶段 2.3b）", () => {
  test("recent/stats/clear 全链路 + startup 记录存在", async () => {
    const app = await makeApp();
    const h = authHeader();

    const recent = (await (await app.request("/api/activity/recent?limit=50", { headers: h })).json()) as {
      records: Array<{ category: string; event_type: string; timestamp: number }>;
      total: number;
    };
    expect(recent.total).toBe(recent.records.length);
    expect(recent.records.some((r) => r.category === "system" && r.event_type === "startup")).toBe(true);

    const stats = (await (await app.request("/api/activity/stats", { headers: h })).json()) as {
      total: number;
      by_category: Record<string, number>;
      started_at: number;
      uptime_seconds: number;
    };
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.by_category.system).toBeGreaterThanOrEqual(1);
    expect(typeof stats.uptime_seconds).toBe("number");

    const cleared = (await (await app.request("/api/activity", { method: "DELETE", headers: h })).json()) as {
      cleared: number;
    };
    expect(cleared.cleared).toBeGreaterThanOrEqual(1);
    const after = (await (await app.request("/api/activity/recent", { headers: h })).json()) as { total: number };
    expect(after.total).toBe(0);
  }, 15000);

  test("SSE stream：订阅后新事件即时推送（event: activity 帧）", async () => {
    const app = await makeApp();
    const h = authHeader();

    const res = await app.request("/api/activity/stream", { headers: h });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const { record } = await import("../src/activity-hub");
    record("test", "sse_probe", { message: "探针" });

    const { value } = await reader.read();
    const text = decoder.decode(value ?? new Uint8Array());
    expect(text).toContain("event: activity");
    expect(text).toContain("sse_probe");
    await reader.cancel();
  }, 15000);
});

describe("chat-turns / chat-artifacts 纯逻辑（阶段 2.3b）", () => {
  test("newTurnId：合法透传 / 超长回退 uuid / 空回退 uuid", async () => {
    const { newTurnId } = await import("../src/routes/chat-turns");
    expect(newTurnId("abc")).toBe("abc");
    expect(newTurnId("  abc  ")).toBe("abc");
    expect(newTurnId("x".repeat(129))).toMatch(/^[0-9a-f]{32}$/);
    expect(newTurnId("")).toMatch(/^[0-9a-f]{32}$/);
    expect(newTurnId(undefined)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("calculateContextUsage：chars/2 粗估 + percentage 封顶 100", async () => {
    const { calculateContextUsage } = await import("../src/routes/chat-turns");
    const usage = calculateContextUsage(
      [{ content: "a".repeat(100) }, { content: "b".repeat(50) }],
      "sys".repeat(50),
      { maxTokens: 200 },
    );
    // (100 + 50 + 150) / 2 = 150 tokens；150/200 = 75%
    expect(usage.estimated_tokens).toBe(150);
    expect(usage.message_count).toBe(2);
    expect(usage.percentage).toBe(75);
    // 超上限封顶 100
    const capped = calculateContextUsage([{ content: "x".repeat(1000) }], "", { maxTokens: 100 });
    expect(capped.percentage).toBe(100);
  });

  test("extractFilePathFromOutput：JSON content 块 → unix/windows 路径 → 兜底", async () => {
    const { extractFilePathFromOutput } = await import("../src/routes/chat-artifacts");
    const file = path.join(dataDir, "known.txt");
    fs.writeFileSync(file, "x");

    const viaJson = extractFilePathFromOutput(
      JSON.stringify({ content: [{ type: "text", text: `Successfully wrote 1 bytes to ${file}` }] }),
    );
    expect(viaJson).not.toBeNull();
    expect(path.basename(viaJson!)).toBe("known.txt");

    expect(extractFilePathFromOutput("no path here")).toBeNull();
    expect(extractFilePathFromOutput(`plain text ${file} trailing`)).not.toBeNull();
  });

  test("buildArtifactPayload：md5 id / base64 token / 截断 + HTML 转义", async () => {
    const { buildArtifactPayload } = await import("../src/routes/chat-artifacts");
    const file = path.join(dataDir, "art.html");
    fs.writeFileSync(file, "<div>" + "x".repeat(2500) + "</div>");
    const p = buildArtifactPayload(file)!;
    expect(p.version).toBe(1);
    expect(String(p.id)).toMatch(/^[0-9a-f]{32}$/);
    expect(p.title).toBe("art.html");
    const body = String(p.body);
    expect(body).not.toContain("<div>");
    expect(body).toContain("&lt;div&gt;");
    expect(body).toContain("内容已截断");
    const token = String((p.actions as Array<Record<string, unknown>>)[0].token);
    expect(Buffer.from(token, "base64").toString("utf8")).toBe(file);
    expect(buildArtifactPayload(path.join(dataDir, "ghost.txt"))).toBeNull();
  });
});

describe("session-compress REST（阶段 2.3b）", () => {
  test("compress/fresh-compact：未知会话 404；kernel compact 结果透传", async () => {
    const { createSessionCompressRoutes } = await import("../src/routes/session-compress");
    const sessions = new Map<string, any>();
    const calls: Array<Record<string, unknown>> = [];
    const app = createSessionCompressRoutes({
      sessions,
      callRpc: async (method, params) => {
        calls.push({ method, params });
        return { ok: true as const, result: { compressed: true, removed_count: 3, detail: "压缩完成" } };
      },
    });

    const missing = await app.request("/api/sessions/ghost/compress", { method: "POST" });
    expect(missing.status).toBe(404);

    sessions.set("s1", {});
    const ok = await app.request("/api/sessions/s1/compress", { method: "POST" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ compressed: true, method: "sidecar", removed_count: 3, detail: "压缩完成" });

    const fresh = await app.request("/api/sessions/s1/fresh-compact", { method: "POST" });
    expect(fresh.status).toBe(200);

    // compact 失败 → degraded 形状（Python JsonRpcError 分支同构）
    const failApp = createSessionCompressRoutes({
      sessions,
      callRpc: async () => ({ ok: false as const, error: "method not migrated" }),
    });
    const degraded = await failApp.request("/api/sessions/s1/compress", { method: "POST" });
    expect(degraded.status).toBe(200);
    const body = (await degraded.json()) as { compressed: boolean; method: string };
    expect(body.compressed).toBe(false);
    expect(body.method).toBe("degraded");
  }, 15000);
});
