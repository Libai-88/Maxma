/**
 * kernel/session-catalog-rpc.ts — `list_sessions` 全局 RPC。
 *
 * 与 `create_session` 同类：不依赖会话上下文，因此在 `session-bridge.ts` 里
 * 先于"会话存在性"判定分流。**不放进 bridge-pi.ts** 是有意的：
 * `tests/engine-boundary.test.ts` 把那里的 `method === "..."` 分支当作
 * "会话级 RPC 清单"做双向对账，全局方法混进去会把会话语义搅浑。
 */

import type { PiBridgeIo } from "./bridge-pi";
import { deletePersistedSession, listPersistedSessions, normalizeSessionId } from "./session-catalog";

export function handleListPersistedSessions(
  deps: { io: PiBridgeIo },
  params: Record<string, unknown>,
  id: number | null,
): void {
  const raw = Number(params?.limit);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 200) : 50;
  // file 是后端内部用于 resume 的路径，不给前端（也不给 REST 响应）。
  const sessions = listPersistedSessions(limit).map(({ file: _file, ...rest }) => rest);
  deps.io.send(id, { sessions });
}

/** `delete_persisted_session`：只删磁盘文件，hub 里活着的会话由 destroy_session 管。 */
export function handleDeletePersistedSession(
  deps: { io: PiBridgeIo },
  params: Record<string, unknown>,
  id: number | null,
): void {
  const sessionId = normalizeSessionId(params?.session_id);
  if (!sessionId) {
    deps.io.sendError(id, "session_id 必须是 32 位十六进制");
    return;
  }
  const deleted = deletePersistedSession(sessionId);
  if (!deleted) {
    deps.io.sendError(id, `Persisted session not found: ${sessionId}`);
    return;
  }
  deps.io.send(id, { deleted: true, session_id: sessionId });
}