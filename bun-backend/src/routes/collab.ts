/**
 * routes/collab.ts — 协作分享/快照（api/routes/collab.py 的 Bun 直译，2.2h）。
 *
 * 数据：maxma.db 的 collab_shares / collab_snapshots 表（bun:sqlite 同库）。
 * 分享消息读取：pi 会话 in-process 直查（hubSessions）。
 */

import { Hono } from "hono";
import * as crypto from "node:crypto";

import { getConnection, withTransaction } from "../db/core";
import type { PiSessionRecord } from "../../../bun-sidecar/src/kernel/bridge-pi";

interface CollabDeps {
  sessions: Map<string, PiSessionRecord>;
}

interface ShareRow {
  id: string;
  session_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  permission: string;
  password_protected: number;
  access_count: number;
  max_access: number | null;
}

function shareRowToDict(row: Record<string, unknown>): Record<string, unknown> {
  return {
    share_id: row.id,
    session_id: row.session_id,
    created_by: row.created_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
    access_mode: row.permission,
    password_protected: Boolean(row.password_protected),
    access_count: row.access_count,
    max_access: row.max_access,
  };
}

function snapshotRowToDict(row: Record<string, unknown>): Record<string, unknown> {
  let contextUsage: unknown = { used: 0, capacity: 0 };
  try {
    contextUsage = JSON.parse(String(row.context_usage ?? "{}"));
  } catch {
    // 保持默认
  }
  return {
    snapshot_id: row.id,
    session_id: row.session_id,
    title: row.title,
    created_at: row.created_at,
    turn_count: row.turn_count,
    context_usage: contextUsage,
  };
}

export function createCollabRoutes(deps: CollabDeps): Hono {
  const app = new Hono();

  // ── 分享链接 ──

  app.get("/api/sessions/:sessionId/shares", (c) => {
    const sessionId = c.req.param("sessionId");
    const db = getConnection();
    try {
      const rows = db
        .query(
          "SELECT * FROM collab_shares WHERE session_id = ? AND revoked = 0 ORDER BY created_at DESC",
        )
        .all(sessionId) as Array<Record<string, unknown>>;
      return c.json(rows.map(shareRowToDict));
    } finally {
      db.close();
    }
  });

  app.post("/api/sessions/:sessionId/shares", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json().catch(() => ({}))) as {
      session_id?: string;
      access_mode?: string;
      expires_in_hours?: number | null;
      password?: string | null;
      max_access?: number | null;
    };
    const shareId = crypto.randomBytes(16).toString("base64url").slice(0, 22);
    const now = new Date();
    let expiresAt: string | null = null;
    if (body.expires_in_hours) {
      expiresAt = new Date(now.getTime() + body.expires_in_hours * 3600 * 1000).toISOString();
    }
    const shareUrl = `/collab/shares/${shareId}`;

    withTransaction((db) => {
      db.query(
        "INSERT INTO collab_shares (id, session_id, share_url, created_at, expires_at, revoked, permission, created_by, password_protected, access_count, max_access) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)",
      ).run(
        shareId,
        sessionId,
        shareUrl,
        now.toISOString(),
        expiresAt,
        body.access_mode ?? "read",
        "current_user",
        body.password ? 1 : 0,
        body.max_access ?? null,
      );
    });

    return c.json({
      share_id: shareId,
      session_id: sessionId,
      created_by: "current_user",
      created_at: now.toISOString(),
      expires_at: expiresAt,
      access_mode: body.access_mode ?? "read",
      password_protected: Boolean(body.password),
      access_count: 0,
      max_access: body.max_access ?? null,
    });
  });

  app.get("/api/shares/:shareId", (c) => {
    const shareId = c.req.param("shareId");
    const db = getConnection();
    try {
      const row = db
        .query("SELECT * FROM collab_shares WHERE id = ? AND revoked = 0")
        .get(shareId) as Record<string, unknown> | undefined;
      if (!row) return c.json({ detail: "Share not found or revoked" }, 404);
      const share = shareRowToDict(row);

      if (share.expires_at) {
        const expires = new Date(String(share.expires_at));
        if (expires.getTime() < Date.now()) {
          return c.json({ detail: "Share has expired" }, 410);
        }
      }
      db.query("UPDATE collab_shares SET access_count = access_count + 1 WHERE id = ?").run(shareId);

      // 会话消息：pi 会话 in-process 直查
      const record = deps.sessions.get(share.session_id as string);
      const messages = record ? record.session.messages : [];
      return c.json({ share, session_id: share.session_id, messages });
    } finally {
      db.close();
    }
  });

  app.delete("/api/shares/:shareId", (c) => {
    const shareId = c.req.param("shareId");
    withTransaction((db) => {
      const row = db.query("SELECT id FROM collab_shares WHERE id = ?").get(shareId);
      if (!row) {
        throw Object.assign(new Error("Share not found"), { status: 404 });
      }
      db.query("UPDATE collab_shares SET revoked = 1 WHERE id = ?").run(shareId);
    });
    return c.json({ ok: true });
  });

  // ── 快照 ──

  app.get("/api/sessions/:sessionId/snapshots", (c) => {
    const sessionId = c.req.param("sessionId");
    const db = getConnection();
    try {
      const rows = db
        .query("SELECT * FROM collab_snapshots WHERE session_id = ? ORDER BY created_at DESC")
        .all(sessionId) as Array<Record<string, unknown>>;
      return c.json(rows.map(snapshotRowToDict));
    } finally {
      db.close();
    }
  });

  app.post("/api/sessions/:sessionId/snapshots", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const snapshotId = crypto.randomBytes(16).toString("base64url").slice(0, 22);
    const now = new Date();

    // 真实计数在 message_count（SESSION-SNAPSHOT-001）
    let turnCount = 0;
    const record = deps.sessions.get(sessionId);
    if (record) turnCount = record.session.messages.length;

    const contextUsage = { used: 0, capacity: 0 };
    withTransaction((db) => {
      db.query(
        "INSERT INTO collab_snapshots (id, session_id, title, content, created_at, turn_count, context_usage) VALUES (?, ?, ?, '', ?, ?, ?)",
      ).run(snapshotId, sessionId, body.title ?? "", now.toISOString(), turnCount, JSON.stringify(contextUsage));
    });

    return c.json({
      snapshot_id: snapshotId,
      session_id: sessionId,
      title: body.title ?? "",
      created_at: now.toISOString(),
      turn_count: turnCount,
      context_usage: contextUsage,
    });
  });

  app.delete("/api/snapshots/:snapshotId", (c) => {
    const snapshotId = c.req.param("snapshotId");
    withTransaction((db) => {
      const row = db.query("SELECT id FROM collab_snapshots WHERE id = ?").get(snapshotId);
      if (!row) {
        throw Object.assign(new Error("Snapshot not found"), { status: 404 });
      }
      db.query("DELETE FROM collab_snapshots WHERE id = ?").run(snapshotId);
    });
    return c.json({ ok: true });
  });

  return app;
}
