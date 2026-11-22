/**
 * Cowork 项目、资产与项目事件（M3-B）。
 *
 * 单独成文件的原因：`cowork-store.ts` 已接近体量棘轮上限。这里只操作项目表、
 * 项目资产与项目事件日志；任务仍由 `CoworkStore` 持有，通过 context 回调读写，
 * 避免两个模块各自维护一套任务状态。
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Database } from "bun:sqlite";

import { getApiDataDir } from "../app-paths";
import {
  CoworkConflictError,
  CoworkNotFoundError,
  CoworkValidationError,
} from "./cowork-errors";
import type { CoworkEvent, CoworkProject, CoworkProjectAsset, CoworkTask } from "./cowork-store";

export interface CoworkProjectContext {
  db: Database;
  getTask: (taskId: string) => CoworkTask;
  appendEvent: (taskId: string, runId: string | null, type: string, payload: Record<string, unknown>) => CoworkEvent;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function coworkProjectAssetsRoot(projectId: string): string {
  return path.join(getApiDataDir(), "cowork", "projects", projectId, "assets");
}

export function normalizeWorkspaceRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && path.isAbsolute(item))
    .map((item) => path.resolve(item)))]
    .slice(0, 10);
}

export function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function listProjects(db: Database): CoworkProject[] {
  return db
    .query("SELECT * FROM cowork_projects ORDER BY updated_at DESC")
    .all() as CoworkProject[];
}

export function getProject(db: Database, projectId: string): CoworkProject {
  const row = db
    .query("SELECT * FROM cowork_projects WHERE id = ?")
    .get(projectId) as CoworkProject | null;
  if (!row) throw new CoworkNotFoundError(`项目不存在：${projectId}`);
  return row;
}

export function createProject(db: Database, input: {
  title: string;
  instructions?: string;
  workspace_roots?: unknown;
  default_template_ids?: unknown;
  model_policy?: Record<string, unknown>;
  data_policy?: string;
}): CoworkProject {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new CoworkValidationError("项目标题不能为空");
  const instructions = (input.instructions ?? "").trim().slice(0, 20_000);
  const roots = normalizeWorkspaceRoots(input.workspace_roots ?? []);
  const templates = Array.isArray(input.default_template_ids)
    ? input.default_template_ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 200))
      .slice(0, 50)
    : [];
  const modelPolicy = input.model_policy && typeof input.model_policy === "object"
    && !Array.isArray(input.model_policy)
    ? input.model_policy as Record<string, unknown>
    : {};
  const dataPolicy = input.data_policy === "cloud" ? "cloud" : "local_only";
  const id = crypto.randomUUID();
  fs.mkdirSync(coworkProjectAssetsRoot(id), { recursive: true });
  const createdAt = nowIso();
  db
    .query(
      `INSERT INTO cowork_projects
        (id, title, instructions, workspace_roots_json, default_template_ids_json,
         model_policy_json, data_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      instructions,
      JSON.stringify(roots),
      JSON.stringify(templates),
      JSON.stringify(modelPolicy),
      dataPolicy,
      createdAt,
      createdAt,
    );
  return getProject(db, id);
}

export function updateProject(db: Database, projectId: string, patch: {
  title?: string;
  instructions?: string;
  workspace_roots?: unknown;
  default_template_ids?: unknown;
  model_policy?: Record<string, unknown>;
  data_policy?: string;
}): CoworkProject {
  const project = getProject(db, projectId);
  const title = patch.title === undefined ? project.title : patch.title.trim().slice(0, 200);
  if (!title) throw new CoworkValidationError("项目标题不能为空");
  const instructions = patch.instructions === undefined
    ? project.instructions
    : patch.instructions.trim().slice(0, 20_000);
  const roots = patch.workspace_roots === undefined
    ? project.workspace_roots_json
    : JSON.stringify(normalizeWorkspaceRoots(patch.workspace_roots));
  const templates = patch.default_template_ids === undefined
    ? project.default_template_ids_json
    : JSON.stringify(
      Array.isArray(patch.default_template_ids)
        ? patch.default_template_ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 200))
          .slice(0, 50)
        : [],
    );
  const modelPolicy = patch.model_policy === undefined
    ? project.model_policy_json
    : JSON.stringify(patch.model_policy ?? {});
  const dataPolicy = patch.data_policy === undefined
    ? project.data_policy
    : patch.data_policy === "cloud" ? "cloud" : "local_only";
  db
    .query(
      `UPDATE cowork_projects
       SET title = ?, instructions = ?, workspace_roots_json = ?, default_template_ids_json = ?,
           model_policy_json = ?, data_policy = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(title, instructions, roots, templates, modelPolicy, dataPolicy, nowIso(), projectId);
  return getProject(db, projectId);
}

export function listProjectAssets(db: Database, projectId: string): CoworkProjectAsset[] {
  getProject(db, projectId);
  return db
    .query("SELECT * FROM cowork_project_assets WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as CoworkProjectAsset[];
}

export function addProjectAsset(db: Database, projectId: string, input: { path: string; label?: string }): CoworkProjectAsset {
  const project = getProject(db, projectId);
  const raw = input.path.trim();
  if (!raw || !path.isAbsolute(raw)) throw new CoworkValidationError("资产路径必须是绝对路径");
  let candidate: string;
  let stat: fs.Stats;
  try {
    candidate = fs.realpathSync(raw);
    stat = fs.statSync(candidate);
  } catch {
    throw new CoworkValidationError("资产不存在或不可访问");
  }
  if (!stat.isFile()) throw new CoworkValidationError("资产必须是文件");
  if (stat.size > 2_000_000_000) throw new CoworkValidationError("资产超过 2GB");
  const assetRoot = fs.realpathSync(coworkProjectAssetsRoot(projectId));
  const roots = (JSON.parse(project.workspace_roots_json) as string[])
    .map((root) => {
      try {
        return fs.realpathSync(root);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const source = isPathInside(assetRoot, candidate)
    ? "project"
    : roots.some((root) => isPathInside(root, candidate))
      ? "workspace"
      : "";
  if (!source) throw new CoworkValidationError("资产必须位于项目工作区或项目资产目录内");
  const existing = db
    .query("SELECT id FROM cowork_project_assets WHERE project_id = ? AND path = ?")
    .get(projectId, candidate) as { id: string } | null;
  if (existing) throw new CoworkConflictError("该资产已在项目中");
  const id = crypto.randomUUID();
  const label = (input.label ?? "").trim().slice(0, 200) || path.basename(candidate);
  const createdAt = nowIso();
  db
    .query(
      `INSERT INTO cowork_project_assets
        (id, project_id, path, label, source, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, candidate, label, source, stat.size, createdAt);
  appendProjectEvent(projectId, "cowork.project.asset.added", { label, path: candidate });
  return getProjectAsset(db, projectId, id);
}

export function getProjectAsset(db: Database, projectId: string, assetId: string): CoworkProjectAsset {
  const row = db
    .query("SELECT * FROM cowork_project_assets WHERE id = ? AND project_id = ?")
    .get(assetId, projectId) as CoworkProjectAsset | null;
  if (!row) throw new CoworkNotFoundError("项目资产不存在");
  return row;
}

export function removeProjectAsset(db: Database, projectId: string, assetId: string): void {
  const asset = getProjectAsset(db, projectId, assetId);
  db
    .query("DELETE FROM cowork_project_assets WHERE id = ? AND project_id = ?")
    .run(assetId, projectId);
  appendProjectEvent(projectId, "cowork.project.asset.removed", {
    label: asset.label,
    path: asset.path,
  });
}

export function attachAssetToTask(ctx: CoworkProjectContext, projectId: string, assetId: string, taskId: string): CoworkTask {
  const asset = getProjectAsset(ctx.db, projectId, assetId);
  const task = ctx.getTask(taskId);
  if (task.project_id !== projectId) throw new CoworkValidationError("任务不属于该项目");
  if (task.status !== "draft") throw new CoworkConflictError("只有待启动任务可以加入输入资产");
  let inputs: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(task.inputs_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) inputs = parsed;
  } catch {
    inputs = {};
  }
  const existing = Array.isArray(inputs.assets) ? inputs.assets : [];
  const deduped = existing.filter((item) => {
    return !(item && typeof item === "object" && (item as Record<string, unknown>).path === asset.path);
  });
  inputs.assets = [...deduped, {
    asset_id: asset.id,
    path: asset.path,
    label: asset.label,
    source: asset.source,
  }].slice(-50);
  ctx.db
    .query("UPDATE cowork_tasks SET inputs_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(inputs), nowIso(), taskId);
  ctx.appendEvent(taskId, null, "cowork.task.inputs.updated", {
    asset_id: asset.id,
    label: asset.label,
  });
  appendProjectEvent(projectId, "cowork.project.asset.attached", {
    asset_id: asset.id,
    task_id: taskId,
  });
  return ctx.getTask(taskId);
}

/**
 * 项目级事件不能写 `cowork_task_events`（task_id 非空），也没有任务可借；
 * 单独写项目目录下的 events.jsonl，活动流不会把项目事件错误算到某条任务上。
 */
function appendProjectEvent(projectId: string, type: string, payload: Record<string, unknown>): void {
  const dir = path.join(getApiDataDir(), "cowork", "projects", projectId);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    type,
    project_id: projectId,
    payload,
    created_at: nowIso(),
  });
  fs.appendFileSync(path.join(dir, "events.jsonl"), `${line}\n`);
}

export function listProjectEvents(projectId: string, limit = 50): Array<Record<string, unknown>> {
  const file = path.join(getApiDataDir(), "cowork", "projects", projectId, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-Math.max(1, limit));
  return lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}
