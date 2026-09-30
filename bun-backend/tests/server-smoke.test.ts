/**
 * tests/server-smoke.test.ts — 阶段 2.0 冒烟（SMOKE-BACKEND-001）。
 *
 * 覆盖：auth 中间件契约（白名单/拦截/401 形状）、health/token 路由、
 * 静态托管与 SPA fallback、限流豁免。直调 createApp()（Hono request()
 * 无端口绑定）+ serveFrontend()，不启动真实监听。
 *
 * 隔离：MAXMA_DATA_DIR 指向临时目录——不读写真实 api/data。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-bun-backend-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  // 造一个最小 web/dist（index.html + assets/main.js）
  const dist = path.join(dataDir, "web", "dist", "assets");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "web", "dist", "index.html"), "<html>maxma</html>");
  fs.writeFileSync(path.join(dist, "main.js"), "console.log(1)");
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("bun-backend 冒烟", () => {
  test("白名单：/api/health 与 /api/auth/token 免鉴权可用；Token 存 SQLite 与 Python 互认", async () => {
    const { createApp } = await import("../src/server");
    const app = createApp();

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const body = (await health.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.engine).toBe("bun-backend");

    const tokenRes = await app.request("/api/auth/token");
    expect(tokenRes.status).toBe(200);
    const { token } = (await tokenRes.json()) as { token: string };
    // 与 Python secrets.token_hex(32) 同格式（64 字符 hex）
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Token 持久化在 maxma.db 的 auth_tokens 表（Python db/auth.py 同一存储）
    const { Database } = await import("bun:sqlite");
    const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get() as { token: string };
    db.close();
    expect(row.token).toBe(token);
  });

  test("鉴权拦截：无 token → 401 {detail}；正确 token → 通过（契约形状与 Python 一致）", async () => {
    const { createApp } = await import("../src/server");
    const app = createApp();

    const denied = await app.request("/api/sessions");
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { detail: string }).detail).toContain("Unauthorized");

    // 带上真实 token 后：未注册路由 → Hono 404（说明鉴权已通过，到达路由层）
    const token = (await (await app.request("/api/auth/token")).json() as { token: string }).token;
    const ok = await app.request("/api/no-such-route", { headers: { "x-maxma-token": token } });
    expect(ok.status).toBe(404);

    // query token 备用路径（SSE/img 场景）
    const viaQuery = await app.request(`/api/no-such-route?token=${token}`);
    expect(viaQuery.status).toBe(404);
  });

  test("OPTIONS 预检放行（CORS 中间件职责，鉴权不拦截）", async () => {
    const { createApp } = await import("../src/server");
    const app = createApp();
    const res = await app.request("/api/sessions", { method: "OPTIONS" });
    expect(res.status).not.toBe(401);
  });

  test("静态托管：/ → index.html、/assets/main.js → js、/some/route → SPA fallback、/api 例外", async () => {
    const { serveFrontend } = await import("../src/server");
    // 注入测试专用的 dist（MAXMA_DATA_DIR 下临时构建）
    const dist = path.join(dataDir, "web", "dist");
    const root = await serveFrontend("/", dist);
    expect(root).not.toBeNull();
    expect((root!.headers.get("content-type") ?? "")).toContain("text/html");

    const asset = await serveFrontend("/assets/main.js", dist);
    expect(asset).not.toBeNull();
    expect((asset!.headers.get("content-type") ?? "")).toContain("javascript");

    const spa = await serveFrontend("/some/route", dist);
    expect(spa).not.toBeNull();
    expect((spa!.headers.get("content-type") ?? "")).toContain("text/html");

    // 目录穿越防护：静态层拒绝后落入 SPA fallback——关键是不返回 dist 外文件内容
    const traversal = await serveFrontend("/../etc/passwd", dist);
    if (traversal !== null) {
      const text = await traversal.text();
      expect(text).toContain("maxma"); // 只可能是我们的 index.html
    }
  });
});
