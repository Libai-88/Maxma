/**
 * routes/cowork.ts — M1 任务域 REST + 任务级 SSE。
 *
 * 状态机与运行器在 services/cowork-*；本文件只做 HTTP 契约、错误映射与事件流。
 * SSE 先回放 DB 事件，再推实时事件；事件 id 是全局游标，断线重连不会丢任务状态。
 */

import type { Context } from "hono";
import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CoworkConflictError,
  CoworkNotFoundError,
  CoworkStore,
  CoworkValidationError,
  coworkArtifactSnapshotPath,
  type CoworkArtifact,
  type CoworkEvent,
  type CoworkTask,
} from "../services/cowork-store";
import { approvalView, listApprovals, batchableApprovals } from "../services/cowork-approval-center";
import { buildDeliveryPackage } from "../services/cowork-package";
import {
  deleteStagedArtifact,
  exportArtifactToWorkspace,
  listFileBackups,
  previewExportTarget,
  restoreFileBackup,
} from "../services/cowork-source-safety";
import { getConnection } from "../db/core";
import { CoworkOrchestrator } from "../services/cowork-orchestrator";
import { normalizeModelProfile, resolveCoworkModelRoute, type CoworkModelRoute } from "../services/cowork-model";

export interface CoworkRoutesDeps {
  /** 懒加载：只有真正访问 Cowork 路由时才打开任务库连接。 */
  store: () => CoworkStore;
  orchestrator: () => CoworkOrchestrator;
  enabled: () => boolean;
}

interface EventView extends CoworkEvent {
  payload: Record<string, unknown>;
}

function eventView(event: CoworkEvent): EventView {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.payload_json);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // 损坏事件不阻断流
  }
  return { ...event, payload };
}

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof CoworkNotFoundError) return c.json({ detail: err.message }, 404);
  if (err instanceof CoworkConflictError) return c.json({ detail: err.message }, 409);
  if (err instanceof CoworkValidationError) return c.json({ detail: err.message }, 400);
  return c.json({ detail: err instanceof Error ? err.message : String(err) }, 500);
}

function cleanText(value: unknown, max = 20_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 对外只暴露路由解释与成本，绝不返回 `params`（其中可能含解密后的 api_key）。 */
function publicModelRoute(route: CoworkModelRoute) {
  return {
    provider_id: route.provider_id,
    provider_label: route.provider_label,
    model: route.model,
    location: route.location,
    profile: route.profile,
    fit: route.fit,
    reason: route.reason,
    fallback: route.fallback,
    cost: route.cost,
  };
}

export function createCoworkRoutes(deps: CoworkRoutesDeps): Hono {
  const app = new Hono();
  const enabled = () => deps.enabled();
  const getStore = () => deps.store();
  const getOrchestrator = () => deps.orchestrator();

  app.get("/api/cowork/health", (c) => {
    const isEnabled = enabled();
    return c.json({
      enabled: isEnabled,
      tasks: isEnabled ? getStore().listTasks().length : 0,
      active_sessions: isEnabled ? getOrchestrator().activeSessionCount : 0,
    });
  });

  /**
   * 新建任务前的模型路由预检：只返回解释与成本，不落库、不发 prompt。
   * 任务已存在时以任务实际策略为准；否则用请求里的 project_id 约束数据边界。
   */
  app.post("/api/cowork/model-route/preview", async (c) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const taskId = cleanText(body.task_id, 200);
      const projectId = cleanText(body.project_id, 200);
      const task = taskId ? getStore().getTask(taskId) : null;
      const project = !task && projectId ? getStore().getProject(projectId) : null;
      const dataPolicy = task?.data_policy
        ?? (project?.data_policy === "local_only" ? "local_only" : cleanText(body.data_policy, 20) || "cloud");
      const rawPolicy = body.model_policy && typeof body.model_policy === "object" && !Array.isArray(body.model_policy)
        ? (body.model_policy as Record<string, unknown>)
        : {};
      const profile = dataPolicy === "local_only" ? "private" : normalizeModelProfile(rawPolicy.profile);
      const modelPolicyJson = task?.model_policy_json ?? JSON.stringify({ profile });
      const promptChars = Math.max(1, Math.min(200_000, Number(body.prompt_chars) || 1_000));
      const route = await resolveCoworkModelRoute({
        dataPolicy,
        modelPolicyJson,
        promptChars,
        longDocument: Boolean(body.long_document) || promptChars > 20_000,
      });
      return c.json({ route: publicModelRoute(route), data_policy: dataPolicy });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/approvals", (c) => {    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    const status = cleanText(c.req.query("status"), 20) || "pending";
    const taskId = cleanText(c.req.query("task_id"), 200) || undefined;
    const approvals = listApprovals(getConnection(), { status, taskId });
    return c.json({ approvals, batchable_count: approvals.filter((item) => item.batchable).length });
  });

  app.post("/api/cowork/approvals/batch", async (c) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => cleanText(id, 200)).filter(Boolean) : [];
      const safe = batchableApprovals(getConnection(), ids);
      for (const approval of safe) {
        await getOrchestrator().decideTool(approval.id, true, "批量批准低风险只读操作");
        getStore().appendEvent(approval.task_id, approval.run_id, "cowork.approval.batch", {
          approval_id: approval.id,
          tool_name: cleanText(approval.payload.tool_name, 100),
          message: "已批量批准低风险只读操作",
        });
      }
      return c.json({ approved: safe.length, approvals: safe });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/activity", (c) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    const limit = Number(c.req.query("limit") ?? 60);
    return c.json({ activity: getStore().listActivity(Number.isFinite(limit) ? limit : 60) });
  });

  app.use("/api/cowork/tasks/*", async (c, next) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });
  app.use("/api/cowork/approvals/*", async (c, next) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });

  app.get("/api/cowork/tasks", (c) => {
    return c.json({ tasks: getStore().listTasks(c.req.query("project_id") || undefined) });
  });

  app.post("/api/cowork/tasks", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const task = getStore().createTask({
        title: cleanText(body.title, 200),
        objective: cleanText(body.objective, 20_000),
        workspace_root: cleanText(body.workspace_root, 1000),
        permission_mode: cleanText(body.permission_mode, 20),
        project_id: cleanText(body.project_id, 200) || null,
        data_policy: cleanText(body.data_policy, 20),
        model_policy: body.model_policy && typeof body.model_policy === "object" && !Array.isArray(body.model_policy)
          ? (body.model_policy as Record<string, unknown>)
          : undefined,
        inputs: body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)
          ? (body.inputs as Record<string, unknown>)
          : {},
      });
      return c.json({ task }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id", (c) => {
    try {
      return c.json(getStore().getTaskDetail(c.req.param("id")));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/run", async (c) => {
    try {
      const result = await getOrchestrator().startTask(c.req.param("id"));
      return c.json(result, 202);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/pause", async (c) => {
    try {
      const task = await getOrchestrator().pauseTask(c.req.param("id"));
      return c.json({ task });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/resume", async (c) => {
    try {
      const result = await getOrchestrator().resumeTask(c.req.param("id"));
      return c.json(result, 202);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/cancel", async (c) => {
    try {
      const task = await getOrchestrator().cancelTask(c.req.param("id"));
      return c.json({ task });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/accept", async (c) => {
    try {
      const task = await getOrchestrator().acceptTask(c.req.param("id"));
      return c.json({ task });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/revise", async (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const artifactId = cleanText(body.artifact_id, 200);
      const instruction = cleanText(body.instruction, 20_000);
      if (!artifactId) throw new CoworkValidationError("artifact_id 不能为空");
      if (!instruction) throw new CoworkValidationError("instruction 不能为空");
      const artifact = getStore().getTaskDetail(task.id).artifacts
        .find((item: CoworkArtifact) => item.id === artifactId);
      if (!artifact) throw new CoworkNotFoundError("交付物不存在");
      const selection = body.selection && typeof body.selection === "object" && !Array.isArray(body.selection)
        ? (body.selection as Record<string, unknown>)
        : {};
      if (!["docx", "pptx", "xlsx"].includes(artifact.kind)) {
        throw new CoworkValidationError("结构化选改只支持 DOCX、PPTX、XLSX");
      }
      const result = await getOrchestrator().reviseTask(task.id, {
        artifactId: artifact.id,
        path: artifact.path,
        kind: artifact.kind,
        version: artifact.version,
        selection,
        instruction,
      });
      return c.json(result, 202);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id/events/history", (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const after = Math.max(0, Number(c.req.query("after") ?? 0) || 0);
      const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? 200) || 200));
      return c.json({
        task_id: task.id,
        events: getStore().listEvents(task.id, after, limit).map(eventView),
      });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id/artifacts/:artifactId/file", (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const artifact = getStore()
        .getTaskDetail(task.id)
        .artifacts.find((item: CoworkArtifact) => item.id === c.req.param("artifactId"));
      if (!artifact) throw new CoworkNotFoundError("交付物不存在");
      const staging = path.resolve(task.staging_root);
      const artifactPath = path.resolve(artifact.path);
      const rel = path.relative(staging, artifactPath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new CoworkNotFoundError("交付物不在任务 staging 内");
      }
      const snapshot = coworkArtifactSnapshotPath(task.id, artifact.id, artifact.path);
      const filePath = fs.existsSync(snapshot) ? snapshot : artifact.path;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new CoworkNotFoundError("交付物文件已不存在");
      }
      const rawName = path.basename(artifact.path);
      const asciiName = rawName
        .replace(/[^\x20-\x7E]/g, "_")
        .replace(/["\\\r\n]/g, "_") || "artifact";
      const encoded = encodeURIComponent(rawName);
      const inline = c.req.query("inline") === "1";
      const file = Bun.file(filePath);
      return new Response(file, {
        headers: {
          "content-type": file.type || "application/octet-stream",
          "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encoded}`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/artifacts/:artifactId/export", async (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const artifact = getStore().getTaskDetail(task.id).artifacts
        .find((item: CoworkArtifact) => item.id === c.req.param("artifactId"));
      if (!artifact) throw new CoworkNotFoundError("交付物不存在");
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const target = previewExportTarget(task, artifact, cleanText(body.target_path, 1000));
      const approval = getStore().createApproval({
        taskId: task.id,
        runId: getStore().getLatestRun(task.id)?.id ?? null,
        kind: "export",
        payload: {
          artifact_id: artifact.id,
          artifact_path: artifact.path,
          target_path: target.directory,
          target_file: target.resolved,
          versioned: target.versioned,
          summary: `导出 ${path.basename(artifact.path)} 到工作区`,
        },
        ttlMs: 30 * 60 * 1000,
      });
      return c.json({ approval: approvalView(approval) }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/tasks/:id/artifacts/:artifactId/delete", async (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const artifact = getStore().getTaskDetail(task.id).artifacts
        .find((item: CoworkArtifact) => item.id === c.req.param("artifactId"));
      if (!artifact) throw new CoworkNotFoundError("交付物不存在");
      const approval = getStore().createApproval({
        taskId: task.id,
        runId: getStore().getLatestRun(task.id)?.id ?? null,
        kind: "delete",
        payload: {
          artifact_id: artifact.id,
          path: artifact.path,
          summary: `删除 staged 产物 ${path.basename(artifact.path)}（移入 trash）`,
        },
        ttlMs: 30 * 60 * 1000,
      });
      return c.json({ approval: approvalView(approval) }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id/package", (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      const pkg = buildDeliveryPackage(task, getStore().getTaskDetail(task.id).artifacts);
      const encoded = encodeURIComponent(pkg.filename);
      return new Response(pkg.bytes, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="cowork-delivery.zip"; filename*=UTF-8''${encoded}`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id/file-backups", (c) => {
    try {
      const task = getStore().getTask(c.req.param("id"));
      return c.json({ backups: listFileBackups(getConnection(), task.id) });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/file-backups/:id/restore", (c) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    try {
      const backup = restoreFileBackup(getConnection(), c.req.param("id"));
      getStore().appendEvent(backup.task_id, null, "cowork.file.restored", {
        backup_id: backup.id,
        path: backup.original_path,
        message: "已从备份恢复工作区文件",
      });
      return c.json({ backup });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/tasks/:id/events", (c) => {
    let task: CoworkTask;
    try {
      task = getStore().getTask(c.req.param("id"));
    } catch (err) {
      return errorResponse(c, err);
    }
    // EventSource 断线重连会带 Last-Event-ID；优先它，保证不丢事件。
    const after = Math.max(
      0,
      Number(c.req.header("last-event-id") ?? c.req.query("after") ?? 0) || 0,
    );
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const sent = new Set<number>();
    let cursor = after;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": connected\n\n"));
        const push = (event: CoworkEvent) => {
          if (sent.has(event.id)) return;
          sent.add(event.id);
          cursor = Math.max(cursor, event.id);
          try {
            controller.enqueue(encoder.encode(`id: ${event.id}\nevent: cowork\ndata: ${JSON.stringify(eventView(event))}\n\n`));
          } catch {
            // 客户端断开由 cancel() 清理
          }
        };
        // 先订阅实时事件再回放：回放与实时之间的空档由 sent 去重。
        unsubscribe = getStore().subscribe(task.id, push);
        for (const event of getStore().listEvents(task.id, after, 500)) push(event);
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            if (unsubscribe) {
              unsubscribe();
              unsubscribe = null;
            }
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          }
        }, 15_000);
        if (typeof heartbeat.unref === "function") heartbeat.unref();
      },
      cancel() {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.post("/api/cowork/approvals/:id/decide", async (c) => {
    try {
      const approvalId = c.req.param("id");
      const approval = getStore().getApproval(approvalId);
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const action = cleanText(body.action, 20);
      const reason = cleanText(body.reason, 1000);
      if (approval.kind === "plan") {
        if (!["approve", "reject", "modify"].includes(action)) {
          throw new CoworkValidationError("计划审批 action 必须是 approve/reject/modify");
        }
        const modifiedPlan = action === "modify" ? cleanText(body.modified_plan, 20_000) : "";
        if (action === "modify" && !modifiedPlan) throw new CoworkValidationError("修改计划必须提供 modified_plan");
        await getOrchestrator().decidePlan(approvalId, action as "approve" | "reject" | "modify", reason, modifiedPlan);
      } else if (approval.kind === "export") {
        if (!["approve", "reject"].includes(action)) {
          throw new CoworkValidationError("导出审批 action 必须是 approve/reject");
        }
        if (action === "reject") {
          getStore().resolveApproval(approvalId, "rejected", reason || "用户拒绝导出");
        } else {
          const payload = JSON.parse(approval.payload_json || "{}") as Record<string, unknown>;
          const task = getStore().getTask(approval.task_id);
          const artifact = getStore().getTaskDetail(task.id).artifacts
            .find((item: CoworkArtifact) => item.id === payload.artifact_id);
          if (!artifact) throw new CoworkNotFoundError("交付物不存在");
          const result = exportArtifactToWorkspace(
            getConnection(),
            task,
            artifact,
            typeof payload.target_path === "string" ? payload.target_path : "",
          );
          getStore().resolveApproval(approvalId, "approved", reason || "用户批准导出");
          getStore().appendEvent(task.id, approval.run_id, "cowork.artifact.exported", {
            approval_id: approval.id,
            artifact_id: artifact.id,
            path: result.path,
            versioned: result.versioned,
            backup_id: result.backup_id,
            sha256: result.sha256,
            message: `已导出到 ${result.path}`,
          });
        }
      } else if (approval.kind === "delete") {
        if (!["approve", "reject"].includes(action)) {
          throw new CoworkValidationError("删除审批 action 必须是 approve/reject");
        }
        if (action === "reject") {
          getStore().resolveApproval(approvalId, "rejected", reason || "用户拒绝删除");
        } else {
          const payload = JSON.parse(approval.payload_json || "{}") as Record<string, unknown>;
          const task = getStore().getTask(approval.task_id);
          const artifact = getStore().getTaskDetail(task.id).artifacts
            .find((item: CoworkArtifact) => item.id === payload.artifact_id);
          if (!artifact) throw new CoworkNotFoundError("交付物不存在");
          const result = deleteStagedArtifact(getConnection(), task, artifact);
          getStore().resolveApproval(approvalId, "approved", reason || "用户批准删除");
          getStore().appendEvent(task.id, approval.run_id, "cowork.artifact.deleted", {
            approval_id: approval.id,
            artifact_id: artifact.id,
            trashed_to: result.trashed_to,
          });
        }
      } else {
        if (!["approve", "reject"].includes(action)) {
          throw new CoworkValidationError("工具审批 action 必须是 approve/reject");
        }
        await getOrchestrator().decideTool(approvalId, action === "approve", reason);
      }
      return c.json(getStore().getTaskDetail(approval.task_id));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}
