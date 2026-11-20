import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Electron 主进程模块是 CommonJS；直接 require 可在 Bun 测试里跑。
const { startBrowserAgentServer } = require("../../desktop/electron/browser-agent-server.cjs");

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function makeDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-browser-agent-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("browser agent server", () => {
  test("写入配置、鉴权拒绝、动作转发与停止清理", async () => {
    const dataDir = makeDataDir();
    const calls: Array<{ action: string; args: unknown }> = [];
    const server = startBrowserAgentServer({
      controller: {
        agentExecute: async (action: string, args: unknown) => {
          calls.push({ action, args });
          if (action === "explode") throw new Error("boom");
          return { action, echoed: args };
        },
      },
      dataDir,
      logger: { info() {}, warn() {} },
    });
    cleanups.push(() => server.stop());

    const { port } = await server.start();
    const config = JSON.parse(fs.readFileSync(server.configPath, "utf8"));
    expect(config.port).toBe(port);
    expect(config.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(config.pid).toBe(process.pid);

    const endpoint = `http://127.0.0.1:${port}/execute`;
    const wrong = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-maxma-browser-secret": "nope" },
      body: JSON.stringify({ action: "open", args: { url: "https://example.com" } }),
    });
    expect(wrong.status).toBe(403);

    const ok = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-maxma-browser-secret": config.secret },
      body: JSON.stringify({ action: "open", args: { url: "https://example.com" } }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: { action: "open", echoed: { url: "https://example.com" } } });
    expect(calls).toEqual([{ action: "open", args: { url: "https://example.com" } }]);

    const failed = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-maxma-browser-secret": config.secret },
      body: JSON.stringify({ action: "explode" }),
    });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ ok: false, error: "boom" });

    const malformed = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-maxma-browser-secret": config.secret },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    server.stop();
    expect(fs.existsSync(server.configPath)).toBe(false);
  });
});
