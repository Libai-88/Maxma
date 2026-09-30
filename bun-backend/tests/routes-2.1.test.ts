/**
 * tests/routes-2.1.test.ts — 阶段 2.1 只读批单测。
 *
 * 隔离：MAXMA_DATA_DIR 指向临时目录；直调 createApp()（无端口绑定）。
 * 契约形状对照 Python 版（api/routes/news.py / onboarding.py / metrics.py）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-routes21-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

const AUTH = () => {
  throw new Error("placeholder");
};

describe("阶段 2.1：news", () => {
  test("空文件 → {news: []}；正常条目按日期降序", async () => {
    const app = await makeApp();
    const empty = await app.request("/api/news", { headers: authHeader() });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { news: unknown[] }).news).toEqual([]);

    fs.writeFileSync(
      path.join(dataDir, "api", "data", "news.yaml"),
      [
        "news:",
        '  - id: "a"',
        '    title: "旧条目"',
        '    description: "d1"',
        '    type: "feat"',
        '    date: "2026-01-01"',
        '    tags: ["t1"]',
        '    version: ""',
        '    pr_number: ""',
        '  - id: "b"',
        '    title: "新条目"',
        '    description: "d2"',
        '    type: "fix"',
        '    date: "2026-06-01"',
        '    tags: []',
        '    version: "1.2.0"',
        "    pr_number: 195",
      ].join("\n"),
    );
    const res = await app.request("/api/news", { headers: authHeader() });
    const { news } = (await res.json()) as { news: Array<Record<string, unknown>> };
    expect(news.map((n) => n.id)).toEqual(["b", "a"]);
    expect(news[1]!.pr_number).toBeNull(); // 空字符串 → null（Python field_validator 同语义）
    expect(news[0]!.pr_number).toBe(195);
  });

  test("脏数据容错：单条非法只跳过，不让接口 500", async () => {
    fs.writeFileSync(
      path.join(dataDir, "api", "data", "news.yaml"),
      ["news:", '  - id: "ok"', '    title: "t"', '    description: "d"', '    type: "feat"', '    date: "2026-01-01"', "    tags: []", '    version: ""', "  - title: 缺 id 的条目"].join("\n"),
    );
    const app = await makeApp();
    const { news } = (await (await app.request("/api/news", { headers: authHeader() })).json()) as {
      news: unknown[];
    };
    expect(news.length).toBe(1);
  });
});

describe("阶段 2.1：onboarding", () => {
  test("无记录 → completed=false 新用户；PUT 白名单过滤后落盘", async () => {
    const app = await makeApp();
    const init = await app.request("/api/onboarding/state", { headers: authHeader() });
    expect(init.status).toBe(200);
    expect(((await init.json()) as { completed: boolean }).completed).toBe(false);

    const put = await app.request("/api/onboarding/state", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({
        completed: true,
        preferences: { displayName: "Max", language: "en", workspace: "project", hacker: "x" },
      }),
    });
    const state = (await put.json()) as Record<string, unknown>;
    expect(state.completed).toBe(true);
    const prefs = state.preferences as Record<string, unknown>;
    expect(prefs.displayName).toBe("Max");
    expect(prefs.language).toBe("en");
    expect(prefs.workspace).toBe("project");
    expect("hacker" in prefs).toBe(false);

    // 落盘后 GET 读回
    const got = await app.request("/api/onboarding/state", { headers: authHeader() });
    expect(((await got.json()) as { completed: boolean }).completed).toBe(true);
  });

  test("language/workspace 枚举归一：非法值回默认", async () => {
    const app = await makeApp();
    const put = await app.request("/api/onboarding/state", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({
        completed: false,
        preferences: { language: "fr", workspace: "hack" },
      }),
    });
    const prefs = ((await put.json()) as { preferences: Record<string, unknown> }).preferences;
    expect(prefs.language).toBe("zh-CN");
    expect(prefs.workspace).toBe("personal");
  });
});

describe("阶段 2.1：metrics", () => {
  test("snapshot 形状对齐 Python（http/tools/llm/errors），recordRequest 归一化 :id", async () => {
    const { getMetrics, Metrics } = await import("../src/metrics");
    const m = getMetrics();
    m.reset();

    // 归一化直测
    expect(Metrics.normalizePath("GET", "/api/sessions/550e8400-e29b-41d4-a716-446655440000?x=1")).toBe(
      "GET /api/sessions/:id",
    );
    expect(Metrics.normalizePath("POST", "/api/rules/42")).toBe("POST /api/rules/:id");

    m.recordRequest("GET", "/api/news", 200, 12.345);
    m.recordRequest("GET", "/api/news", 200, 8.1);
    m.recordRequest("POST", "/api/upload", 500, 100);
    m.recordToolCall("read", 5, false);
    m.recordToolCall("bash", 20, true);
    m.recordLlmCall("gpt-4o", 100, 50, 300);
    m.recordError("tool");
    m.recordRateLimit("http");

    const snap = m.getSnapshot();
    expect(snap.http.total_requests).toBe(3);
    expect(snap.http.status_codes).toEqual({ 200: 2, 500: 1 });
    expect(Object.keys(snap.http.top_paths)).toContain("GET /api/news");
    expect(snap.tools.by_tool["bash"]).toMatchObject({ count: 1, errors: 1 });
    expect(snap.llm).toMatchObject({ total_calls: 1, total_tokens_in: 100, total_tokens_out: 50 });
    expect(snap.errors).toEqual({ tool: 1, rate_limit_http: 1 });
  });

  test("persist/get_history：本地 ISO 时间戳 + JSON 列反序列化", async () => {
    const { getMetrics } = await import("../src/metrics");
    const m = getMetrics();
    m.reset();
    m.recordRequest("GET", "/api/news", 200, 10);
    m.persistSnapshot();
    const history = m.getHistory(3600);
    expect(history.length).toBeGreaterThanOrEqual(1);
    const latest = history[history.length - 1]!;
    expect(typeof latest.http).toBe("object");
    // 本地 ISO 无 Z 后缀（与 Python datetime.now().isoformat() 同格式）
    expect(String(latest.timestamp)).not.toContain("Z");
  });

  test("GET /api/metrics 与 /api/metrics/history 路由可用", async () => {
    const app = await makeApp();
    const snap = await app.request("/api/metrics", { headers: authHeader() });
    expect(snap.status).toBe(200);
    const body = (await snap.json()) as { http: { total_requests: number } };
    expect(typeof body.http.total_requests).toBe("number");

    const hist = await app.request("/api/metrics/history?window=60", { headers: authHeader() });
    expect(hist.status).toBe(200);
    const hb = (await hist.json()) as { window_seconds: number; snapshots: unknown[] };
    expect(hb.window_seconds).toBe(60);
    expect(Array.isArray(hb.snapshots)).toBe(true);
  });
});

// ── 助手 ──

/** 从 maxma.db 读出真实 token（与 Python/前端同源），用于通过鉴权中间件。 */
function authHeader(): Record<string, string> {
  // 延迟 import：token 在 createApp() 首次调用时生成落库
  // 这里直接读 db（与 src/auth.ts 同一文件同表）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Database } = require("bun:sqlite") as { Database: new (p: string, o?: object) => { query: (s: string) => { get: () => { token: string } | null } } };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

// AUTH 占位消除（避免未用告警）
void AUTH;
