/**
 * Cowork M3 REST 契约：项目/资产/记忆、定时、连接器、活动流。
 *
 * 走真实 createApp + token，不开定时器（测试只验证配置面）。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";

import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";
import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let prevDataDir: string | undefined;
let prevCowork: string | undefined;
let workspace = "";
let outside = "";
let app: Hono | null = null;
let serverModule: typeof import("../src/server") | null = null;

beforeEach(() => {
  dataDir = makeTempDataDir("maxma-cowork-m3-routes");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevCowork = process.env.MAXMA_COWORK;
  delete process.env.MAXMA_COWORK;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  workspace = path.join(dataDir, "workspace");
  outside = path.join(dataDir, "outside");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
});

afterEach(async () => {
  if (app && serverModule) {
    serverModule.disposeAppCowork(app);
    app = null;
  }
  serverModule = null;
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevCowork === undefined) delete process.env.MAXMA_COWORK;
  else process.env.MAXMA_COWORK = prevCowork;
  removeTempDataDir(dataDir);
});

function headers(): Record<string, string> {
  return { ...authHeaderFor(dataDir), "content-type": "application/json" };
}

async function makeApp(): Promise<Hono> {
  if (!serverModule) serverModule = await import("../src/server");
  if (!app) app = serverModule.createApp();
  return app;
}

describe("Cowork M3 项目与资产 REST", () => {
  test("项目 CRUD、资产边界、加入任务与记忆确认门槛", async () => {
    const instance = await makeApp();
    const created = await instance.request("/api/cowork/projects", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: "热电周报",
        instructions: "引用文献时必须带页码。",
        workspace_roots: [workspace],
      }),
    });
    expect(created.status).toBe(201);
    const project = ((await created.json()) as { project: { id: string } }).project;
    expect(project.id).toBeTruthy();

    const taskRes = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: "第 1 周",
        objective: "写周报",
        workspace_root: workspace,
        project_id: project.id,
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = ((await taskRes.json()) as { task: { id: string } }).task;

    const file = path.join(workspace, "paper.pdf");
    fs.writeFileSync(file, "pdf");
    const outsideFile = path.join(outside, "x.txt");
    fs.writeFileSync(outsideFile, "x");
    const assetRes = await instance.request(`/api/cowork/projects/${project.id}/assets`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ path: file, label: "论文" }),
    });
    expect(assetRes.status).toBe(201);
    const asset = ((await assetRes.json()) as { asset: { id: string } }).asset;

    const outsideRes = await instance.request(`/api/cowork/projects/${project.id}/assets`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ path: outsideFile }),
    });
    expect(outsideRes.status).toBe(400);

    const attachRes = await instance.request(`/api/cowork/projects/${project.id}/assets/${asset.id}/attach`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ task_id: task.id }),
    });
    expect(attachRes.status).toBe(200);
    const detail = await instance.request(`/api/cowork/projects/${project.id}`, { headers: headers() });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as Record<string, unknown>;
    expect((body.assets as unknown[]).length).toBe(1);
    expect((body.tasks as unknown[]).length).toBe(1);

    const noConfirm = await instance.request(`/api/cowork/projects/${project.id}/memory`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ content: "自动写入？" }),
    });
    expect(noConfirm.status).toBe(400);
    const confirmed = await instance.request(`/api/cowork/projects/${project.id}/memory`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ content: "样品 A 热导率 40 W/mK。", category: "结论", confirmed: true }),
    });
    expect(confirmed.status).toBe(201);
    const memory = await instance.request(`/api/cowork/projects/${project.id}/memory?q=热导率`, { headers: headers() });
    expect(memory.status).toBe(200);
    expect(((await memory.json()) as { memory: unknown[] }).memory).toHaveLength(1);
  });
});

describe("Cowork M3 定时、连接器与活动 REST", () => {
  test("创建周一 9 点、可停用；连接器状态诚实；活动流可读", async () => {
    const instance = await makeApp();
    const taskRes = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "周报", objective: "写周报", workspace_root: workspace }),
    });
    expect(taskRes.status).toBe(201);
    const task = ((await taskRes.json()) as { task: { id: string } }).task;

    const scheduleRes = await instance.request("/api/cowork/schedules", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ task_id: task.id, cron: "0 9 * * 1", timezone: "Asia/Shanghai" }),
    });
    expect(scheduleRes.status).toBe(201);
    const schedule = ((await scheduleRes.json()) as { schedule: { id: string; next_run_at: string } }).schedule;
    const localParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(schedule.next_run_at));
    const values: Record<string, string> = {};
    for (const part of localParts) values[part.type] = part.value;
    expect(values.weekday).toBe("Mon");
    expect(values.hour === "24" ? "0" : values.hour).toBe("09");
    expect(values.minute).toBe("00");

    const list = await instance.request("/api/cowork/schedules", { headers: headers() });
    const listBody = (await list.json()) as Record<string, unknown>;
    expect((listBody.schedules as unknown[]).length).toBe(1);
    expect(listBody.note).toContain("应用关闭时不会运行");
    expect((listBody.presets as unknown[]).length).toBeGreaterThan(0);

    const patch = await instance.request(`/api/cowork/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { schedule: { enabled: number } }).schedule.enabled).toBe(0);

    const connectors = await instance.request("/api/cowork/connectors", { headers: headers() });
    expect(connectors.status).toBe(200);
    const conn = (await connectors.json()) as { connectors: Array<Record<string, unknown>>; recipes: unknown[] };
    expect(conn.recipes).toHaveLength(3);
    expect(conn.connectors.find((item) => item.id === "mcp")?.status).toBe("unconfigured");

    const activity = await instance.request("/api/cowork/activity", { headers: headers() });
    expect(activity.status).toBe(200);
    const events = ((await activity.json()) as { activity: Array<{ type: string }> }).activity;
    expect(events.some((event) => event.type === "cowork.schedule.created")).toBe(true);
  });
});
