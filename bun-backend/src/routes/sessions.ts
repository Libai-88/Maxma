/**
 * routes/sessions.ts — 会话 REST 门面（api/routes/sessions.py 的 Bun 直译，
 * 阶段二 2.2e）。
 *
 * 架构差异（与 Python 版的本质区别）：Python 层通过 pi_bridge 跨进程调
 * sidecar；Bun 后端 **in-process 直调 kernel**（handlePiCreateSession /
 * handlePiSessionRpc），无 JSON-RPC 管道、无 SessionMap 映射层——
 * pi 会话的 JSONL 持久化取代 SessionMap 角色。
 *
 * 契约保持：端点路径与响应形状逐字段对齐 Python 版（含 role 映射
 * user→human / assistant→ai、source:"sidecar" 标记、审计记录）。
 */

import { Hono } from "hono";

import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiBridgeIo,
  type PiSessionRecord,
  type PiPendingPlan,
} from "../../../bun-sidecar/src/kernel/bridge-pi";

import { getDeferredRunManager } from "./deferred-runs";

/** Bun 后端的会话注册表（kernel 桥经 deps 注入）。 */
export interface SessionHub {
  io: PiBridgeIo;
  sessions: Map<string, PiSessionRecord>;
  pendingPlans: Map<string, PiPendingPlan>;
}

export interface SessionsDeps {
  hub: SessionHub;
  /** 审计记录回调（对齐 Python _audit_record，写入共享 audit_log.json）。 */
  audit?: (type: string, target: string, targetId: string, detail: string) => void;
  version: string;
}

const ROLE_MAP: Record<string, string> = { user: "human", assistant: "ai" };

/** RPC 调用 helper：kernel 的 io 回调 → Promise 结果（单请求作用域）。 */
function callRpc<T>(
  deps: SessionsDeps,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const io: PiBridgeIo = {
      send: (id, result) => resolve({ ok: true, result: result as T }),
      sendError: (_id, message) => resolve({ ok: false, error: message }),
      sendEvent: (sessionId, event) => deps.hub.io.sendEvent(sessionId, event),
    };
    const sid = params.session_id as string | undefined;
    if (method === "create_session") {
      void handlePiCreateSession({ io, sessions: deps.hub.sessions, pendingPlans: deps.hub.pendingPlans }, params, 0);
      return;
    }
    if (sid && deps.hub.sessions.has(sid)) {
      void handlePiSessionRpc({ io, sessions: deps.hub.sessions, pendingPlans: deps.hub.pendingPlans }, method, sid, params, 0);
      return;
    }
    resolve({ ok: false, error: `Session not found: ${sid ?? "(missing)"}` });
  });
}

export function createSessionsRoutes(deps: SessionsDeps): Hono {
  const app = new Hono();

  // ── 创建 ──
  app.post("/api/sessions", async (c) => {
    await callRpc(deps, "create_session", { cwd: process.cwd() });
    const created = [...deps.hub.sessions.keys()].at(-1)!;
    const record = deps.hub.sessions.get(created)!;
    return c.json({ session_id: created, created_at: new Date().toISOString(), engine: record.engine });
  });

  // ── 列表 ──
  app.get("/api/sessions", (c) => {
    const sessions = [...deps.hub.sessions.entries()].map(([sid, record]) => ({
      session_id: sid,
      message_count: record.session.messages.length,
      created_at: new Date().toISOString(),
      has_active_agent: record.currentGuard !== null,
      is_const: false,
      const_name: "",
      engine: record.engine,
    }));
    return c.json({ sessions });
  });

  // ── 详情 ──
  app.get("/api/sessions/:sessionId", (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    return c.json({
      session_id: sid,
      message_count: record.session.messages.length,
      created_at: new Date().toISOString(),
      has_active_agent: record.currentGuard !== null,
      is_const: false,
      const_name: "",
      engine: record.engine,
    });
  });

  // ── 权限模式（4 档，AG-PERM-001）──
  app.get("/api/sessions/:sessionId/permission-mode", (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    return c.json({
      session_id: sid,
      permission_mode: record.permissionMode,
      enabled: true,
    });
  });

  app.put("/api/sessions/:sessionId/permission-mode", async (c) => {
    const sid = c.req.param("sessionId");
    const body = (await c.req.json().catch(() => ({}))) as { permission_mode?: string };
    const result = await callRpc<{ ok: boolean; permission_mode: string }>(
      deps,
      "set_permission_mode",
      { session_id: sid, permission_mode: body.permission_mode },
    );
    if (!result.ok) return c.json({ detail: result.error }, result.error.includes("Session not found") ? 404 : 422);
    return c.json({ session_id: sid, permission_mode: result.result.permission_mode, enabled: true });
  });

  // ── 消息（role 映射 user→human / assistant→ai，契约对齐 Python）──
  app.get("/api/sessions/:sessionId/messages", async (c) => {
    const sid = c.req.param("sessionId");
    const limitRaw = c.req.query("limit");
    const limit = limitRaw !== undefined ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return c.json({ detail: "limit 必须在 1-500 之间" }, 400);
    }
    const result = await callRpc<{ messages: Array<Record<string, unknown>>; total: number }>(
      deps,
      "get_messages",
      { session_id: sid, limit },
    );
    if (!result.ok) return c.json({ detail: result.error }, 404);
    const normalized = result.result.messages.map((m) => ({
      ...m,
      role: ROLE_MAP[String(m.role ?? "")] ?? String(m.role ?? ""),
    }));
    return c.json({
      session_id: sid,
      messages: normalized,
      total: result.result.total,
      source: "sidecar", // CACHE-RECONCILE-001：前端据此做缓存校准
    });
  });

  // ── 撤回（UNDO-BUSY-001：运行中拒绝）──
  app.post("/api/sessions/:sessionId/undo", async (c) => {
    const sid = c.req.param("sessionId");
    const n = Number(c.req.query("n") ?? 1);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      return c.json({ detail: "n 必须在 1-100 之间" }, 400);
    }
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后撤回" }, 409);
    }
    const result = await callRpc<{ removed: number }>(deps, "undo", { session_id: sid, steps: n });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "undo", sid, `撤回 ${n} 轮`);
    return c.json({ deleted_count: result.result.removed });
  });

  // ── 闲置回顾 ──
  app.post("/api/sessions/:sessionId/recap", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后再回顾" }, 409);
    }
    const result = await callRpc<{ recap: string }>(deps, "session_recap", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    const answer = String(result.result.recap ?? "").trim();
    return c.json({ answer, status: answer ? "completed" : "empty" });
  });

  // ── 压缩（pi 为摘要式压缩，keep_last 参数在 pi 语义下不适用——契约字段保持）──
  app.post("/api/sessions/:sessionId/compact", async (c) => {
    const sid = c.req.param("sessionId");
    const keepLast = Number(c.req.query("keep_last") ?? 20);
    if (!Number.isFinite(keepLast) || keepLast < 1 || keepLast > 500) {
      return c.json({ detail: "keep_last 必须在 1-500 之间" }, 400);
    }
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后压缩" }, 409);
    }
    const result = await callRpc<{ compressed: boolean; removed_count: number; detail: string }>(
      deps,
      "compact",
      { session_id: sid, keep_last: keepLast },
    );
    if (!result.ok) return c.json({ detail: result.error }, 503);
    return c.json({
      compressed: result.result.compressed,
      removed_count: result.result.removed_count,
      detail: result.result.detail,
    });
  });

  // ── 上下文用量（字符粗估，对齐 Python 语义）──
  app.get("/api/sessions/:sessionId/context-usage", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    const result = await callRpc<{ messages: Array<Record<string, unknown>> }>(
      deps,
      "get_messages",
      { session_id: sid, limit: 200 },
    );
    const messages = result.ok ? result.result.messages : [];
    const totalChars = messages.reduce((acc, m) => acc + String(m.content ?? "").length, 0);
    const maxTokens = 256_000;
    const estimatedTokens = Math.floor(totalChars / 2);
    return c.json({
      estimated_tokens: estimatedTokens,
      max_tokens: maxTokens,
      percentage: Math.min(100, Math.floor((estimatedTokens / Math.max(maxTokens, 1)) * 100)),
      message_count: messages.length,
      model_name: "",
      session_id: sid,
    });
  });

  // ── 清空（UX-CLEAR-001：官方 resetLeaf 语义，Bun 后端直调 kernel RPC）──
  app.delete("/api/sessions/:sessionId/messages", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    if (record.currentGuard !== null) {
      return c.json({ detail: "Agent 正在处理中，请等待本轮完成后清空" }, 409);
    }
    const result = await callRpc<{ status: string }>(deps, "clear_messages", { session_id: sid });
    if (!result.ok) return c.json({ detail: result.error }, 503);
    deps.audit?.("session", "clear", sid, "清空会话消息");
    return c.json({ status: "cleared", cleared_turns: 0 });
  });

  // ── 删除 / 批量删除 / 清理临时 ──
  app.delete("/api/sessions/:sessionId", async (c) => {
    const sid = c.req.param("sessionId");
    const record = deps.hub.sessions.get(sid);
    if (!record) return c.json({ detail: "会话不存在" }, 404);
    await callRpc(deps, "destroy_session", { session_id: sid });
    // 对齐 Python session_manager.remove：取消该会话的活跃 deferred run
    try {
      getDeferredRunManager().cancelParent(sid);
    } catch {
      /* best-effort */
    }
    deps.audit?.("session", "delete", sid, "会话删除");
    return c.json({ status: "deleted" });
  });

  app.post("/api/sessions/batch-delete", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { session_ids?: string[] };
    const deleted: string[] = [];
    for (const sid of body.session_ids ?? []) {
      if (deps.hub.sessions.has(sid)) {
        await callRpc(deps, "destroy_session", { session_id: sid });
        try {
          getDeferredRunManager().cancelParent(sid);
        } catch {
          /* best-effort */
        }
        deleted.push(sid);
      }
    }
    return c.json({ deleted, count: deleted.length });
  });

  app.post("/api/sessions/clear-temp", async (c) => {
    const deleted: string[] = [];
    for (const sid of [...deps.hub.sessions.keys()]) {
      await callRpc(deps, "destroy_session", { session_id: sid });
      try {
        getDeferredRunManager().cancelParent(sid);
      } catch {
        /* best-effort */
      }
      deleted.push(sid);
    }
    return c.json({ deleted, count: deleted.length });
  });

  return app;
}

// 保持 path 引用（供 2.6 合并时定位）
