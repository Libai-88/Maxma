/**
 * Cowork 任务域单测（M1 / DB v11）。
 *
 * 锁的是任务表作为唯一状态源：状态白名单、staging 边界、事件游标、审批过期、
 * 重启恢复。所有断言都直接读同一个 SQLite 文件，不用内存桩替代持久化。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";
import {
  CoworkConflictError,
  CoworkStore,
  CoworkValidationError,
  coworkArtifactSnapshotPath,
  coworkTaskStagingRoot,
} from "../src/services/cowork-store";

let dataDir = "";
let prevDataDir: string | undefined;
let workspace = "";
let store: CoworkStore | null = null;

beforeEach(async () => {
  dataDir = makeTempDataDir("maxma-cowork-store");
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  workspace = path.join(dataDir, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const { initializeDatabase, resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  initializeDatabase();
  store = new CoworkStore();
});

afterEach(async () => {
  if (store) {
    store.close();
    store = null;
  }
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  removeTempDataDir(dataDir);
});

describe("CoworkStore 任务创建与状态机", () => {
  test("相对路径/不存在路径拒绝；合法路径 realpath 后入库，staging 固定在数据目录", () => {
    expect(() => store!.createTask({ title: "x", objective: "y", workspace_root: "relative" }))
      .toThrow(CoworkValidationError);
    expect(() => store!.createTask({ title: "x", objective: "y", workspace_root: path.join(dataDir, "missing") }))
      .toThrow(CoworkValidationError);

    const task = store!.createTask({
      title: "  季度复盘  ",
      objective: "  产出一页复盘  ",
      workspace_root: workspace,
      permission_mode: "auto",
    });
    expect(task.title).toBe("季度复盘");
    expect(task.objective).toBe("产出一页复盘");
    expect(task.status).toBe("draft");
    expect(task.workspace_root).toBe(fs.realpathSync(workspace));
    expect(task.staging_root).toBe(coworkTaskStagingRoot(task.id));
    expect(fs.statSync(task.staging_root).isDirectory()).toBe(true);
    expect(task.permission_mode).toBe("auto");

    const events = store!.listEvents(task.id);
    expect(events.map((e) => e.type)).toContain("cowork.task.created");
  });

  test("非法状态跳转抛 409，不写脏状态；合法路径可推进", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    expect(() => store!.transitionTask(task.id, "running")).toThrow(CoworkConflictError);
    expect(store!.getTask(task.id).status).toBe("draft");

    store!.transitionTask(task.id, "planning");
    store!.transitionTask(task.id, "awaiting_plan");
    store!.transitionTask(task.id, "running");
    store!.transitionTask(task.id, "awaiting_plan");
    expect(store!.getTask(task.id).status).toBe("awaiting_plan");
  });

  test("createRun 生成 32 位 hex session_id、attempt 递增，事件可回放", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    store!.transitionTask(task.id, "planning");
    const run1 = store!.createRun(task.id);
    const after1 = store!.getTask(task.id);
    expect(after1.session_id).toMatch(/^[a-f0-9]{32}$/);
    expect(run1.attempt).toBe(1);

    const run2 = store!.createRun(task.id);
    expect(run2.attempt).toBe(2);
    expect(store!.getLatestRun(task.id)?.id).toBe(run2.id);
    expect(store!.getTask(task.id).session_id).toBe(after1.session_id);

    // 失败/取消后的重跑要换新会话，避免复用上一轮仍可能在途的 prompt。
    const run3 = store!.createRun(task.id, { freshSession: true });
    expect(run3.attempt).toBe(3);
    expect(store!.getTask(task.id).session_id).not.toBe(after1.session_id);
    expect(store!.getTask(task.id).session_id).toMatch(/^[a-f0-9]{32}$/);

    const events = store!.listEvents(task.id, 0, 500);
    expect(events.filter((e) => e.type === "cowork.run.started").length).toBe(3);
    const firstEvent = events[0]!;
    const replayed = store!.listEvents(task.id, firstEvent.id, 500);
    expect(replayed.every((e) => e.id > firstEvent.id)).toBe(true);
  });
});

describe("CoworkStore 步骤、产物与审批", () => {
  test("步骤按 seq upsert；产物记录 SHA-256/size/version", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    store!.transitionTask(task.id, "planning");
    const run = store!.createRun(task.id);

    store!.upsertStep({ runId: run.id, seq: 1, label: "收集资料", status: "completed" });
    store!.upsertStep({ runId: run.id, seq: 2, label: "写初稿", status: "running" });
    store!.upsertStep({ runId: run.id, seq: 1, label: "收集资料（2 篇）", status: "completed" });
    const steps = store!.getSteps(run.id);
    expect(steps.map((s) => s.seq)).toEqual([1, 2]);
    expect(steps[0]!.label).toBe("收集资料（2 篇）");

    const output = path.join(task.staging_root, "复盘.md");
    fs.writeFileSync(output, "# 复盘\n", "utf8");
    const a1 = store!.addArtifact({ taskId: task.id, runId: run.id, path: output, kind: "markdown" });
    expect(a1.version).toBe(1);
    expect(a1.size_bytes).toBe(Buffer.byteLength("# 复盘\n"));
    expect(a1.sha256).toMatch(/^[a-f0-9]{64}$/);

    fs.writeFileSync(output, "# 复盘 v2\n", "utf8");
    const a2 = store!.addArtifact({ taskId: task.id, runId: run.id, path: output, kind: "markdown" });
    expect(a2.version).toBe(2);
    expect(a2.sha256).not.toBe(a1.sha256);

    // v1 的字节快照必须独立于同路径覆盖；否则历史版本只剩一条 sha256 记录。
    const v1Snapshot = coworkArtifactSnapshotPath(task.id, a1.id, output);
    expect(fs.readFileSync(v1Snapshot, "utf8")).toBe("# 复盘\n");
    const v2Snapshot = coworkArtifactSnapshotPath(task.id, a2.id, output);
    expect(fs.readFileSync(v2Snapshot, "utf8")).toBe("# 复盘 v2\n");
  });

  test("产物只能登记在任务 staging 内（源工作区文件不可被当成交付物）", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    const outside = path.join(workspace, "secret.txt");
    fs.writeFileSync(outside, "source", "utf8");
    expect(() => store!.addArtifact({ taskId: task.id, runId: null, path: outside, kind: "text" }))
      .toThrow(CoworkValidationError);
  });

  test("审批 pending → resolved 只能一次；过期扫描写 expired 事件", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    const approval = store!.createApproval({
      taskId: task.id,
      runId: null,
      kind: "plan",
      payload: { plan: "1. 写" },
      ttlMs: 60_000,
    });
    expect(store!.getPendingApprovals(task.id).length).toBe(1);
    const resolved = store!.resolveApproval(approval.id, "approved", "ok");
    expect(resolved.status).toBe("approved");
    expect(() => store!.resolveApproval(approval.id, "rejected")).toThrow(CoworkConflictError);
    expect(store!.getPendingApprovals(task.id).length).toBe(0);

    const expired = store!.createApproval({
      taskId: task.id,
      runId: null,
      kind: "tool",
      payload: { tool: "write_office_file" },
      ttlMs: 1,
    });
    const rows = store!.expirePendingApprovals(Date.now() + 10);
    expect(rows.map((r) => r.id)).toContain(expired.id);
    expect(store!.getApproval(expired.id).status).toBe("expired");
    const events = store!.listEvents(task.id).filter((e) => e.type === "cowork.approval.resolved");
    expect(events.length).toBe(2);
  });
});

describe("CoworkStore 重启恢复", () => {
  test("planning/awaiting_plan/running/awaiting_approval → paused；running run → paused，保留 checkpoint", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    store!.transitionTask(task.id, "planning");
    const run = store!.createRun(task.id);
    store!.transitionTask(task.id, "running");
    store!.upsertStep({ runId: run.id, seq: 1, label: "已做", status: "completed" });

    const count = store!.recoverInterruptedTasks();
    expect(count).toBe(1);
    const recovered = store!.getTaskDetail(task.id);
    expect(recovered.task.status).toBe("paused");
    expect(recovered.latest_run?.status).toBe("paused");
    const checkpoint = JSON.parse(recovered.latest_run!.checkpoint_json) as Record<string, unknown>;
    expect(checkpoint.reason).toBe("app_restart");
    expect(checkpoint.phase).toBe("running");
    expect(checkpoint.last_step_seq).toBe(1);
    expect(store!.listEvents(task.id).some((e) => e.type === "cowork.run.interrupted")).toBe(true);

    // 再跑一次必须幂等：paused 不在扫描集合里。
    expect(store!.recoverInterruptedTasks()).toBe(0);
  });

  test("等待计划审批时重启：保留 awaiting_plan phase 并结掉幽灵审批", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    store!.transitionTask(task.id, "planning");
    const run = store!.createRun(task.id);
    store!.transitionTask(task.id, "awaiting_plan");
    const approval = store!.createApproval({
      taskId: task.id,
      runId: run.id,
      kind: "plan",
      payload: { plan_id: "p1", plan_text: "1. 写" },
      ttlMs: 10 * 60_000,
    });
    expect(store!.getPendingApprovals(task.id).map((a) => a.id)).toContain(approval.id);

    expect(store!.recoverInterruptedTasks()).toBe(1);
    const recovered = store!.getTaskDetail(task.id);
    expect(recovered.task.status).toBe("paused");
    expect(recovered.latest_run?.status).toBe("paused");
    const checkpoint = JSON.parse(recovered.latest_run!.checkpoint_json) as Record<string, unknown>;
    expect(checkpoint.phase).toBe("awaiting_plan");
    expect(store!.getApproval(approval.id).status).toBe("expired");
    expect(store!.getPendingApprovals(task.id).length).toBe(0);
  });

  test("状态与审批短暂不一致：running + 待批计划也按 awaiting_plan 恢复", () => {
    const task = store!.createTask({ title: "t", objective: "o", workspace_root: workspace });
    store!.transitionTask(task.id, "planning");
    const run = store!.createRun(task.id);
    store!.transitionTask(task.id, "running");
    store!.createApproval({
      taskId: task.id,
      runId: run.id,
      kind: "plan",
      payload: { plan_id: "p2" },
      ttlMs: 10 * 60_000,
    });

    expect(store!.recoverInterruptedTasks()).toBe(1);
    const recovered = store!.getTaskDetail(task.id);
    const checkpoint = JSON.parse(recovered.latest_run!.checkpoint_json) as Record<string, unknown>;
    expect(checkpoint.phase).toBe("awaiting_plan");
    expect(recovered.task.status).toBe("paused");
  });
});
