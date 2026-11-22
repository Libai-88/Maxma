/**
 * routes/cowork-projects.ts — M3-B 项目、资产与项目记忆。
 *
 * 项目资产只保存引用与索引；源文件仍在用户工作区（或 <data>/cowork/projects/<id>/assets）。
 * 项目记忆写入必须显式 confirmed=true，拒绝“验收后自动污染”。
 */

import type { Context } from "hono";
import { Hono } from "hono";

import {
  CoworkConflictError,
  CoworkNotFoundError,
  CoworkValidationError,
  type CoworkStore,
} from "../services/cowork-store";
import {
  addProjectMemory,
  searchProjectMemories,
} from "../services/cowork-project-memory";

export interface CoworkProjectRoutesDeps {
  store: () => CoworkStore;
  enabled: () => boolean;
}

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof CoworkNotFoundError) return c.json({ detail: err.message }, 404);
  if (err instanceof CoworkConflictError) return c.json({ detail: err.message }, 409);
  if (err instanceof CoworkValidationError) return c.json({ detail: err.message }, 400);
  return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function createCoworkProjectRoutes(deps: CoworkProjectRoutesDeps): Hono {
  const app = new Hono();
  const getStore = () => deps.store();

  app.use("/api/cowork/projects", async (c, next) => {
    if (!deps.enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });
  app.use("/api/cowork/projects/*", async (c, next) => {
    if (!deps.enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });

  app.get("/api/cowork/projects", (c) => {
    return c.json({ projects: getStore().listProjects() });
  });

  app.post("/api/cowork/projects", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const project = getStore().createProject({
        title: text(body.title, 200),
        instructions: text(body.instructions, 20_000),
        workspace_roots: body.workspace_roots,
        default_template_ids: body.default_template_ids,
        model_policy: body.model_policy && typeof body.model_policy === "object"
          && !Array.isArray(body.model_policy)
          ? body.model_policy as Record<string, unknown>
          : {},
        data_policy: text(body.data_policy, 20),
      });
      return c.json({ project }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/projects/:id", (c) => {
    try {
      const store = getStore();
      const project = store.getProject(c.req.param("id"));
      return c.json({
        project,
        tasks: store.listTasks(project.id),
        assets: store.listProjectAssets(project.id),
        memory: searchProjectMemories(project.id, c.req.query("q") ?? "", 20),
        events: store.listProjectEvents(project.id, 50),
      });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.patch("/api/cowork/projects/:id", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const project = getStore().updateProject(c.req.param("id"), {
        title: body.title === undefined ? undefined : text(body.title, 200),
        instructions: body.instructions === undefined ? undefined : text(body.instructions, 20_000),
        workspace_roots: body.workspace_roots,
        default_template_ids: body.default_template_ids,
        model_policy: body.model_policy && typeof body.model_policy === "object"
          && !Array.isArray(body.model_policy)
          ? body.model_policy as Record<string, unknown>
          : undefined,
        data_policy: body.data_policy === undefined ? undefined : text(body.data_policy, 20),
      });
      return c.json({ project });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/projects/:id/assets", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const asset = getStore().addProjectAsset(c.req.param("id"), {
        path: text(body.path, 2000),
        label: text(body.label, 200),
      });
      return c.json({ asset }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.delete("/api/cowork/projects/:id/assets/:assetId", (c) => {
    try {
      getStore().removeProjectAsset(c.req.param("id"), c.req.param("assetId"));
      return c.json({ ok: true });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/projects/:id/assets/:assetId/attach", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const taskId = text(body.task_id, 200);
      if (!taskId) throw new CoworkValidationError("task_id 不能为空");
      const task = getStore().attachAssetToTask(c.req.param("id"), c.req.param("assetId"), taskId);
      return c.json({ task });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.get("/api/cowork/projects/:id/memory", (c) => {
    try {
      const project = getStore().getProject(c.req.param("id"));
      const memory = searchProjectMemories(project.id, c.req.query("q") ?? "", Number(c.req.query("limit") ?? 20));
      return c.json({ memory });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post("/api/cowork/projects/:id/memory", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      if (body.confirmed !== true) {
        throw new CoworkValidationError("写入项目记忆需要用户确认（confirmed=true）");
      }
      const project = getStore().getProject(c.req.param("id"));
      const content = text(body.content, 4000);
      if (!content) throw new CoworkValidationError("记忆内容不能为空");
      const record = addProjectMemory(project.id, content, text(body.category, 40) || "任务摘要");
      return c.json({ memory: record }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}
