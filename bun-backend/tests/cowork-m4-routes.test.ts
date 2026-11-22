/**
 * M4 REST 契约：导出审批、备份恢复、交付包、批量审批拒绝非安全项、数据策略。
 *
 * 走真实 createApp + token；文件写入真实临时工作区。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Hono } from "hono";
import { unzipSync, strFromU8 } from "fflate";

import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";
import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let prevDataDir: string | undefined;
let prevCowork: string | undefined;
let prevModel: string | undefined;
let workspace = "";
let outside = "";
let app: Hono | null = null;
let serverModule: typeof import("../src/server") | null = null;

beforeEach(() => {
  dataDir = makeTempDataDir("maxma-cowork-m4-routes");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevCowork = process.env.MAXMA_COWORK;
  prevModel = process.env.MAXMA_COWORK_MODEL;
  delete process.env.MAXMA_COWORK;
  delete process.env.MAXMA_COWORK_MODEL;
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
  if (prevModel === undefined) delete process.env.MAXMA_COWORK_MODEL;
  else process.env.MAXMA_COWORK_MODEL = prevModel;
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

async function createTask(instance: Hono, extra: Record<string, unknown> = {}) {
  const response = await instance.request("/api/cowork/tasks", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title: "导出测试", objective: "生成报告", workspace_root: workspace, ...extra }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { task: Record<string, unknown> }).task as {
    id: string;
    staging_root: string;
    data_policy: string;
    model_policy_json: string;
  };
}

describe("M4 导出审批、备份恢复与交付包 REST", () => {
  test("导出必须审批；同名不覆盖；备份可恢复；交付包可解压", async () => {
    const instance = await makeApp();
    const task = await createTask(instance);
    fs.writeFileSync(path.join(workspace, "report.docx"), "user-file");

    const artifactPath = path.join(task.staging_root, "report.docx");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "artifact-v1");
    const { CoworkStore } = await import("../src/services/cowork-store");
    const store = new CoworkStore();
    const artifact = store.addArtifact({ taskId: task.id, runId: null, path: artifactPath, kind: "docx" });
    store.close();

    const requestExport = await instance.request(
      `/api/cowork/tasks/${task.id}/artifacts/${artifact.id}/export`,
      { method: "POST", headers: headers(), body: JSON.stringify({}) },
    );
    expect(requestExport.status).toBe(201);
    const approval = ((await requestExport.json()) as { approval: Record<string, unknown> }).approval;
    expect(approval.kind).toBe("export");
    expect(approval.batchable).toBe(false);

    const before = await instance.request(`/api/cowork/tasks/${task.id}`, { headers: headers() });
    const beforeBody = (await before.json()) as { task: { status: string } };
    expect(beforeBody.task.status).toBe("draft");

    const decide = await instance.request(`/api/cowork/approvals/${approval.id}/decide`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "approve" }),
    });
    expect(decide.status).toBe(200);
    expect(fs.readFileSync(path.join(workspace, "report.v2.docx"), "utf8")).toBe("artifact-v1");
    expect(fs.readFileSync(path.join(workspace, "report.docx"), "utf8")).toBe("user-file");

    const backups = await instance.request(`/api/cowork/tasks/${task.id}/file-backups`, { headers: headers() });
    expect(backups.status).toBe(200);
    const backupList = ((await backups.json()) as { backups: Array<{ id: string; backup_path: string }> }).backups;
    expect(backupList.length).toBe(1);
    expect(fs.readFileSync(backupList[0]!.backup_path, "utf8")).toBe("artifact-v1");

    fs.writeFileSync(path.join(workspace, "report.v2.docx"), "changed-after-export");
    const restore = await instance.request(`/api/cowork/file-backups/${backupList[0]!.id}/restore`, {
      method: "POST",
      headers: headers(),
    });
    expect(restore.status).toBe(200);
    expect(fs.readFileSync(path.join(workspace, "report.v2.docx"), "utf8")).toBe("artifact-v1");

    const pkgRes = await instance.request(`/api/cowork/tasks/${task.id}/package`, { headers: headers() });
    expect(pkgRes.status).toBe(200);
    expect(pkgRes.headers.get("content-type")).toContain("application/zip");
    const files = unzipSync(new Uint8Array(await pkgRes.arrayBuffer()));
    expect(Object.keys(files)).toContain("README.md");
    expect(Object.keys(files)).toContain("sources.json");
    expect(strFromU8(files["README.md"]!)).toContain("导出测试");
  });

  test("模型路由预检：local_only 拒绝云端且不泄露 api_key", async () => {
    const instance = await makeApp();
    const created = await instance.request("/api/providers", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        id: "cloud-preview",
        label: "云端预检",
        base_url: "https://api.example.com/v1",
        api_key: "sk-never-return-this",
        models: ["gpt-4.1"],
        price_input_per_1k: 0.002,
        price_output_per_1k: 0.008,
      }),
    });
    expect(created.status).toBe(200);

    const projectRes = await instance.request("/api/cowork/projects", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "本机预检", workspace_roots: [workspace], data_policy: "local_only" }),
    });
    const project = ((await projectRes.json()) as { project: { id: string } }).project;
    const localOnly = await instance.request("/api/cowork/model-route/preview", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ project_id: project.id, model_policy: { profile: "quality" }, prompt_chars: 800 }),
    });
    expect(localOnly.status).toBe(409);

    const cloud = await instance.request("/api/cowork/model-route/preview", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ data_policy: "cloud", model_policy: { profile: "quality" }, prompt_chars: 800 }),
    });
    expect(cloud.status).toBe(200);
    const raw = await cloud.text();
    expect(raw).not.toContain("sk-never-return-this");
    expect(raw).not.toContain("\"params\"");
    const body = JSON.parse(raw) as { route: { location: string; cost: { estimated_usd: number | null; note: string } } };
    expect(body.route.location).toBe("cloud");
    // 渠道未配置单价时必须是 null（未知），不能伪写成 0。
    expect(body.route.cost.estimated_usd).toBeNull();
    expect(body.route.cost.note).toContain("无法估算");
  });

  test("批量审批拒绝计划/写工具；项目 local_only 不能被任务覆盖", async () => {
    const instance = await makeApp();
    const projectRes = await instance.request("/api/cowork/projects", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "本机项目", workspace_roots: [workspace], data_policy: "local_only" }),
    });
    expect(projectRes.status).toBe(201);
    const project = ((await projectRes.json()) as { project: { id: string } }).project;

    const task = await createTask(instance, {
      project_id: project.id,
      data_policy: "cloud",
      model_policy: { profile: "quality" },
    });
    expect(task.data_policy).toBe("local_only");
    expect(JSON.parse(task.model_policy_json)).toEqual({ profile: "quality" });

    const { CoworkStore } = await import("../src/services/cowork-store");
    const store = new CoworkStore();
    const writeApproval = store.createApproval({
      taskId: task.id,
      runId: null,
      kind: "tool",
      payload: { tool_name: "write", risk_level: "low" },
    });
    const planApproval = store.createApproval({
      taskId: task.id,
      runId: null,
      kind: "plan",
      payload: { plan_id: "plan-1", plan_text: "计划" },
    });
    store.close();

    const batch = await instance.request("/api/cowork/approvals/batch", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ids: [writeApproval.id, planApproval.id] }),
    });
    expect(batch.status).toBe(409);

    const list = await instance.request("/api/cowork/approvals?status=pending", { headers: headers() });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { approvals: Array<{ batchable: boolean }> };
    expect(listBody.approvals.every((item) => item.batchable === false)).toBe(true);
  });
});
