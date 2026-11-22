/**
 * M4 后端单测：模型路由、源文件安全、审批中心与交付包。
 *
 * 真实临时 SQLite + 真实文件系统；不 mock 文件写入，确保“版本化/恢复”不是口头承诺。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Database } from "bun:sqlite";

import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";
import { CoworkConflictError, CoworkStore, CoworkValidationError } from "../src/services/cowork-store";
import {
  buildDeliveryPackage,
} from "../src/services/cowork-package";
import {
  deleteStagedArtifact,
  exportArtifactToWorkspace,
  listFileBackups,
  previewExportTarget,
  restoreFileBackup,
} from "../src/services/cowork-source-safety";
import { resolveCoworkModelRoute } from "../src/services/cowork-model";
import { batchableApprovals, listApprovals } from "../src/services/cowork-approval-center";

let dataDir = "";
let prevDataDir: string | undefined;
let prevModel: string | undefined;
let workspace = "";
let outside = "";
let store: CoworkStore | null = null;
let db: Database | null = null;

beforeEach(async () => {
  dataDir = makeTempDataDir("maxma-cowork-m4");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevModel = process.env.MAXMA_COWORK_MODEL;
  process.env.MAXMA_DATA_DIR = dataDir;
  delete process.env.MAXMA_COWORK_MODEL;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  workspace = path.join(dataDir, "workspace");
  outside = path.join(dataDir, "outside");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const { initializeDatabase, resetDbInitForTest, getConnection } = await import("../src/db/core");
  resetDbInitForTest();
  initializeDatabase();
  store = new CoworkStore();
  db = getConnection();
});

afterEach(async () => {
  db?.close();
  db = null;
  store?.close();
  store = null;
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevModel === undefined) delete process.env.MAXMA_COWORK_MODEL;
  else process.env.MAXMA_COWORK_MODEL = prevModel;
  removeTempDataDir(dataDir);
});

function localProvider(): Record<string, unknown> {
  return { id: "local-llm", label: "本机 Qwen", base_url: "http://127.0.0.1:1234/v1", models: ["qwen3-8b"], api_key: "" };
}

function cloudProvider(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cloud-llm",
    label: "云端 GPT",
    base_url: "https://api.example.com/v1",
    models: ["gpt-4.1"],
    api_key: "sk-test",
    price_input_per_1k: 0.002,
    price_output_per_1k: 0.008,
    ...extra,
  };
}

function makeTask() {
  return store!.createTask({ title: "导出测试", objective: "写报告", workspace_root: workspace });
}

function makeArtifact(taskId: string): { artifact: ReturnType<CoworkStore["addArtifact"]>; source: string } {
  const task = store!.getTask(taskId);
  const source = path.join(task.staging_root, "report.docx");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, "artifact-bytes-v1");
  const artifact = store!.addArtifact({ taskId, runId: null, path: source, kind: "docx" });
  return { artifact, source };
}

describe("M4 模型路由与数据边界（T4.2/T4.3）", () => {
  test("local_only 只允许本机；没有本机渠道时明确失败且不探测云端", async () => {
    let probes = 0;
    const route = await resolveCoworkModelRoute({
      dataPolicy: "cloud",
      modelPolicyJson: JSON.stringify({ profile: "balanced" }),
      promptChars: 100,
      providers: [cloudProvider()],
      probeLocal: async () => { probes += 1; return { reachable: true, models: [], detail: "" }; },
    });
    expect(route.location).toBe("cloud");
    expect(route.cost.estimated_usd).toBeGreaterThan(0);
    expect(route.cost.note).toContain("每千 token");

    probes = 0;
    await expect(resolveCoworkModelRoute({
      dataPolicy: "local_only",
      modelPolicyJson: "{}",
      promptChars: 100,
      providers: [cloudProvider()],
      probeLocal: async () => { probes += 1; return { reachable: true, models: [], detail: "" }; },
    })).rejects.toThrow(CoworkConflictError);
    expect(probes).toBe(0);
  });

  test("local_only 下即使显式指定云端模型也拒绝", async () => {
    process.env.MAXMA_COWORK_MODEL = "cloud-llm/gpt-4.1";
    try {
      await expect(resolveCoworkModelRoute({
        dataPolicy: "local_only",
        modelPolicyJson: "{}",
        promptChars: 100,
        providers: [cloudProvider()],
        probeLocal: async () => ({ reachable: true, models: [], detail: "" }),
      })).rejects.toThrow(/local_only/);
    } finally {
      delete process.env.MAXMA_COWORK_MODEL;
    }
  });

  test("balanced 本机可达走本机；本机不可达回退云端并记录原因", async () => {
    const base = {
      dataPolicy: "cloud",
      modelPolicyJson: JSON.stringify({ profile: "balanced" }),
      promptChars: 100,
      providers: [localProvider(), cloudProvider()],
    };
    const local = await resolveCoworkModelRoute({
      ...base,
      probeLocal: async () => ({ reachable: true, models: ["qwen3-8b"], detail: "ok" }),
    });
    expect(local.location).toBe("local");
    expect(local.cost.estimated_usd).toBe(0);

    const fallback = await resolveCoworkModelRoute({
      ...base,
      probeLocal: async () => ({ reachable: false, models: [], detail: "connect" }),
    });
    expect(fallback.location).toBe("cloud");
    expect(fallback.fallback?.reason).toBe("connect");
  });

  test("private 本机不可达不偷上云；长文档自动质量档", async () => {
    await expect(resolveCoworkModelRoute({
      dataPolicy: "cloud",
      modelPolicyJson: JSON.stringify({ profile: "private" }),
      promptChars: 100,
      providers: [localProvider(), cloudProvider()],
      probeLocal: async () => ({ reachable: false, models: [], detail: "down" }),
    })).rejects.toThrow(/private/);

    const longDoc = await resolveCoworkModelRoute({
      dataPolicy: "cloud",
      modelPolicyJson: JSON.stringify({ profile: "balanced" }),
      promptChars: 25_000,
      longDocument: true,
      providers: [localProvider(), cloudProvider()],
    });
    expect(longDoc.location).toBe("cloud");
    expect(longDoc.reason).toContain("长文档");
  });

  test("云端未配置单价时成本是未知，不写成 0", async () => {
    const route = await resolveCoworkModelRoute({
      dataPolicy: "cloud",
      modelPolicyJson: "{}",
      promptChars: 100,
      providers: [cloudProvider({ price_input_per_1k: undefined, price_output_per_1k: undefined })],
    });
    expect(route.location).toBe("cloud");
    expect(route.cost.estimated_usd).toBeNull();
    expect(route.cost.note).toContain("无法估算");
  });
});

describe("M4 源文件安全与恢复（T4.4）", () => {
  test("同名文件自动版本化，不静默覆盖；可备份并一键恢复", () => {
    const task = makeTask();
    const { artifact } = makeArtifact(task.id);
    const existing = path.join(workspace, "report.docx");
    fs.writeFileSync(existing, "user-original");

    const result = exportArtifactToWorkspace(db!, task, artifact);
    expect(result.versioned).toBe(true);
    expect(path.basename(result.path)).toBe("report.v2.docx");
    expect(fs.readFileSync(existing, "utf8")).toBe("user-original");
    expect(fs.readFileSync(result.path, "utf8")).toBe("artifact-bytes-v1");
    expect(result.sha256).toBe(artifact.sha256);

    const backups = listFileBackups(db!, task.id);
    expect(backups.length).toBe(1);
    expect(fs.readFileSync(backups[0]!.backup_path, "utf8")).toBe("artifact-bytes-v1");

    fs.writeFileSync(result.path, "user-edited");
    restoreFileBackup(db!, result.backup_id);
    expect(fs.readFileSync(result.path, "utf8")).toBe("artifact-bytes-v1");
    // 恢复前也留了当前版本，恢复动作本身可回滚。
    expect(listFileBackups(db!, task.id).some((item) => item.reason === "pre_restore")).toBe(true);
  });

  test("导出目标越界拒绝；目标目录不存在拒绝", () => {
    const task = makeTask();
    const { artifact } = makeArtifact(task.id);
    expect(() => previewExportTarget(task, artifact, outside)).toThrow(CoworkValidationError);
    expect(() => previewExportTarget(task, artifact, path.join(workspace, "missing"))).toThrow(CoworkValidationError);
    expect(() => previewExportTarget(task, artifact, path.join(workspace, "..", "outside"))).toThrow(CoworkValidationError);
  });

  test("工作区内的目录 junction 指向外部时仍拒绝", () => {
    const task = makeTask();
    const { artifact } = makeArtifact(task.id);
    const link = path.join(workspace, "escape");
    let made = false;
    try {
      fs.symlinkSync(outside, link, "junction");
      made = true;
    } catch {
      // Windows 无权限建链接时跳过；真实路径校验已由上一用例覆盖。
    }
    if (!made) return;
    expect(() => previewExportTarget(task, artifact, link)).toThrow(CoworkValidationError);
  });

  test("删除只把 staging 产物移入回收站，不直接抹掉", () => {
    const task = makeTask();
    const { artifact, source } = makeArtifact(task.id);
    deleteStagedArtifact(db!, task, artifact);
    expect(fs.existsSync(source)).toBe(false);
    expect(store!.getTask(task.id)).toBeTruthy();
    // 已删除产物保留 DB 审计行，但任务详情不再展示，避免 UI 出现“删了还在”的幽灵条目。
    expect(store!.getTaskDetail(task.id).artifacts.some((item) => item.id === artifact.id)).toBe(false);
    const trashRoot = path.join(task.staging_root, "..", "trash");
    const trashed = fs.existsSync(trashRoot)
      ? fs.readdirSync(trashRoot, { recursive: true }).some((name) => String(name).includes("report.docx"))
      : false;
    expect(trashed).toBe(true);
  });

  test("删除当前版本时同路径历史版本一起隐藏，回收站不抹掉此前删除", () => {
    const task = makeTask();
    const { artifact: first } = makeArtifact(task.id);
    const source = path.join(task.staging_root, "report.docx");
    fs.writeFileSync(source, "artifact-bytes-v2");
    const second = store!.addArtifact({ taskId: task.id, runId: null, path: source, kind: "docx" });
    expect(second.version).toBe(2);

    deleteStagedArtifact(db!, task, second);
    expect(store!.getTaskDetail(task.id).artifacts.some((item) => item.path === source)).toBe(false);

    const otherRoot = path.join(task.staging_root, "notes.txt");
    fs.writeFileSync(otherRoot, "other-bytes");
    const other = store!.addArtifact({ taskId: task.id, runId: null, path: otherRoot, kind: "document" });
    deleteStagedArtifact(db!, task, other);

    const trashRoot = path.join(task.staging_root, "..", "trash");
    const names = fs.readdirSync(trashRoot, { recursive: true }).map(String);
    expect(names.some((name) => name.includes("report.docx"))).toBe(true);
    expect(names.some((name) => name.includes("notes.txt"))).toBe(true);
    expect(first.id).toBeTruthy();
  });
});

describe("M4 审批中心（T4.1）", () => {
  test("只读低风险可批量；计划/写入/导出永远逐项", () => {
    const task = makeTask();
    const safe = store!.createApproval({
      taskId: task.id,
      runId: null,
      kind: "tool",
      payload: { tool_name: "read", risk_level: "low", question: "读取文件？" },
    });
    const write = store!.createApproval({
      taskId: task.id,
      runId: null,
      kind: "tool",
      payload: { tool_name: "write", risk_level: "low", question: "写入？" },
    });
    const plan = store!.createApproval({
      taskId: task.id,
      runId: null,
      kind: "plan",
      payload: { plan_id: "p1", plan_text: "计划" },
    });
    const views = listApprovals(db!, { status: "pending" });
    expect(views.find((view) => view.id === safe.id)?.batchable).toBe(true);
    expect(views.find((view) => view.id === write.id)?.batchable).toBe(false);
    expect(views.find((view) => view.id === plan.id)?.batchable).toBe(false);
    expect(batchableApprovals(db!, [safe.id]).map((view) => view.id)).toEqual([safe.id]);
    expect(batchableApprovals(db!, [safe.id, safe.id]).length).toBe(1);
    expect(() => batchableApprovals(db!, [write.id])).toThrow(CoworkConflictError);
    expect(() => batchableApprovals(db!, [plan.id])).toThrow(CoworkConflictError);
  });
});

describe("M4 交付包（T4.5）", () => {
  test("ZIP 含当前产物、README 与 sources.json", () => {
    const task = store!.createTask({
      title: "周报交付",
      objective: "生成周报",
      workspace_root: workspace,
      inputs: { assets: [{ path: path.join(workspace, "paper.pdf"), label: "论文" }] },
    });
    const { artifact, source } = makeArtifact(task.id);
    const pkg = buildDeliveryPackage(task, [artifact]);
    const files = unzipSync(pkg.bytes);
    const names = Object.keys(files);
    expect(names).toContain("README.md");
    expect(names).toContain("sources.json");
    expect(names).toContain(`artifacts/${path.basename(source)}`);
    expect(strFromU8(files["README.md"]!)).toContain("周报交付");
    expect(strFromU8(files["sources.json"]!)).toContain("paper.pdf");
  });
});
