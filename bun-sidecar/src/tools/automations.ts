/**
 * tools/automations.ts — Maxma 自动化任务查询工具。
 *
 * list_automations：读取后端 SQLite（api/data/maxma.db）的 automations 表，
 * 返回自动化任务列表（名称/计划/动作摘要/启用状态）。Agent 可据此了解
 * Maxma 的自动化体系并在对话中协助管理。
 *
 * 说明：自动化执行由后端调度器（cron/interval）驱动，工具侧只读查询，
 * 不跨进程触发（写类触发能力依赖后端扩展，见优化方案 S3-1 写类待办）。
 */

import * as path from "node:path";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

// bun:sqlite 为 Bun 内置模块，无 @types/bun 时以局部窄接口访问。
interface SqliteRow {
  id: unknown;
  name: unknown;
  description: unknown;
  cron_expr: unknown;
  interval_seconds: unknown;
  action: unknown;
  enabled: unknown;
  run_count: unknown;
  last_run: unknown;
  next_run: unknown;
}
interface SqliteDatabase {
  query(sql: string): { all(): SqliteRow[] };
  close(): void;
}
type SqliteCtor = new (filename: string, options?: { readonly?: boolean }) => SqliteDatabase;

/** 动态加载 bun:sqlite（绕过 TS 模块解析，运行时由 Bun 提供）。 */
async function loadSqlite(): Promise<SqliteCtor> {
  const mod = (await import("bun:sqlite" as string)) as { Database: SqliteCtor };
  return mod.Database;
}

export interface AutomationInfo {
  id: string;
  name: string;
  description: string;
  schedule: string;
  actionSummary: string;
  enabled: boolean;
  runCount: number;
  lastRun: string | null;
  nextRun: string | null;
}

/** 后端 SQLite 路径：<MAXMA_PROJECT_ROOT>/api/data/maxma.db */
export function automationsDbPath(): string {
  return path.join(
    process.env.MAXMA_PROJECT_ROOT ?? process.cwd(),
    "api",
    "data",
    "maxma.db",
  );
}

/** 读取全部自动化任务（数据库缺失/损坏时返回空列表）。 */
export async function readAutomations(): Promise<AutomationInfo[]> {
  const Database = await loadSqlite();
  let db: SqliteDatabase | null = null;
  try {
    db = new Database(automationsDbPath(), { readonly: true });
    const rows = db.query(
      "SELECT id, name, description, cron_expr, interval_seconds, action, enabled, run_count, last_run, next_run FROM automations",
    ).all();

    return rows.map((row: SqliteRow) => {
      const action = (row.action ?? "{}") as unknown;
      let actionSummary = "";
      try {
        const parsed = typeof action === "string" ? JSON.parse(action) : action;
        const payload = (parsed as { payload?: { text?: unknown } })?.payload;
        if (payload && typeof payload.text === "string") {
          actionSummary = payload.text.slice(0, 120);
        } else if ((parsed as { type?: unknown })?.type) {
          actionSummary = `action: ${String((parsed as { type?: unknown }).type)}`;
        }
      } catch {
        actionSummary = "";
      }

      const cron = typeof row.cron_expr === "string" && row.cron_expr ? `cron:${row.cron_expr}` : "";
      const interval = typeof row.interval_seconds === "number" && (row.interval_seconds as number) > 0
        ? `every ${(row.interval_seconds as number)}s`
        : "";

      return {
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        description: String(row.description ?? ""),
        schedule: cron || interval || "manual",
        actionSummary,
        enabled: row.enabled !== 0 && row.enabled !== false,
        runCount: Number(row.run_count ?? 0),
        lastRun: typeof row.last_run === "string" ? row.last_run : null,
        nextRun: typeof row.next_run === "string" ? row.next_run : null,
      };
    });
  } catch {
    return []; // db 不存在或不可读（开发期未初始化）
  } finally {
    try { db?.close(); } catch { /* noop */ }
  }
}

const listAutomationsSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "按任务名称模糊匹配（可选）",
    },
  },
  additionalProperties: false,
} as const;

export function listAutomationsTool(): ToolDefinition {
  return {
    name: "list_automations",
    label: "自动化任务",
    description:
      "查询 Maxma 的自动化任务列表（定时/周期任务，如定时生成报告、定时清理）。返回任务的名称、调度计划与动作摘要。当用户询问自动化任务、定时任务或想要了解系统里有哪些计划任务时调用。",
    parameters: listAutomationsSchema as unknown as ToolDefinition["parameters"],
    approval: "read",
    async execute(_id: string, params: { name?: string }) {
      let automations = await readAutomations();
      const nameFilter = (params.name ?? "").trim().toLowerCase();
      if (nameFilter) {
        automations = automations.filter((a) => a.name.toLowerCase().includes(nameFilter));
      }

      if (automations.length === 0) {
        return {
          content: [{ type: "text", text: "当前没有匹配的自动化任务。" }],
          details: { total: 0 },
        };
      }

      const lines = automations.map((a) => {
        const status = a.enabled ? "启用" : "停用";
        const summary = a.actionSummary ? ` — ${a.actionSummary}` : "";
        const runs = a.runCount > 0 ? `（已运行 ${a.runCount} 次）` : "";
        return `- [${a.id}] ${a.name}（${status}，${a.schedule}）${runs}${summary}`;
      });
      return {
        content: [{ type: "text", text: `自动化任务（${automations.length} 个）：\n${lines.join("\n")}` }],
        details: { total: automations.length, automations },
      };
    },
  };
}
