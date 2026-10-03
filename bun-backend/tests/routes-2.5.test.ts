/**
 * tests/routes-2.5.test.ts — 长尾路由 + 诊断 + 健康完整版 + capabilities +
 * CORS 单测（阶段 2.5）。
 *
 * 隔离：MAXMA_DATA_DIR 指向临时目录；restart 端点只验证注册（调用会
 * 触发 process.exit，不能真实请求）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-r25-"));
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

// ── 2.5a：tools / plugins 桩 / files 桩 / upload ──

describe("tools / plugins / files（阶段 2.5a）", () => {
  test("GET /api/tools → 裸数组（14 项，含 Pi 与 Maxma 工具）", async () => {
    const app = await makeApp();
    const res = await app.request("/api/tools", { headers: authHeader() });
    expect(res.status).toBe(200);
    const tools = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(14);
    expect(tools.some((t) => t.name === "remember_memory" && t.source === "custom")).toBe(true);
    expect(tools.some((t) => t.name === "submit_plan" && t.source === "custom")).toBe(true);
    expect(tools.some((t) => t.name === "web_search")).toBe(false);
    expect(tools.some((t) => t.name === "list_automations")).toBe(false);
    expect(tools.every((t) => t.builtin === true)).toBe(true);
  });

  test("plugins 桩：GET → []；详情 404；写操作 501", async () => {
    const app = await makeApp();
    const h = authHeader();

    const list = await app.request("/api/plugins", { headers: h });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    const detail = await app.request("/api/plugins/foo", { headers: h });
    expect(detail.status).toBe(404);
    expect(((await detail.json()) as { detail: string }).detail).toContain("'foo'");

    const install = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: "{}",
    });
    expect(install.status).toBe(501);

    const toggle = await app.request("/api/plugins/foo/toggle", {
      method: "PUT",
      headers: { ...h, "content-type": "application/json" },
      body: "{}",
    });
    expect(toggle.status).toBe(501);
  });

  test("select-file 桩：GET /api/select-file → {path:null}", async () => {
    const app = await makeApp();
    const res = await app.request("/api/select-file?type=file", { headers: authHeader() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: null });
  });

  test("upload 全链路：上传 → 列表 → 删除；非法扩展名 400；非法 file_id 400", async () => {
    const app = await makeApp();
    const h = authHeader();

    const form = new FormData();
    form.append("file", new File(["hello world"], "测试文档.txt", { type: "text/plain" }));
    const up = await app.request("/api/upload", { method: "POST", headers: h, body: form });
    expect(up.status).toBe(200);
    const body = (await up.json()) as { file_id: string; filename: string; size: number; path: string };
    expect(body.filename).toBe("测试文档.txt"); // B-013：Unicode 保留
    expect(body.size).toBe(11);
    expect(body.path).toStartWith("local:");
    expect(body.file_id).toMatch(/^[a-f0-9]{32}$/);

    const list = (await (await app.request("/api/uploads", { headers: h })).json()) as {
      files: Array<{ file_id: string; filename: string }>;
      count: number;
    };
    expect(list.count).toBe(1);
    expect(list.files[0]!.file_id).toBe(body.file_id);

    const del = await app.request(`/api/uploads/${body.file_id}`, { method: "DELETE", headers: h });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { deleted: boolean }).deleted).toBe(true);

    const del2 = await app.request(`/api/uploads/${body.file_id}`, { method: "DELETE", headers: h });
    expect(del2.status).toBe(404);

    // 非法扩展名
    const badForm = new FormData();
    badForm.append("file", new File(["x"], "evil.exe"));
    const bad = await app.request("/api/upload", { method: "POST", headers: h, body: badForm });
    expect(bad.status).toBe(400);

    // 非法 file_id（glob 通配符）
    const globDel = await app.request("/api/uploads/*.glob", { method: "DELETE", headers: h });
    expect(globDel.status).toBe(400);
  });

  test("restart 路由已注册（不真实调用——会 process.exit）", async () => {
    const app = await makeApp();
    expect(app.routes.some((r) => r.method === "POST" && r.path === "/api/restart")).toBe(true);
  });
});

// ── 2.5b：runtime-status / error-collector / diagnostics ──

describe("runtime-status 词表（阶段 2.5b）", () => {
  test("sanitize_user_detail：赋值/bearer/query 三类脱敏", async () => {
    const { sanitizeUserDetail } = await import("../src/runtime-status");
    expect(sanitizeUserDetail("api_key=sk-abc def")).toBe("[redacted credential] def");
    expect(sanitizeUserDetail("Authorization: Bearer xyz123")).toBe("[redacted credential]");
    expect(sanitizeUserDetail("https://x.com/a?api_key=123&b=2")).toBe("https://x.com/a?[redacted query]&b=2");
    expect(sanitizeUserDetail(null)).toBeNull();
    expect(sanitizeUserDetail("")).toBe("");
  });

  test("reason_code_for / user_summary_for 映射", async () => {
    const { reasonCodeFor, userSummaryFor } = await import("../src/runtime-status");
    expect(reasonCodeFor("ok")).toBeNull();
    expect(reasonCodeFor("error", "got 401 Unauthorized")).toBe("authentication_failed");
    expect(reasonCodeFor("error", "429 too many requests")).toBe("rate_limited");
    expect(reasonCodeFor("error", "invalid base url")).toBe("invalid_configuration");
    expect(reasonCodeFor("error", "request timed out")).toBe("request_timed_out");
    expect(reasonCodeFor("error", "connection refused")).toBe("network_unavailable");
    expect(reasonCodeFor("degraded", "weird")).toBe("runtime_degraded");
    expect(reasonCodeFor("error", "weird")).toBe("runtime_error");
    expect(userSummaryFor("rate_limited")).toBe("The upstream service is rate limited.");
    expect(userSummaryFor(null)).toBeNull();
  });
});

describe("error-collector + diagnostics（阶段 2.5b）", () => {
  test("环形缓冲 + 导出报告结构 + 合并去重", async () => {
    const { getErrorCollector, ErrorCollector } = await import("../src/error-collector");
    const collector = getErrorCollector();
    collector.clear();

    collector.addError("ERROR", "tool", "[bash] boom", { session_id: "s1", tool_name: "bash" });
    collector.addError("WARNING", "http", "GET /api/x → 422", { request_id: "r1" });
    // 重复（同 level+message）应被去重
    collector.addError("ERROR", "tool", "[bash] boom", { session_id: "s2" });
    collector.addError("ERROR", "agent", "same failure", { trace_id: "trace-one", session_id: "s1", stage: "model_request" });
    collector.addError("ERROR", "agent", "same failure", { trace_id: "trace-two", session_id: "s1", stage: "model_request" });
    collector.addError("ERROR", "agent", "stack-bearing failure", { trace_id: "trace-stack", exception: "Error: boom\\n at request()", stage: "model_request", model_name: "test-model" });

    const archive = path.join(dataDir, "logs", "diagnostics.jsonl");
    expect(fs.existsSync(archive)).toBe(true);

    const report = collector.exportReport() as Record<string, unknown>;
    expect(typeof report.generated_at).toBe("string");
    expect(typeof (report.system_info as Record<string, unknown>).bun_version).toBe("string");
    const stats = report.stats as Record<string, unknown>;
    expect(stats.memory_error_count).toBe(6);
    expect(stats.buffer_capacity).toBe(ErrorCollector.MAX_IN_MEMORY);
    const errors = report.errors as Array<Record<string, unknown>>;
    // 不同会话中的同类工具错误保留独立上下文。
    expect(errors.filter((e) => e.category === "tool").length).toBe(2);
    expect(errors.filter((e) => e.message === "same failure").length).toBe(2);
    expect(errors.find((e) => e.message === "stack-bearing failure")?.extra).toMatchObject({ stage: "model_request", model_name: "test-model" });
    expect(errors.find((e) => e.message === "stack-bearing failure")?.exception).toContain("request()");
    expect(errors.filter((e) => e.message === "[bash] boom").every((e) => e.occurrence_count === 1)).toBe(true);
    expect(stats.merged_total).toBe(6);

    const afterRestart = new ErrorCollector().exportReport() as Record<string, unknown>;
    const restored = afterRestart.errors as Array<Record<string, unknown>>;
    expect(restored.some((e) => e.trace_id === "trace-stack" && e.exception)).toBe(true);

    const cleared = collector.clear();
    expect(cleared).toBe(6);
    expect(collector.getAll().length).toBe(0);
    expect(fs.existsSync(archive)).toBe(false);
  });

  test("diagnostics 全端点：frontend 上报 → 报告可见 → 文本导出 → 清理", async () => {
    const app = await makeApp();
    const h = authHeader();

    const post = await app.request("/api/diagnostics/frontend", {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "error",
        msg: "vue crash",
        url: "http://localhost:5173/chat",
        trace_id: "frontend-trace-1234",
        diagnostic: { name: "TypeError", stack: "TypeError: vue crash\\n at render()", filename: "ChatView.vue", line: 42 },
      }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ status: "ok" });

    const diagLog = path.join(dataDir, "logs", "frontend-diag.log");
    expect(fs.existsSync(diagLog)).toBe(true);
    const line = fs.readFileSync(diagLog, "utf8");
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] error \| http:\/\/localhost:5173\/chat \| frontend-trace-1234 \| vue crash\n$/);

    // 错误报告（JSON）应含前端行（category frontend，level ERROR）
    const report = (await (await app.request("/api/diagnostics/error-log", { headers: h })).json()) as {
      errors: Array<Record<string, unknown>>;
      system_info: Record<string, unknown>;
      autonomy_status: Record<string, unknown>;
      tauri_startup_log: Record<string, unknown>;
    };
    const fe = report.errors.find((e) => e.category === "frontend");
    expect(fe).toBeDefined();
    expect(fe!.level).toBe("ERROR");
    expect(fe!.trace_id).toBe("frontend-trace-1234");
    expect(fe!.exception).toContain("render()");
    expect(fe!.extra).toMatchObject({ name: "TypeError", filename: "ChatView.vue", line: 42 });
    expect(report.system_info.app_version).toBe("v2.6.11");
    expect(report.autonomy_status.available).toBe(false);
    expect(report.tauri_startup_log.available).toBe(false);

    // 文本报告
    const text = await app.request("/api/diagnostics/error-log/text", { headers: h });
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toContain("text/plain");
    expect(text.headers.get("content-disposition")).toContain("maxma-error-report.txt");
    expect(await text.text()).toContain("MaxmaHere 错误报告");

    // 日志文件列表 + 清理（保护活跃文件，删除遗留 .log）
    fs.writeFileSync(path.join(dataDir, "logs", "approval-test.log"), "junk");
    const logs = (await (await app.request("/api/diagnostics/logs", { headers: h })).json()) as {
      files: Array<{ name: string }>;
      count: number;
      total_bytes: number;
    };
    expect(logs.files.map((f) => f.name)).toContain("approval-test.log");
    expect(logs.files.map((f) => f.name)).toContain("frontend-diag.log");
    expect(logs.count).toBe(logs.files.length);

    const cleanup = (await (await app.request("/api/diagnostics/logs", { method: "DELETE", headers: h })).json()) as {
      deleted_count: number;
      deleted_files: Array<{ name: string }>;
    };
    expect(cleanup.deleted_files.map((f) => f.name)).toContain("approval-test.log");
    expect(fs.existsSync(path.join(dataDir, "logs", "approval-test.log"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "logs", "frontend-diag.log"))).toBe(true); // 受保护

    // 清空内存缓冲区
    const clear = (await (await app.request("/api/diagnostics/error-log", { method: "DELETE", headers: h })).json()) as {
      status: string;
      deleted: number;
    };
    expect(clear.status).toBe("ok");
  });

  test("DIAG-WIRE-001 接线：4xx（非 401/403/404）→ WARNING 入收集器；401/404 跳过", async () => {
    const app = await makeApp();
    const h = authHeader();
    const { getErrorCollector } = await import("../src/error-collector");
    getErrorCollector().clear();

    // 422（providers 校验失败）→ 应入收集器
    await app.request("/api/providers", {
      method: "POST",
      headers: { ...h, "content-type": "application/json" },
      body: "[]",
    });
    // 401（无 token）→ 跳过
    await app.request("/api/sessions");
    // 404 → 跳过
    await app.request("/api/no-such", { headers: h });

    const msgs = getErrorCollector().getAll().map((e) => e.message);
    expect(msgs.some((m) => m.includes("→ 422"))).toBe(true);
    expect(msgs.some((m) => m.includes("→ 401"))).toBe(false);
    expect(msgs.some((m) => m.includes("→ 404"))).toBe(false);
    getErrorCollector().clear();
  });

  test("request-log：X-Request-ID 响应头 + /api/health 跳过采集", async () => {
    const app = await makeApp();
    const res = await app.request("/api/tools", { headers: authHeader() });
    expect(res.headers.get("x-request-id")).toMatch(/^[a-f0-9]{12}$/);

    const { getMetrics } = await import("../src/metrics");
    const before = getMetrics().getSnapshot().http.total_requests;
    await app.request("/api/health");
    const after = getMetrics().getSnapshot().http.total_requests;
    // health 在跳过清单：不记录指标（对齐 Python _SKIP_PATHS）
    expect(after).toBe(before);
  });
});

// ── 2.5b：health 完整版 ──

describe("health 四部件（阶段 2.5b）", () => {
  test("getHealthReport（空会话）→ 完整报告形状（直测，与运行顺序无关）", async () => {
    const { getHealthReport, resetHealthProbeCache } = await import("../src/health");
    resetHealthProbeCache();
    const body = await getHealthReport({
      sessionIds: () => [],
      callRpc: async () => ({ ok: true as const, result: { ok: true } }),
    });

    expect(body.status).toBe("ok");
    expect(body.version).toBe("v2.6.11");
    for (const key of ["llm", "memory", "native_tools", "mcp_tools"]) {
      const comp = body[key] as Record<string, unknown>;
      expect(comp.status).toBe("ok");
      expect(typeof comp.latency_ms).toBe("number");
      expect(typeof comp.updated_at).toBe("number");
      // ok 状态：exclude_none → 无 reason_code/summary/retry_at
      expect(comp.reason_code).toBeUndefined();
      expect(comp.summary).toBeUndefined();
    }
    expect((body.native_tools as { detail: string }).detail).toBe("14 个工具");
    expect((body.mcp_tools as { detail: string }).detail).toBe("0 个工具（未配置 MCP 服务器）");
    expect(typeof body.anthropic_skills_count).toBe("number");
    expect(body.provider_diagnostics_enabled).toBe(false);
    expect(body.think_path_enabled).toBe(false);
    expect(typeof body.timestamp).toBe("number");
    expect(body.ltm).toBeUndefined(); // Python 恒 None → exclude_none
  });

  test("getHealthReport（有会话）→ llm 经 get_health RPC 探测", async () => {
    const { getHealthReport, resetHealthProbeCache } = await import("../src/health");
    resetHealthProbeCache();
    const calls: string[] = [];
    const body = await getHealthReport({
      sessionIds: () => ["sess-1"],
      callRpc: async (method) => {
        calls.push(method);
        return { ok: true as const, result: { ok: true, message: "pi 内核健康" } };
      },
    });
    expect(calls).toEqual(["get_health"]);
    expect((body.llm as Record<string, unknown>).detail).toBe("pi 内核健康");

    // RPC 失败 → llm error + reason_code（runtime_error）
    resetHealthProbeCache();
    const bad = await getHealthReport({
      sessionIds: () => ["sess-2"],
      callRpc: async () => ({ ok: false as const, error: "boom" }),
    });
    const llm = bad.llm as Record<string, unknown>;
    expect(llm.status).toBe("error");
    expect(llm.reason_code).toBe("runtime_error");
    expect(bad.status).toBe("degraded");
    resetHealthProbeCache();
  });

  test("GET /api/health 端点免鉴权可达（200 + status 字段）", async () => {
    const { resetHealthProbeCache } = await import("../src/health");
    resetHealthProbeCache();
    const app = await makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(["ok", "degraded"]).toContain(body.status);
    expect(body.version).toBe("v2.6.11");
  });
});

// ── 2.5c：capabilities ──

describe("capabilities 聚合（阶段 2.5c）", () => {
  test("GET /api/capabilities → 聚合 + manifest", async () => {
    const app = await makeApp();
    const res = await app.request("/api/capabilities", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(typeof body.settings).toBe("object");
    expect((body.tools as unknown[]).length).toBe(14);
    expect(body.tool_categories).toBeDefined();
    expect(Array.isArray(body.mcp_servers)).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
    expect((body.env as Record<string, unknown>).platform).toBe(process.platform);
    expect((body.system as Record<string, unknown>).sidecar_available).toBe(true);
    // session_count：同进程早期测试（chat-ws/sessions）会向模块级 hubSessions
    // 累积活跃会话——只验证为非负数字，不断言 0（与运行顺序无关）
    expect(typeof (body.system as Record<string, unknown>).session_count).toBe("number");
    expect((body.system as Record<string, unknown>).session_count as number).toBeGreaterThanOrEqual(0);
    expect(body.memory).toEqual({ total: 0, categories: {}, avg_confidence: 0 });

    const cfg = body.config_sources as Record<string, unknown>;
    expect((cfg.sources as unknown[]).length).toBe(13);
    expect((cfg.resolution_order as string[]).length).toBe(13);

    // Phase4 manifest
    expect(body.version).toBe("v2.6.11");
    const features = body.features as Record<string, Record<string, unknown>>;
    expect(features.automation.enabled).toBe(false); // automation 随 Python 下线
    expect(features.mcp.enabled).toBe(true);
    expect(features.mcp.transports).toEqual(["stdio", "streamable_http"]);
    expect(features.memory.enabled).toBe(true);
    expect(features.collab.enabled).toBe(true);
    expect(features.plugins.enabled).toBe(false);
    expect(features.extensions.enabled).toBe(true);
    expect(features.extensions.bundled).toEqual(["maxma-approval", "maxma-blocker", "request-telemetry"]);
    expect(features.rules.enabled).toBe(true);
    expect(features.tools.builtin_count).toBe(7);
    expect(features.tools.custom_count).toBe(7);
    // providers 可能含 opencode-zen 内置供应商（后台同步注入，与运行顺序无关）——
    // 只验证形状：providers 数组、total_models 与 providers 长度一致
    expect(Array.isArray(features.models.providers)).toBe(true);
    expect(features.models.total_models).toBe((body.providers as unknown[]).length);

    const sidecar = body.sidecar as Record<string, unknown>;
    expect(sidecar.status).toBe("running");
    expect(sidecar.version).toBe("0.1.0");

    const endpoints = body.endpoints as string[];
    expect(endpoints).toContain("/api/health");
    expect(endpoints).toContain("/api/tools");
    expect(endpoints).toContain("/api/capabilities");
    expect(endpoints).toContain("/api/diagnostics/error-log");
    expect([...endpoints].sort()).toEqual(endpoints);
  });

  test("GET /api/skills/discovered → discovered skills array", async () => {
    const app = await makeApp();
    const res = await app.request("/api/skills/discovered", { headers: authHeader() });
    expect(res.status).toBe(200);
    const skills = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.some((skill) => skill.name === "coding-starter")).toBe(true);
    expect(skills.some((skill) => skill.name === "spreadsheet-starter")).toBe(true);
    for (const skill of skills) {
      expect(typeof skill.name).toBe("string");
      expect(typeof skill.description).toBe("string");
      expect(typeof skill.source).toBe("string");
      expect(typeof skill.file_path).toBe("string");
    }
  });
});

// ── 2.5d：CORS ──

describe("CORS（阶段 2.5d）", () => {
  test("预检：白名单 origin → 204 + ACAO + credentials；非白名单 → 无 ACAO", async () => {
    const app = await makeApp();

    const pre = await app.request("/api/sessions", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(pre.headers.get("access-control-allow-credentials")).toBe("true");

    const evil = await app.request("/api/sessions", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example.com", "Access-Control-Request-Method": "GET" },
    });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("实际请求：白名单 origin 带 ACAO；无 Origin（同源/桌面）不带", async () => {
    const app = await makeApp();
    const h = authHeader();

    const withOrigin = await app.request("/api/tools", { headers: { ...h, Origin: "http://127.0.0.1:5173" } });
    expect(withOrigin.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(withOrigin.headers.get("access-control-allow-credentials")).toBe("true");
    expect(withOrigin.headers.get("vary")).toContain("Origin");

    const noOrigin = await app.request("/api/tools", { headers: h });
    expect(noOrigin.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("production 模式追加 api_port origin", async () => {
    const prev = process.env.MAXMA_ENV;
    process.env.MAXMA_ENV = "production";
    try {
      const { buildCorsOrigins } = await import("../src/cors-config");
      const origins = buildCorsOrigins();
      expect(origins).toContain("http://localhost:5173");
      expect(origins).toContain("http://localhost:8000");
      expect(origins).toContain("tauri://localhost");
      expect(origins).toContain("https://tauri.localhost");
    } finally {
      if (prev === undefined) delete process.env.MAXMA_ENV;
      else process.env.MAXMA_ENV = prev;
    }
  });
});

// ── config-settings env 覆盖 ──

describe("config-settings（阶段 2.5a）", () => {
  test("env 覆盖默认值（大小写不敏感 + 布尔解析）", async () => {
    const { getAppSettings } = await import("../src/config-settings");
    const prev = { web: process.env.MAXMA_WEB_PORT, think: process.env.THINK_PATH_ENABLED };
    process.env.MAXMA_WEB_PORT = "9999";
    process.env.THINK_PATH_ENABLED = "yes";
    try {
      const s = getAppSettings();
      expect(s.maxma_web_port).toBe(9999);
      expect(s.think_path_enabled).toBe(true);
      expect(s.maxma_api_port).toBe(8000);
    } finally {
      for (const [k, v] of Object.entries({ MAXMA_WEB_PORT: prev.web, THINK_PATH_ENABLED: prev.think })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test(".env 文件读取（process.env 优先）", async () => {
    fs.writeFileSync(path.join(dataDir, ".env"), "MAXMA_API_PORT=7777\n# comment\nPROVIDER_DIAGNOSTICS_ENABLED=on\n");
    const prev = process.env.MAXMA_API_PORT;
    delete process.env.MAXMA_API_PORT;
    try {
      const { getAppSettings } = await import("../src/config-settings");
      const s = getAppSettings();
      expect(s.maxma_api_port).toBe(7777);
      expect(s.provider_diagnostics_enabled).toBe(true);
    } finally {
      if (prev !== undefined) process.env.MAXMA_API_PORT = prev;
    }
  });
});
