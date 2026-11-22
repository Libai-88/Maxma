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
import { CoworkOrchestrator } from "../services/cowork-orchestrator";

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

  app.use("/api/cowork/tasks/*", async (c, next) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });
  app.use("/api/cowork/approvals/*", async (c, next) => {
    if (!enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });

  app.get("/api/cowork/tasks", (c) => {
    return c.json({ tasks: getStore().listTasks() });
  });

  app.post("/api/cowork/tasks", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const task = getStore().createTask({
        title: cleanText(body.title, 200),
        objective: cleanText(body.objective, 20_000),
        workspace_root: cleanText(body.workspace_root, 1000),
        permission_mode: cleanText(body.permission_mode, 20),
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
