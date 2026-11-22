/** Cowork 存储层的路径、状态机常量与通用小工具（M3 拆分，纯函数，不持有 DB）。 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  MAXMA_PERMISSION_MODES,
  type MaxmaPermissionMode,
} from "../../../bun-sidecar/src/kernel/pi-contract";
import { getApiDataDir } from "../app-paths";
import { CoworkValidationError } from "./cowork-errors";
import type { CoworkRunStatus, CoworkTaskStatus } from "./cowork-status";

export const TASK_TRANSITIONS: Record<CoworkTaskStatus, CoworkTaskStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_plan", "running", "paused", "failed", "cancelled"],
  awaiting_plan: ["running", "planning", "paused", "failed", "cancelled"],
  running: ["awaiting_plan", "awaiting_approval", "paused", "review", "failed", "cancelled"],
  awaiting_approval: ["running", "paused", "failed", "cancelled"],
  paused: ["running", "planning", "cancelled"],
  review: ["completed", "planning", "cancelled"],
  completed: ["planning"],
  failed: ["planning", "cancelled"],
  cancelled: ["planning"],
};

export const RUN_TRANSITIONS: Record<CoworkRunStatus, CoworkRunStatus[]> = {
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["running"],
  cancelled: [],
};

export function coworkTaskRoot(): string {
  return path.join(getApiDataDir(), "cowork", "tasks");
}

export function coworkTaskStagingRoot(taskId: string): string {
  return path.join(coworkTaskRoot(), taskId, "staging");
}

/**
 * 每个交付物版本独立保存一份字节快照，避免同路径覆盖后历史版本只剩 sha256。
 * 目录放在任务根下、staging 之外；下载路由按 artifact id 取快照，不依赖 DB 新列。
 */
export function coworkArtifactSnapshotPath(taskId: string, artifactId: string, sourcePath: string): string {
  return path.join(coworkTaskRoot(), taskId, "artifact-versions", artifactId, path.basename(sourcePath));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function isPermissionMode(value: string | undefined): value is MaxmaPermissionMode {
  return typeof value === "string" && (MAXMA_PERMISSION_MODES as readonly string[]).includes(value);
}

export function normalizeWorkspaceRoot(raw: string): string {
  if (!path.isAbsolute(raw)) {
    throw new CoworkValidationError("workspace_root 必须是绝对路径");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(raw);
  } catch {
    throw new CoworkValidationError("workspace_root 不存在或不可访问");
  }
  if (!stat.isDirectory()) throw new CoworkValidationError("workspace_root 必须是文件夹");
  return fs.realpathSync(raw);
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
