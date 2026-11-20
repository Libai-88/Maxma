import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { browserNavigateTool, browserReadTool } from "../../bun-sidecar/src/tools/browser";

let dataDir = "";
let server: http.Server | null = null;
let requests: Array<{ action: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-browser-tool-"));
  process.env.MAXMA_DATA_DIR = dataDir;
  requests = [];
});

afterEach(() => {
  server?.close();
  server = null;
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.MAXMA_DATA_DIR;
});

async function startMock(handler?: (action: string) => unknown) {
  const secret = "a".repeat(64);
  server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/execute" || req.headers["x-maxma-browser-secret"] !== secret) {
      res.writeHead(403).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body);
      requests.push({ action: payload.action, args: payload.args ?? {} });
      const result = handler?.(payload.action) ?? { action: payload.action, url: "https://example.com/" };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const port = (server!.address() as { port: number }).port;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "api", "data", "browser-agent.json"), JSON.stringify({ port, secret }));
}

describe("browser agent tools", () => {
  test("没有桌面端配置时返回 desktop_required", async () => {
    const result = await browserNavigateTool().execute("t1", { url: "https://example.com" });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("desktop_required");
  });

  test("navigate 与 read 转发到本机端点，截图返回图片块", async () => {
    await startMock((action) => {
      if (action === "screenshot") {
        return { action, url: "https://example.com/", title: "Example", mime: "image/png", data: "iVBORw0KGgo=" };
      }
      return { action, url: "https://example.com/", title: "Example", text: "hello" };
    });

    const navigate = await browserNavigateTool().execute("t2", { url: "https://example.com" });
    expect((navigate.content[0] as { text: string }).text).toContain("https://example.com/");

    const snapshot = await browserReadTool().execute("t3", { action: "snapshot" });
    expect((snapshot.content[0] as { text: string }).text).toContain("hello");

    const shot = await browserReadTool().execute("t4", { action: "screenshot" });
    expect(shot.content).toHaveLength(2);
    expect(shot.content[1]).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });

    expect(requests.map((item) => item.action)).toEqual(["open", "snapshot", "screenshot"]);
  });

  test("端点失败时返回明确错误，不伪装成功", async () => {
    await startMock(() => ({ nope: true }));
    server!.removeAllListeners("request");
    server!.on("request", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "浏览器尚未创建" }));
    });
    const result = await browserReadTool().execute("t5", { action: "snapshot" });
    expect((result.content[0] as { text: string }).text).toContain("浏览器尚未创建");
  });
});
