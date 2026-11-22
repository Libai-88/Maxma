/** 跨任务活动流（活动中心/通知）；只读查询，不改任务状态。 */
import type { Database } from "bun:sqlite";

import type { CoworkEvent } from "./cowork-store";

export function listActivity(
  db: Database,
  limit = 60,
): Array<CoworkEvent & { task_title: string; project_id: string | null }> {
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return db
    .query(
      `SELECT e.id, e.task_id, e.run_id, e.type, e.payload_json, e.created_at,
              t.title AS task_title, t.project_id AS project_id
       FROM cowork_task_events e
       JOIN cowork_tasks t ON t.id = e.task_id
       ORDER BY e.id DESC
       LIMIT ?`,
    )
    .all(safeLimit) as Array<CoworkEvent & { task_title: string; project_id: string | null }>;
}
