/**
 * routes/session-compress.ts — 会话压缩 REST（api/routes/session_compress.py
 * 的 Bun 直译，阶段二 2.3b）。
 *
 * 端点：POST /api/sessions/{sid}/compress 与 /fresh-compact（行为相同）。
 * 架构差异：Python 版经 pi_bridge 调 sidecar compact RPC，不可用时优雅降级
 * （unavailable/degraded）；Bun 后端 kernel in-process——会话存在即可压缩，
 * compact 失败时保持同一响应形状（compressed:false, method:"degraded"）。
 */

import { Hono, type Context } from "hono";

import type { PiSessionRecord } from "../../../bun-sidecar/src/kernel/bridge-pi";

import { record as recordActivity } from "../activity-hub";

export interface SessionCompressDeps {
  sessions: Map<string, PiSessionRecord>;
  callRpc: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
}

async function tryCompact(sessionId: string, deps: SessionCompressDeps): Promise<Record<string, unknown>> {
  const result = await deps.callRpc("compact", { session_id: sessionId });
  if (!result.ok) {
    // 与 Python JsonRpcError 分支同形状（compact 不可用 → 降级说明）
    return { compressed: false, method: "degraded", detail: `compact not supported: ${result.error}` };
  }
  const r = result.result as { compressed?: boolean; removed_count?: number; detail?: string };
  const removed = r.removed_count;
  recordActivity("compression", "compact", {
    session_id: sessionId,
    message: `上下文压缩完成，移除 ${removed} 条历史消息`,
    payload: { method: "sidecar", removed_count: removed, compressed: r.compressed ?? true },
  });
  return {
    compressed: r.compressed ?? true,
    method: "sidecar",
    removed_count: removed,
    detail: r.detail ?? "压缩完成",
  };
}

export function createSessionCompressRoutes(deps: SessionCompressDeps): Hono {
  const app = new Hono();

  const handler = async (c: Context) => {
    const sid = c.req.param("sessionId");
    if (!deps.sessions.has(sid)) return c.json({ detail: "会话不存在" }, 404);
    return c.json(await tryCompact(sid, deps));
  };

  app.post("/api/sessions/:sessionId/compress", handler);
  app.post("/api/sessions/:sessionId/fresh-compact", handler);

  return app;
}
