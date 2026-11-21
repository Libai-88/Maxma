/**
 * tests/audit-agent.test.ts — M1/T4 审计合并与快照恢复的 REST 契约。
 *
 * 走 createApp + 全局 auth/loopback 中间件；快照文件由 sidecar 的写入格式生成，
 * 这里不复制生产逻辑，直接按公开 JSONL/JSON 形状落盘。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Hono } from "hono";

import { authHeaderFor } from "./_helpers/auth";
import { addWorkspaceRoot } from "../src/services/workspace-store";

let dataDir = "";
let workspace = "";
let outside = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-route-data-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-route-root-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-audit-route-outside-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

async function makeApp(): Promise<Hono> {
  const { createApp } = await import("../src/server");
  return createApp();
}

async function call(app: Hono, urlPath: string, init?: RequestInit, address = "127.0.0.1"): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-maxma-token", authHeaderFor(dataDir)["x-maxma-token"] ?? "");
  return app.fetch(new Request(`http://localhost${urlPath}`, { ...init, headers }), {
    server: { requestIP: () => ({ address }) },
  });
}

function snapshotDir(): string {
  return path.join(dataDir, "api", "data", "agent_snapshots");
}

function writeSnapshot(input: {
  id: string;
  target: string;
  existed: boolean;
  content?: string;
}): void {
  const dir = path.join(snapshotDir(), "s1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${input.id}.json`),
    JSON.stringify({
      id: input.id,
      session_id: "s1",
      tool_name: "write",
      path: input.target,
      existed: input.existed,
      size: input.content?.length ?? 0,
      created_at: Date.now(),
      truncated: false,
      ...(input.content === undefined ? {} : { content_base64: Buffer.from(input.content).toString("base64") }),
    }),
    "utf8",
  );
}

describe("audit-log agent records + snapshots", () => {
  test("合并 JSONL 到审计列表；清空同时移除 agent JSONL", async () => {
    fs.writeFileSync(
      path.join(dataDir, "api", "data", "agent_audit.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-11-21T10:00:00+0800",
        epoch: 1,
        type: "agent_tool",
        session_id: "s1",
        tool_name: "write",
        decision: "denied",
        detail: "path outside",
      })}\n`,
      "utf8",
    );
    const app = await makeApp();
    const list = await call(app, "/api/audit-log?event_type=agent_tool");
    expect(list.status).toBe(200);
    const records = ((await list.json()) as { records: Array<{ tool_name: string }> }).records;
    expect(records.map((r) => r.tool_name)).toContain("write");

    const cleared = await call(app, "/api/audit-log/clear", { method: "POST" });
    expect(cleared.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, "api", "data", "agent_audit.jsonl"))).toBe(false);
  });

  test("快照恢复已有文件；existed=false 时删除目标；越界快照 403", async () => {
    addWorkspaceRoot(workspace);
    const app = await makeApp();
    const target = path.join(workspace, "restore.txt");
    fs.writeFileSync(target, "current", "utf8");
    writeSnapshot({ id: "snap_existing", target, existed: true, content: "before" });

    const list = await call(app, "/api/audit-log/snapshots");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { snapshots: Array<{ id: string }> }).snapshots.map((s) => s.id)).toContain("snap_existing");

    const restore = await call(app, "/api/audit-log/snapshots/snap_existing/restore", { method: "POST" });
    expect(restore.status).toBe(200);
    expect(fs.readFileSync(target, "utf8")).toBe("before");

    const newPath = path.join(workspace, "new.txt");
    fs.writeFileSync(newPath, "created", "utf8");
    writeSnapshot({ id: "snap_new", target: newPath, existed: false });
    const remove = await call(app, "/api/audit-log/snapshots/snap_new/restore", { method: "POST" });
    expect(remove.status).toBe(200);
    expect(fs.existsSync(newPath)).toBe(false);

    const outsideTarget = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideTarget, "secret", "utf8");
    writeSnapshot({ id: "snap_outside", target: outsideTarget, existed: true, content: "overwrite" });
    const denied = await call(app, "/api/audit-log/snapshots/snap_outside/restore", { method: "POST" });
    expect(denied.status).toBe(403);
    expect(fs.readFileSync(outsideTarget, "utf8")).toBe("secret");
  });

  test("快照接口非回环 403", async () => {
    const app = await makeApp();
    const remote = await call(app, "/api/audit-log/snapshots", undefined, "10.1.2.3");
    expect(remote.status).toBe(403);
  });
});
