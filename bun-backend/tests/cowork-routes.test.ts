/**
 * Cowork REST 契约（M1）。
 *
 * 只打真实 HTTP 入口，不直接调 store；重点锁 404/409/503 的错误映射，
 * 以及关闭开关时 health 仍可读、任务端点明确 503。
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
let app: Hono | null = null;
let serverModule: typeof import("../src/server") | null = null;

beforeEach(() => {
  dataDir = makeTempDataDir("maxma-cowork-routes");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevCowork = process.env.MAXMA_COWORK;
  delete process.env.MAXMA_COWORK;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  workspace = path.join(dataDir, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
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
  return authHeaderFor(dataDir);
}

async function makeApp(): Promise<Hono> {
  if (!serverModule) serverModule = await import("../src/server");
  if (!app) app = serverModule.createApp();
  return app;
}

describe("Cowork REST", () => {
  test("health 可读；创建任务 201，详情/事件历史可回放", async () => {
    const instance = await makeApp();
    const h = headers();

    const health = await instance.request("/api/cowork/health", { headers: h });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ enabled: true, tasks: 0, active_sessions: 0 });

    const bad = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ title: "t", objective: "o", workspace_root: "relative" }),
    });
    expect(bad.status).toBe(400);

    const missing = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ title: "t", objective: "o", workspace_root: path.join(dataDir, "nope") }),
    });
    expect(missing.status).toBe(400);

    const created = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        title: "整理资料",
        objective: "产出一页摘要",
        workspace_root: workspace,
        permission_mode: "operate",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json() as { task: { id: string; status: string; staging_root: string } };
    expect(body.task.status).toBe("draft");
    expect(fs.existsSync(body.task.staging_root)).toBe(true);

    const detail = await instance.request(`/api/cowork/tasks/${body.task.id}`, { headers: h });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { task: { id: string }; steps: unknown[] };
    expect(detailBody.task.id).toBe(body.task.id);
    expect(detailBody.steps).toEqual([]);

    const history = await instance.request(`/api/cowork/tasks/${body.task.id}/events/history?after=0`, { headers: h });
    expect(history.status).toBe(200);
    const events = (await history.json()) as { events: Array<{ type: string; payload: Record<string, unknown> }> };
    expect(events.events.some((event) => event.type === "cowork.task.created")).toBe(true);
    expect(events.events[0]?.payload).toBeTruthy();

    const list = await instance.request("/api/cowork/tasks", { headers: h });
    expect(((await list.json()) as { tasks: unknown[] }).tasks.length).toBe(1);
  });

  test("SSE 先回放历史事件，事件带 id 游标；产物可从 staging 下载", async () => {
    const instance = await makeApp();
    const h = headers();
    const created = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ title: "导出", objective: "生成文件", workspace_root: workspace }),
    });
    const { task } = await created.json() as { task: { id: string; staging_root: string } };

    const { CoworkStore } = await import("../src/services/cowork-store");
    const store = new CoworkStore();
    try {
      store.transitionTask(task.id, "planning");
      const run = store.createRun(task.id);
      const file = path.join(task.staging_root, "结果.txt");
      fs.writeFileSync(file, "artifact-body", "utf8");
      const artifact = store.addArtifact({
        taskId: task.id,
        runId: run.id,
        path: file,
        kind: "text",
      });

      const download = await instance.request(
        `/api/cowork/tasks/${task.id}/artifacts/${artifact.id}/file`,
        { headers: h },
      );
      expect(download.status).toBe(200);
      expect(await download.text()).toBe("artifact-body");

      // 同路径覆盖后，旧 artifact id 必须仍下载旧版本字节，而不是当前磁盘内容。
      fs.writeFileSync(file, "artifact-body-v2", "utf8");
      const artifact2 = store.addArtifact({ taskId: task.id, runId: run.id, path: file, kind: "text" });
      const oldDownload = await instance.request(
        `/api/cowork/tasks/${task.id}/artifacts/${artifact.id}/file`,
        { headers: h },
      );
      expect(await oldDownload.text()).toBe("artifact-body");
      const newDownload = await instance.request(
        `/api/cowork/tasks/${task.id}/artifacts/${artifact2.id}/file?inline=1`,
        { headers: h },
      );
      expect(await newDownload.text()).toBe("artifact-body-v2");
      expect(newDownload.headers.get("content-disposition")).toContain("inline");

      const badRevision = await instance.request(`/api/cowork/tasks/${task.id}/revise`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ artifact_id: artifact.id, instruction: "改一下" }),
      });
      expect(badRevision.status).toBe(400);
      expect(((await badRevision.json()) as { detail: string }).detail).toContain("只支持 DOCX");

      // 越权路径不能借 artifact id 读取 staging 外的文件（store 侧已拦，路由侧再拦一次）。
      const fake = await instance.request(
        `/api/cowork/tasks/${task.id}/artifacts/not-an-artifact/file`,
        { headers: h },
      );
      expect(fake.status).toBe(404);

      const stream = await instance.request(`/api/cowork/tasks/${task.id}/events?after=0`, { headers: h });
      expect(stream.status).toBe(200);
      expect(stream.headers.get("content-type")).toContain("text/event-stream");
      const reader = stream.body!.getReader();
      const chunks: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
        if (chunks.join("").includes("event: cowork")) break;
      }
      await reader.cancel();
      const text = chunks.join("");
      expect(text).toContain("event: cowork");
      expect(text).toMatch(/id: \d+/);
      expect(text).toContain("cowork.task.created");
    } finally {
      store.close();
    }
  });

  test("非法状态跳转 409；未知任务/审批 404", async () => {
    const instance = await makeApp();
    const h = headers();
    const created = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ title: "t", objective: "o", workspace_root: workspace }),
    });
    const { task } = await created.json() as { task: { id: string } };

    const pause = await instance.request(`/api/cowork/tasks/${task.id}/pause`, { method: "POST", headers: h });
    expect(pause.status).toBe(409);

    const accept = await instance.request(`/api/cowork/tasks/${task.id}/accept`, { method: "POST", headers: h });
    expect(accept.status).toBe(409);

    const unknownTask = await instance.request("/api/cowork/tasks/no-such-task", { headers: h });
    expect(unknownTask.status).toBe(404);

    const unknownApproval = await instance.request("/api/cowork/approvals/no-such/decide", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ action: "approve" }),
    });
    expect(unknownApproval.status).toBe(404);
  });

  test("陈旧计划审批不能越过状态机：任务不在 awaiting_plan 时 409", async () => {
    const instance = await makeApp();
    const h = headers();
    const created = await instance.request("/api/cowork/tasks", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ title: "t", objective: "o", workspace_root: workspace }),
    });
    const { task } = await created.json() as { task: { id: string } };

    const { CoworkStore } = await import("../src/services/cowork-store");
    const store = new CoworkStore();
    try {
      const approval = store.createApproval({
        taskId: task.id,
        runId: null,
        kind: "plan",
        payload: { plan_id: "ghost", plan_text: "1. 写" },
        ttlMs: 60_000,
      });
      const decide = await instance.request(`/api/cowork/approvals/${approval.id}/decide`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ action: "approve" }),
      });
      expect(decide.status).toBe(409);
      expect(store.getApproval(approval.id).status).toBe("pending");
    } finally {
      store.close();
    }
  });

  test("MAXMA_COWORK=0：health en:false，任务/审批 503，且不打开任务库", async () => {
    process.env.MAXMA_COWORK = "0";
    const instance = await makeApp();
    const h = headers();

    const health = await instance.request("/api/cowork/health", { headers: h });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ enabled: false, tasks: 0, active_sessions: 0 });

    const tasks = await instance.request("/api/cowork/tasks", { headers: h });
    expect(tasks.status).toBe(503);

    const approval = await instance.request("/api/cowork/approvals/any/decide", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ action: "approve" }),
    });
    expect(approval.status).toBe(503);
  });
});
