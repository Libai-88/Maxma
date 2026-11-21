/**
 * kernel/hooks/audit.ts — 钩子运行审计。
 *
 * 与工具审计分开写 `api/data/hooks_audit.jsonl`：钩子不是工具，把它塞进
 * `agent_audit.jsonl` 会让"工具决策"查询混入另一类东西。审计失败不影响执行。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { agentAuditDir } from "../agent-audit";
import type { HookEventName, HookRunRecord } from "./hook-types";

const MAX_AUDIT_BYTES = 8 * 1024 * 1024;

export function hooksAuditPath(): string {
  return path.join(agentAuditDir(), "hooks_audit.jsonl");
}

export interface HooksAuditEntry extends HookRunRecord {
  timestamp: string;
  session_id: string;
  tool_name?: string;
  summary?: string;
}

export function recordHookRun(input: {
  sessionId: string;
  toolName?: string;
  summary?: string;
  records: HookRunRecord[];
}): void {
  if (input.records.length === 0) return;
  try {
    fs.mkdirSync(agentAuditDir(), { recursive: true });
    const file = hooksAuditPath();
    try {
      if (fs.statSync(file).size > MAX_AUDIT_BYTES) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
      /* 文件不存在 */
    }
    const timestamp = new Date().toISOString();
    const lines = input.records.map((record) => JSON.stringify({
      ...record,
      timestamp,
      session_id: input.sessionId,
      ...(input.toolName ? { tool_name: input.toolName } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
    } satisfies HooksAuditEntry));
    fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
  } catch (error) {
    console.warn("[hooks] audit write failed:", error);
  }
}

export function hookEventLabel(event: HookEventName): string {
  return event;
}
