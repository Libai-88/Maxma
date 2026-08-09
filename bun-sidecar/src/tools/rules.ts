/**
 * tools/rules.ts — Maxma 质量规则检索工具。
 *
 * list_rules：读取共享内置规则（config/rules/builtin_rules.json）与用户
 * 自定义规则（api/data/user_rules.json），供 Agent 在写代码前查询应遵守的
 * 质量规范。与 Python 后端 rules API 共用同一数据源。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

export interface QualityRule {
  id: string;
  language: string;
  name: string;
  description: string;
  severity: "error" | "warning" | "info";
  enabled: boolean;
  source: "builtin" | "custom";
}

/** 内置规则共享 JSON：<MAXMA_PROJECT_ROOT>/config/rules/builtin_rules.json */
function builtinRulesFile(): string {
  return path.join(process.env.MAXMA_PROJECT_ROOT ?? process.cwd(), "config", "rules", "builtin_rules.json");
}

/** 用户自定义规则：<MAXMA_PROJECT_ROOT>/api/data/user_rules.json */
function userRulesFile(): string {
  return path.join(process.env.MAXMA_PROJECT_ROOT ?? process.cwd(), "api", "data", "user_rules.json");
}

async function readJsonList(file: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

/** 读取全部质量规则（内置 + 自定义）。 */
export async function readAllRules(): Promise<QualityRule[]> {
  const [builtin, custom] = await Promise.all([
    readJsonList(builtinRulesFile()),
    readJsonList(userRulesFile()),
  ]);
  return [
    ...builtin.map((r) => ({ ...r, source: "builtin" }) as unknown as QualityRule),
    ...custom.map((r) => ({ ...r, source: "custom" }) as unknown as QualityRule),
  ].filter((r) => typeof r.id === "string");
}

const listRulesSchema = {
  type: "object",
  properties: {
    language: {
      type: "string",
      description: "按语言过滤（如 python/typescript/general/rust/shell）。不传返回全部",
    },
    severity: {
      type: "string",
      description: "按严重度过滤（error/warning/info）",
    },
  },
  additionalProperties: false,
} as const;

export function listRulesTool(): ToolDefinition {
  return {
    name: "list_rules",
    label: "质量规则",
    description:
      "查询 Maxma 配置的质量规则（编码规范）。编写代码前调用可了解项目要求遵守的规则：类型提示、命名规范、错误处理等。支持按语言和严重度过滤。",
    parameters: listRulesSchema as unknown as ToolDefinition["parameters"],
    approval: "read",
    async execute(_id: string, params: { language?: string; severity?: string }) {
      let rules = await readAllRules();
      const language = (params.language ?? "").trim().toLowerCase();
      const severity = (params.severity ?? "").trim().toLowerCase();
      if (language) rules = rules.filter((r) => r.language === language);
      if (severity) rules = rules.filter((r) => r.severity === severity);

      const enabled = rules.filter((r) => r.enabled !== false);
      if (enabled.length === 0) {
        return {
          content: [{ type: "text", text: "当前条件下没有启用的质量规则。" }],
          details: { total: rules.length, enabled: 0 },
        };
      }
      const lines = enabled.map(
        (r) => `- [${r.severity}] ${r.name}（${r.language}）：${r.description}${r.source === "custom" ? " [自定义]" : ""}`,
      );
      return {
        content: [{ type: "text", text: `质量规则（${enabled.length} 条启用）：\n${lines.join("\n")}` }],
        details: { total: rules.length, enabled: enabled.length },
      };
    },
  };
}
