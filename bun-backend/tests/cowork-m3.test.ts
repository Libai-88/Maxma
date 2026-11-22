/**
 * Cowork M3-B/C/D 单测：项目/资产/记忆、cron、调度器、连接器注册表。
 *
 * 用真实临时 SQLite 与真实文件系统，不用内存桩；重点是边界拒绝、重启补跑策略与
 * 单任务不重叠。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";
import {
  CoworkConflictError,
  CoworkStore,
  CoworkValidationError,
  coworkProjectAssetsRoot,
} from "../src/services/cowork-store";
import { nextCronRun, parseCron, validateTimezone } from "../src/services/cowork-cron";
import { CoworkScheduler } from "../src/services/cowork-scheduler";
import { ConnectorRegistry } from "../src/services/connector-registry";
import { addProjectMemory, listProjectMemories } from "../src/services/cowork-project-memory";
import type { CoworkOrchestrator } from "../src/services/cowork-orchestrator";
import type { Database } from "bun:sqlite";

let dataDir = "";
let prevDataDir: string | undefined;
let workspace = "";
let outside = "";
let store: CoworkStore | null = null;
let db: Database | null = null;
let scheduler: CoworkScheduler | null = null;

beforeEach(async () => {
  dataDir = makeTempDataDir("maxma-cowork-m3");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
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
  scheduler?.close();
  scheduler = null;
  db?.close();
  db = null;
  store?.close();
  store = null;
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  removeTempDataDir(dataDir);
});

describe("项目、资产与记忆（C3.2/C3.4）", () => {
  test("项目隔离、任务工作区必须在项目根内、指令进入任务上下文", () => {
    const project = store!.createProject({
      title: "热电项目",
      instructions: "引用文献必须给页码。",
      workspace_roots: [workspace],
      data_policy: "cloud",
    });
    expect(store!.listProjects()).toHaveLength(1);
    expect(JSON.parse(project.workspace_roots_json)).toEqual([fs.realpathSync(workspace)]);
    const task = store!.createTask({
      title: "周报",
      objective: "整理本周热电实验",
      workspace_root: workspace,
      project_id: project.id,
    });
    expect(task.project_id).toBe(project.id);
    expect(task.data_policy).toBe("cloud");
    const inputs = JSON.parse(task.inputs_json) as Record<string, unknown>;
    expect((inputs.project as Record<string, unknown>).instructions).toContain("页码");

    expect(() => store!.createTask({
      title: "越界",
      objective: "不该创建",
      workspace_root: outside,
      project_id: project.id,
    })).toThrow(CoworkValidationError);

    const other = store!.createProject({ title: "另一个项目", workspace_roots: [outside] });
    expect(store!.listTasks(other.id)).toHaveLength(0);
    expect(store!.listTasks(project.id)).toHaveLength(1);
  });

  test("资产只接受项目根或资产目录内的文件，可加入待启动任务", () => {
    const project = store!.createProject({ title: "资产项目", workspace_roots: [workspace] });
    const insideFile = path.join(workspace, "paper.pdf");
    fs.writeFileSync(insideFile, "pdf");
    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "no");
    const asset = store!.addProjectAsset(project.id, { path: insideFile, label: "论文" });
    expect(asset.source).toBe("workspace");
    expect(asset.size_bytes).toBe(3);

    expect(() => store!.addProjectAsset(project.id, { path: outsideFile })).toThrow(CoworkValidationError);
    fs.mkdirSync(coworkProjectAssetsRoot(project.id), { recursive: true });
    const generated = path.join(coworkProjectAssetsRoot(project.id), "report.docx");
    fs.writeFileSync(generated, "doc");
    expect(store!.addProjectAsset(project.id, { path: generated }).source).toBe("project");
    expect(() => store!.addProjectAsset(project.id, { path: insideFile })).toThrow(CoworkConflictError);

    const task = store!.createTask({
      title: "引用资产",
      objective: "读取论文",
      workspace_root: workspace,
      project_id: project.id,
    });
    const updated = store!.attachAssetToTask(project.id, asset.id, task.id);
    const inputs = JSON.parse(updated.inputs_json) as Record<string, unknown>;
    const firstAsset = (inputs.assets as Array<Record<string, unknown>>)[0];
    expect(firstAsset?.path).toBe(fs.realpathSync(insideFile));

    store!.transitionTask(task.id, "planning");
    expect(() => store!.attachAssetToTask(project.id, asset.id, task.id)).toThrow(CoworkConflictError);
  });

  test("项目记忆按项目隔离；写入不自动发生", () => {
    const p1 = store!.createProject({ title: "P1" });
    const p2 = store!.createProject({ title: "P2" });
    expect(listProjectMemories(p1.id)).toHaveLength(0);
    addProjectMemory(p1.id, "P1 的结论：样品 A 热导率 40。");
    expect(listProjectMemories(p1.id)).toHaveLength(1);
    expect(listProjectMemories(p2.id)).toHaveLength(0);
  });
});

describe("cron（C3.3）", () => {
  test("每周一 9 点按上海时区换算，非法表达式/时区拒绝", () => {
    const next = nextCronRun("0 9 * * 1", "Asia/Shanghai", new Date("2026-11-22T02:00:00Z"));
    expect(next?.toISOString()).toBe("2026-11-23T01:00:00.000Z");
    expect(() => parseCron("0 9 * *")).toThrow();
    expect(() => parseCron("0 9 1 * 9")).toThrow();
    expect(() => validateTimezone("Mars/Olympus")).toThrow();
  });

  test("列表与步长", () => {
    expect(() => parseCron("*/15 9-11 * * 1-5")).not.toThrow();
    expect(() => parseCron("0 0 31 2 *")).not.toThrow();
  });
});

describe("本地调度器（C3.3）", () => {
  function makeScheduler(calls: string[], opts: { fail?: boolean } = {}): CoworkScheduler {
    const orchestrator = {
      startTask: async (taskId: string) => {
        calls.push(taskId);
        if (opts.fail) throw new Error("model down");
        return { task: store!.getTask(taskId), run_id: `run-${calls.length}` };
      },
    } as unknown as CoworkOrchestrator;
    return new CoworkScheduler({
      store: () => store!,
      orchestrator: () => orchestrator,
      db: db!,
      ownsDb: false,
    });
  }

  test("到期触发一次且写 next_run_at；重叠时跳过并记事件", async () => {
    const task = store!.createTask({ title: "周报", objective: "写周报", workspace_root: workspace });
    const calls: string[] = [];
    scheduler = makeScheduler(calls);
    const schedule = scheduler.create({
      task_id: task.id,
      cron: "* * * * *",
      timezone: "Asia/Shanghai",
    });
    db!.query("UPDATE cowork_schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-11-22T01:00:00.000Z", schedule.id);
    await scheduler.tick(new Date("2026-11-22T01:00:30.000Z"));
    expect(calls).toEqual([task.id]);
    const after = scheduler.get(schedule.id);
    expect(after.last_status).toBe("triggered");
    expect(new Date(after.next_run_at!).getTime()).toBeGreaterThan(new Date("2026-11-22T01:00:30.000Z").getTime());
    expect(store!.listEvents(task.id).map((event) => event.type)).toContain("cowork.schedule.triggered");

    const task2 = store!.createTask({ title: "运行中", objective: "长任务", workspace_root: workspace });
    store!.transitionTask(task2.id, "planning");
    const calls2: string[] = [];
    scheduler.stop();
    scheduler = makeScheduler(calls2);
    const schedule2 = scheduler.create({ task_id: task2.id, cron: "* * * * *" });
    db!.query("UPDATE cowork_schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-11-22T01:00:00.000Z", schedule2.id);
    await scheduler.tick(new Date("2026-11-22T01:00:30.000Z"));
    expect(calls2).toEqual([]);
    expect(scheduler.get(schedule2.id).last_status).toBe("skipped_overlap");
    expect(store!.listEvents(task2.id).map((event) => event.type)).toContain("cowork.schedule.skipped");
  });

  test("重启补跑策略：skip 超过 24h 跳过，run_once 只补一次", async () => {
    const task = store!.createTask({ title: "补跑", objective: "o", workspace_root: workspace });
    const calls: string[] = [];
    scheduler = makeScheduler(calls);
    const skipped = scheduler.create({
      task_id: task.id,
      cron: "0 9 * * *",
      missed_policy: "skip",
    });
    db!.query("UPDATE cowork_schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-11-19T01:00:00.000Z", skipped.id);
    await scheduler.tick(new Date("2026-11-22T01:00:00.000Z"));
    expect(calls).toEqual([]);
    expect(scheduler.get(skipped.id).last_status).toBe("skipped_missed");

    scheduler.stop();
    const task2 = store!.createTask({ title: "补跑一次", objective: "o", workspace_root: workspace });
    const calls2: string[] = [];
    scheduler = makeScheduler(calls2);
    const once = scheduler.create({
      task_id: task2.id,
      cron: "0 9 * * *",
      missed_policy: "run_once",
    });
    db!.query("UPDATE cowork_schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-11-19T01:00:00.000Z", once.id);
    await scheduler.tick(new Date("2026-11-22T01:00:00.000Z"));
    expect(calls2).toEqual([task2.id]);
    expect(scheduler.get(once.id).last_status).toBe("triggered");
    await scheduler.tick(new Date("2026-11-22T01:00:10.000Z"));
    expect(calls2).toEqual([task2.id]);
  });

  test("最多 20 个活动定时；失败记 last_error", async () => {
    const task = store!.createTask({ title: "上限", objective: "o", workspace_root: workspace });
    const calls: string[] = [];
    scheduler = makeScheduler(calls);
    for (let index = 0; index < 20; index += 1) {
      scheduler.create({ task_id: task.id, cron: "0 9 * * *" });
    }
    expect(() => scheduler!.create({ task_id: task.id, cron: "0 9 * * *" })).toThrow(CoworkValidationError);

    scheduler.stop();
    db!.query("UPDATE cowork_schedules SET enabled = 0").run();
    const task2 = store!.createTask({ title: "失败", objective: "o", workspace_root: workspace });
    const calls2: string[] = [];
    scheduler = makeScheduler(calls2, { fail: true });
    const schedule = scheduler.create({ task_id: task2.id, cron: "* * * * *" });
    db!.query("UPDATE cowork_schedules SET next_run_at = ? WHERE id = ?")
      .run("2026-11-22T01:00:00.000Z", schedule.id);
    await scheduler.tick(new Date("2026-11-22T01:00:30.000Z"));
    expect(scheduler.get(schedule.id).last_status).toBe("failed");
    expect(scheduler.get(schedule.id).last_error).toContain("model down");
  });
});

describe("连接器注册表（C3.5）", () => {
  test("未配置明确未连接；有项目/工作区后连接；写入默认审批", () => {
    const registry = new ConnectorRegistry({ store: () => store! });
    const empty = registry.list();
    expect(empty.recipes).toHaveLength(3);
    expect(empty.connectors.find((item) => item.id === "project-assets")?.status).toBe("unconfigured");
    expect(empty.connectors.find((item) => item.id === "mcp")?.write).toBe("approval");
    expect(empty.connectors.find((item) => item.id === "web")?.configured).toBe(true);

    store!.createProject({ title: "已建项目", workspace_roots: [workspace] });
    const filled = registry.list();
    expect(filled.connectors.find((item) => item.id === "project-assets")?.status).toBe("connected");
  });
});
