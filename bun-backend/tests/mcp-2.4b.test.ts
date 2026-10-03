/**
 * tests/mcp-2.4b.test.ts — MCP 系列单测（阶段 2.4b）。
 *
 * servers CRUD + 脱敏 + [REDACTED] 合并、422/400 校验形状、discovered/reload、
 * registry install 校验、OAuth authorize/callback/status、test-connection 命令白名单。
 * 裸路由直测（不经 createApp，避免 kernel/DB 依赖）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeMcpApp() {
  const { createMcpRoutes } = await import("../src/routes/mcp");
  const { createMcpTestRoutes } = await import("../src/routes/mcp-test");
  const app = createMcpRoutes({
    sessions: new Map(),
    callRpc: async () => ({ ok: true as const, result: { status: "noop" } }),
  });
  app.route("/", createMcpTestRoutes());
  return app;
}

const H = { "content-type": "application/json" };

describe("MCP servers CRUD（阶段 2.4b）", () => {
  test("create → list → get → update → delete 全链路 + env 脱敏", async () => {
    const app = await makeMcpApp();

    const created = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        server_id: "fs",
        transport: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { API_KEY: "sk-1", X: "1" },
        description: "d",
        allowed_tools: ["t1"],
      }),
    });
    expect(created.status).toBe(200);
    const c = (await created.json()) as Record<string, unknown>;
    expect(c.status).toBe("created");
    const server = c.server as Record<string, unknown>;
    expect((server.env as Record<string, string>).API_KEY).toBe("[REDACTED]");
    expect((server.env as Record<string, string>).X).toBe("[REDACTED]"); // env 容器整体 mask_all
    const servers = c.servers as Array<Record<string, unknown>>;
    expect(servers[0]!.id).toBe("fs");
    expect(servers[0]!.status).toBe("unknown");

    const list = (await (await app.request("/api/mcp/servers", { headers: H })).json()) as {
      servers: Array<Record<string, unknown>>;
      tool_count: number;
    };
    expect(list.servers.length).toBe(1);
    expect(list.tool_count).toBe(0);

    const got = (await (await app.request("/api/mcp/servers/fs", { headers: H })).json()) as Record<string, unknown>;
    expect(got.command).toBe("npx");

    // update：[REDACTED] 占位不覆盖真实密钥（mergeRedactedMapping）
    const upd = await app.request("/api/mcp/servers/fs", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ env: { API_KEY: "[REDACTED]", NEW: "2" } }),
    });
    expect(upd.status).toBe(200);
    const u = (await upd.json()) as { server: { env: Record<string, string> } };
    expect(u.server.env.API_KEY).toBe("[REDACTED]"); // 展示层脱敏
    // 落盘文件里真实密钥保留
    const yaml = fs.readFileSync(path.join(dataDir, "api", "data", "mcp_servers.yaml"), "utf8");
    expect(yaml).toContain("sk-1");
    expect(yaml).toContain("NEW");

    const del = await app.request("/api/mcp/servers/fs", { method: "DELETE", headers: H });
    expect(((await del.json()) as Record<string, unknown>).status).toBe("deleted");
    expect((await app.request("/api/mcp/servers/fs", { headers: H })).status).toBe(404);
  }, 20000);

  test("校验形状：missing/422、transport 400、env 黑名单 400", async () => {
    const app = await makeMcpApp();

    const missing = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ transport: "stdio" }),
    });
    expect(missing.status).toBe(422);
    const m = (await missing.json()) as { detail: Array<{ type: string; loc: string[]; input: unknown }> };
    expect(m.detail[0]!.type).toBe("missing");
    expect(m.detail[0]!.loc).toEqual(["body", "server_id"]);
    expect(m.detail[0]!.input).toEqual({ transport: "stdio" });

    const badTransport = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "ftp" }),
    });
    expect(badTransport.status).toBe(400);
    expect(((await badTransport.json()) as { detail: string }).detail).toContain("不支持的 transport: ftp");

    const noCommand = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "stdio" }),
    });
    expect(noCommand.status).toBe(400);
    expect(((await noCommand.json()) as { detail: string }).detail).toBe("stdio 模式必须指定 command");

    const badCommand = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "stdio", command: "rm -rf /" }),
    });
    expect(badCommand.status).toBe(400);
    expect(((await badCommand.json()) as { detail: string }).detail).toContain("不在白名单中");

    const blockedEnv = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "stdio", command: "node", env: { PATH: "/evil" } }),
    });
    expect(blockedEnv.status).toBe(400);
    expect(((await blockedEnv.json()) as { detail: string }).detail).toContain("环境变量包含禁止设置的敏感 key: PATH");

    const unsupportedSse = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "sse" }),
    });
    expect(unsupportedSse.status).toBe(400);
    expect(((await unsupportedSse.json()) as { detail: string }).detail).toContain("仅支持 stdio/streamable_http");
  }, 20000);

  test("Pydantic 类型形状：args 元素 string_type 带下标、timeout float_parsing、args 空列表不落盘", async () => {
    const app = await makeMcpApp();

    const argsInt = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "stdio", command: "node", args: [1, 2] }),
    });
    expect(argsInt.status).toBe(422);
    const a = (await argsInt.json()) as { detail: Array<{ type: string; loc: (string | number)[]; input: unknown }> };
    expect(a.detail[0]!.type).toBe("string_type");
    expect(a.detail[0]!.loc).toEqual(["body", "args", 0]);

    const timeoutBad = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "x", transport: "stdio", command: "node", timeout: "abc" }),
    });
    expect(timeoutBad.status).toBe(422);
    expect(((await timeoutBad.json()) as { detail: Array<{ type: string }> }).detail[0]!.type).toBe("float_parsing");

    // 空 args 列表：Python `if body.args:` 为假 → 不落盘 args 键
    const emptyArgs = await app.request("/api/mcp/servers", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_id: "y", transport: "stdio", command: "node", args: [] }),
    });
    expect(emptyArgs.status).toBe(200);
    const yaml = fs.readFileSync(path.join(dataDir, "api", "data", "mcp_servers.yaml"), "utf8");
    expect(yaml).not.toMatch(/args/);
  }, 20000);

  test("discovered=[] / reload 无活跃会话 noop", async () => {
    const app = await makeMcpApp();
    expect(((await app.request("/api/mcp/discovered", { headers: H })).status)).toBe(200);
    expect(await (await app.request("/api/mcp/discovered", { headers: H })).json()).toEqual([]);
    const reload = (await (await app.request("/api/mcp/reload", { method: "POST", headers: H })).json()) as Record<string, unknown>;
    expect(reload.status).toBe("noop");
  }, 20000);
});

describe("MCP registry + oauth（阶段 2.4b）", () => {
  test("registry install：空 name → 400", async () => {
    const app = await makeMcpApp();
    const r = await app.request("/api/mcp/registry/install", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "" }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { detail: string }).detail).toBe("name 不能为空");
  }, 20000);

  test("oauth authorize → callback bad state 400 → status not_authorized", async () => {
    const app = await makeMcpApp();
    const auth = await app.request("/api/mcp/oauth/authorize", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ server_name: "gh", auth_endpoint: "https://example.com/authorize" }),
    });
    expect(auth.status).toBe(200);
    const a = (await auth.json()) as { auth_url: string; state: string; server_name: string };
    expect(a.auth_url).toContain("https://example.com/authorize?response_type=code");
    expect(a.auth_url).toContain("client_id=maxma-desktop");
    expect(a.auth_url).toContain("redirect_uri=http%3A%2F%2Flocalhost%2Fapi%2Fmcp%2Foauth%2Fcallback");
    expect(a.server_name).toBe("gh");

    const bad = await app.request("/api/mcp/oauth/callback", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ code: "c", state: "bogus" }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { detail: string }).detail).toBe("无效或已过期的 state 参数");

    const status = (await (await app.request("/api/mcp/oauth/status/gh", { headers: H })).json()) as Record<string, unknown>;
    expect(status).toEqual({ server_name: "gh", authorized: false, status: "not_authorized" });
  }, 20000);

  test("GET oauth callback（浏览器重定向）返回 HTML 页", async () => {
    const app = await makeMcpApp();
    const r = await app.request("/api/mcp/oauth/callback?code=c&state=bogus");
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("授权失败");
    expect(html).toContain("window.close()");
  }, 20000);
});

describe("MCP test-connection（阶段 2.4b）", () => {
  test("stdio 命令白名单 + URL 类探测分支", async () => {
    const app = await makeMcpApp();

    const badCmd = await app.request("/api/mcp/test-connection", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ command: "rm", args: ["-rf"] }),
    });
    expect(badCmd.status).toBe(400);
    expect(((await badCmd.json()) as { detail: string }).detail).toContain("不在白名单中");

    const urlMissing = await app.request("/api/mcp/test-connection", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ transport: "streamable_http", url: "" }),
    });
    const u = (await urlMissing.json()) as { success: boolean; error: string; resolved_command: string };
    expect(u.success).toBe(false);
    expect(u.error).toBe("缺少服务器 URL");

    const urlScheme = await app.request("/api/mcp/test-connection", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ transport: "streamable_http", url: "ftp://x" }),
    });
    expect(((await urlScheme.json()) as { error: string }).error).toBe("URL 必须以 http:// 或 https:// 开头");
  }, 20000);

  test("stdio 真实启动：node 常驻进程 5s 超时判成功", async () => {
    const app = await makeMcpApp();
    const r = await app.request("/api/mcp/test-connection", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ command: "node", args: ["-e", "setInterval(function(){},30000)"] }),
    });
    const data = (await r.json()) as { success: boolean; resolved_command: string };
    expect(data.success).toBe(true);
    expect(data.resolved_command).toBe("node");
  }, 20000);
});
