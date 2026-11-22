/**
 * M4-A 审批中心：跨任务列出待审批项，并把“低风险只读工具”做成可批量安全批准。
 *
 * 批量只允许白名单只读工具 + risk_level=low；计划、导出、删除和写工具永远逐项处理。
 * 这是产品约束，不是 UI 禁用——后端会对每个 id 重新校验。
 */
import type { Database } from "bun:sqlite";

import type { CoworkApproval, CoworkApprovalKind } from "./cowork-store";
import { CoworkConflictError, CoworkValidationError } from "./cowork-errors";

export interface CoworkApprovalView extends CoworkApproval {
  payload: Record<string, unknown>;
  task_title: string;
  project_id: string | null;
  title: string;
  detail: string;
  risk_level: string;
  batchable: boolean;
}

const SAFE_BATCH_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "doc_search",
  "doc_read",
  "read_office_file",
]);

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function approvalView(row: CoworkApproval & { task_title?: string; project_id?: string | null }): CoworkApprovalView {
  const payload = parsePayload(row.payload_json);
  const kind = row.kind as CoworkApprovalKind;
  const toolName = str(payload.tool_name);
  const riskLevel = str(payload.risk_level, kind === "plan" ? "medium" : "medium");
  const batchable = kind === "tool" && riskLevel === "low" && SAFE_BATCH_TOOLS.has(toolName);
  const title = kind === "plan"
    ? "计划审批"
    : kind === "export"
      ? "导出产物到工作区"
      : kind === "delete"
        ? "删除 staged 产物"
        : `操作审批${toolName ? ` · ${toolName}` : ""}`;
  const detail = kind === "plan"
    ? str(payload.plan_text).slice(0, 500)
    : kind === "export"
      ? `目标文件：${str(payload.target_file, str(payload.target_path, "任务工作区"))}`
      : kind === "delete"
        ? `产物：${str(payload.path)}`
        : str(payload.question) || str(payload.tool_input).slice(0, 500);
  return {
    ...row,
    payload,
    task_title: str(row.task_title, row.task_id),
    project_id: row.project_id ?? null,
    title,
    detail,
    risk_level: riskLevel,
    batchable,
  };
}

export function listApprovals(
  db: Database,
  opts: { status?: string; taskId?: string; limit?: number } = {},
): CoworkApprovalView[] {
  const status = opts.status === "all" ? "" : (opts.status ?? "pending");
  const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 100)));
  const rows = db
    .query(
      `SELECT a.*, t.title AS task_title, t.project_id AS project_id
       FROM cowork_approvals a
       JOIN cowork_tasks t ON t.id = a.task_id
       WHERE (? = '' OR a.status = ?)
         AND (? = '' OR a.task_id = ?)
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(status, status, opts.taskId ?? "", opts.taskId ?? "", limit) as Array<CoworkApproval & {
      task_title: string;
      project_id: string | null;
    }>;
  return rows.map(approvalView);
}

export function batchableApprovals(db: Database, approvalIds: string[]): CoworkApprovalView[] {
  if (approvalIds.length === 0) return [];
  if (approvalIds.length > 10) throw new CoworkValidationError("单次最多批量批准 10 项");
  const ids = [...new Set(approvalIds)];
  const all = listApprovals(db, { status: "pending", limit: 200 });
  const found = ids.map((id) => all.find((approval) => approval.id === id) ?? null);
  if (found.some((approval) => approval === null)) throw new CoworkConflictError("审批不存在或已处理");
  const unsafe = found.filter((approval): approval is CoworkApprovalView => !approval!.batchable);
  if (unsafe.length > 0) throw new CoworkConflictError("只能批量批准低风险只读操作；计划/写入/导出/删除必须逐项确认");
  return found as CoworkApprovalView[];
}
