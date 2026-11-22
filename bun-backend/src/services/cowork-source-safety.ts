/**
 * M4-C 源文件安全：staging 产物落到工作区时绝不静默覆盖。
 *
 * 规则：
 * - 目标必须在任务 workspace_root 内（realpath 比较，符号链接不能越界）。
 * - 同名文件自动得到 `name.vN.ext`，永不覆盖已有文件。
 * - 每次写入前把写入后的字节留在数据目录的 file-backups，并登记 DB。
 * - 恢复前先把当前目标文件备份为 `pre_restore`，再原子替换；恢复后校验 sha256。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";

import {
  CoworkConflictError,
  CoworkNotFoundError,
  CoworkValidationError,
  coworkArtifactSnapshotPath,
  type CoworkArtifact,
  type CoworkTask,
} from "./cowork-store";
import { isPathInside } from "./cowork-project-store";
import { coworkTaskRoot, nowIso, sha256File } from "./cowork-store-support";

export interface CoworkFileBackup {
  id: string;
  task_id: string;
  artifact_id: string | null;
  original_path: string;
  backup_path: string;
  sha256: string;
  size_bytes: number;
  reason: string;
  created_at: string;
  restored_at: string | null;
}

export interface ExportArtifactResult {
  path: string;
  backup_id: string;
  versioned: boolean;
  sha256: string;
  size_bytes: number;
}

function emptyDir(pathValue: string): void {
  fs.mkdirSync(pathValue, { recursive: true });
}

function isFile(pathValue: string): boolean {
  try {
    return fs.statSync(pathValue).isFile();
  } catch {
    return false;
  }
}

function uniqueTarget(target: string): string {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const base = ext ? target.slice(0, -ext.length) : target;
  for (let version = 2; version < 10_000; version += 1) {
    const candidate = `${base}.v${version}${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new CoworkConflictError("同名文件版本过多，无法安全写入");
}

function copyAtomic(source: string, target: string): void {
  const tmp = `${target}.tmp-${crypto.randomUUID()}`;
  fs.copyFileSync(source, tmp);
  try {
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // 清理失败不掩盖主错误
    }
    throw err;
  }
}

function backupRootForTask(taskId: string): string {
  return path.join(coworkTaskRoot(), taskId, "file-backups");
}

function artifactSnapshot(task: CoworkTask, artifact: CoworkArtifact): string {
  if (artifact.task_id !== task.id) throw new CoworkNotFoundError("交付物不属于该任务");
  const staging = path.resolve(task.staging_root);
  const artifactPath = path.resolve(artifact.path);
  const rel = path.relative(staging, artifactPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new CoworkNotFoundError("交付物不在任务 staging 内");
  }
  const snapshot = coworkArtifactSnapshotPath(task.id, artifact.id, artifact.path);
  const source = isFile(snapshot) ? snapshot : artifactPath;
  if (!isFile(source)) throw new CoworkNotFoundError("交付物文件已不存在");
  return source;
}

/**
 * 只做目标校验，不写盘；用于导出审批卡展示“将写到哪里”。
 * requestedTarget 可以是目录（保留原文件名）或完整文件路径。
 */
export function previewExportTarget(task: CoworkTask, artifact: CoworkArtifact, requestedTarget = ""): {
  directory: string;
  filename: string;
  resolved: string;
  versioned: boolean;
} {
  const root = fs.realpathSync(task.workspace_root);
  const rawTarget = (requestedTarget || root).trim();
  if (!rawTarget) throw new CoworkValidationError("导出目标不能为空");
  const absolute = path.resolve(rawTarget);
  const looksLikeDir = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() || !path.extname(absolute);
  const directory = looksLikeDir ? absolute : path.dirname(absolute);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new CoworkValidationError("导出目标目录不存在");
  }
  const realDirectory = fs.realpathSync(directory);
  if (!isPathInside(root, realDirectory)) {
    throw new CoworkValidationError("导出目标必须位于任务工作区内");
  }
  const filename = looksLikeDir ? path.basename(artifact.path) : path.basename(absolute);
  if (!filename || filename === "." || filename === "..") throw new CoworkValidationError("导出文件名无效");
  const resolved = path.join(realDirectory, filename);
  return { directory: realDirectory, filename, resolved, versioned: fs.existsSync(resolved) };
}

function recordBackup(db: Database, input: {
  taskId: string;
  artifactId: string | null;
  originalPath: string;
  sourceFile: string;
  reason: string;
}): CoworkFileBackup {
  const id = crypto.randomUUID();
  const dir = path.join(backupRootForTask(input.taskId), id);
  emptyDir(dir);
  const backupPath = path.join(dir, path.basename(input.sourceFile));
  fs.copyFileSync(input.sourceFile, backupPath);
  const sha256 = sha256File(backupPath);
  const sizeBytes = fs.statSync(backupPath).size;
  const now = nowIso();
  db.query(
    `INSERT INTO cowork_file_backups
      (id, task_id, artifact_id, original_path, backup_path, sha256, size_bytes, reason, created_at, restored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.taskId,
    input.artifactId,
    input.originalPath,
    backupPath,
    sha256,
    sizeBytes,
    input.reason,
    now,
  );
  return {
    id,
    task_id: input.taskId,
    artifact_id: input.artifactId,
    original_path: input.originalPath,
    backup_path: backupPath,
    sha256,
    size_bytes: sizeBytes,
    reason: input.reason,
    created_at: now,
    restored_at: null,
  };
}

export function exportArtifactToWorkspace(
  db: Database,
  task: CoworkTask,
  artifact: CoworkArtifact,
  requestedTarget = "",
): ExportArtifactResult {
  const target = previewExportTarget(task, artifact, requestedTarget);
  const source = artifactSnapshot(task, artifact);
  const finalTarget = uniqueTarget(target.resolved);
  const backup = recordBackup(db, {
    taskId: task.id,
    artifactId: artifact.id,
    originalPath: finalTarget,
    sourceFile: source,
    reason: "export",
  });
  copyAtomic(source, finalTarget);
  const sha256 = sha256File(finalTarget);
  if (sha256 !== sha256File(source)) {
    throw new CoworkConflictError("导出后校验失败：目标字节与产物不一致");
  }
  return {
    path: finalTarget,
    backup_id: backup.id,
    versioned: finalTarget !== target.resolved,
    sha256,
    size_bytes: fs.statSync(finalTarget).size,
  };
}

export function listFileBackups(db: Database, taskId: string, limit = 50): CoworkFileBackup[] {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return db
    .query("SELECT * FROM cowork_file_backups WHERE task_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(taskId, safeLimit) as CoworkFileBackup[];
}

export function getFileBackup(db: Database, backupId: string): CoworkFileBackup {
  const row = db.query("SELECT * FROM cowork_file_backups WHERE id = ?").get(backupId) as CoworkFileBackup | null;
  if (!row) throw new CoworkNotFoundError("文件备份不存在");
  return row;
}

export function restoreFileBackup(db: Database, backupId: string): CoworkFileBackup {
  const backup = getFileBackup(db, backupId);
  if (!isFile(backup.backup_path)) throw new CoworkNotFoundError("备份文件已不存在");
  if (sha256File(backup.backup_path) !== backup.sha256) {
    throw new CoworkConflictError("备份文件校验失败，拒绝恢复");
  }
  // 恢复本身也是写：先备份当前文件，保证“恢复”动作也能回滚。
  if (isFile(backup.original_path)) {
    recordBackup(db, {
      taskId: backup.task_id,
      artifactId: backup.artifact_id,
      originalPath: backup.original_path,
      sourceFile: backup.original_path,
      reason: "pre_restore",
    });
  }
  emptyDir(path.dirname(backup.original_path));
  copyAtomic(backup.backup_path, backup.original_path);
  if (sha256File(backup.original_path) !== backup.sha256) {
    throw new CoworkConflictError("恢复后校验失败：目标字节与备份不一致");
  }
  db.query("UPDATE cowork_file_backups SET restored_at = ? WHERE id = ?").run(nowIso(), backup.id);
  return getFileBackup(db, backup.id);
}

/** 删除审批只允许删任务 staging 内的产物；文件移入任务 trash，不直接抹掉。 */
export function deleteStagedArtifact(
  db: Database,
  task: CoworkTask,
  artifact: CoworkArtifact,
): { trashed_to: string } {
  if (artifact.task_id !== task.id) throw new CoworkNotFoundError("交付物不属于该任务");
  const staging = path.resolve(task.staging_root);
  const original = path.resolve(artifact.path);
  const rel = path.relative(staging, original);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new CoworkNotFoundError("交付物不在任务 staging 内");
  }
  // 删除的是 staging 里的真实产物；artifact-versions 快照保留作为审计证据。
  const source = isFile(original) ? original : artifactSnapshot(task, artifact);
  const trashDir = path.join(coworkTaskRoot(), task.id, "trash");
  fs.mkdirSync(trashDir, { recursive: true });
  const target = uniqueTarget(path.join(trashDir, `${artifact.id}-${path.basename(artifact.path)}`));
  fs.renameSync(source, target);
  // 同一产物的历史版本也一并标记 deleted，避免详情页在删除后仍展示旧版本。
  db.query("UPDATE cowork_artifacts SET status = 'deleted' WHERE task_id = ? AND path = ?").run(
    task.id,
    artifact.path,
  );
  return { trashed_to: target };
}
