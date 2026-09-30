/**
 * routes/rules.ts — 质量规则 CRUD（api/routes/rules.py 的 Bun 直译，阶段二 2.2）。
 *
 * 数据流与 Python 版一致：
 *   - 内置规则单一事实源：config/rules/builtin_rules.json（sidecar list_rules 同读），
 *     缺失/损坏回退内嵌列表（17 条原样保留）
 *   - 自定义规则：API_DATA_DIR/user_rules.json（RULES-RACE-001：原子写）
 *   - 内置启停覆盖：API_DATA_DIR/rule_toggles.json（RULES-TOGGLE-001：{id: enabled}）
 *   - 响应附加 source(builtin|custom)/editable 字段
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir, getConfigDir } from "../app-paths";

interface Rule {
  id: string;
  name: string;
  description: string;
  language: string;
  severity: string;
  pattern?: string;
  enabled: boolean;
}

function builtinRulesFile(): string {
  return path.join(getConfigDir(), "rules", "builtin_rules.json");
}
function userRulesFile(): string {
  return path.join(getApiDataDir(), "user_rules.json");
}
function togglesFile(): string {
  return path.join(getApiDataDir(), "rule_toggles.json");
}

/** 内嵌兜底——共享 JSON 缺失/损坏时使用（与 Python 版逐条一致）。 */
const BUILTIN_RULES_FALLBACK: Rule[] = [
  { id: "py-type-hints", language: "python", name: "类型提示完整性", description: "函数参数和返回值必须有类型注解", severity: "warning", pattern: "", enabled: true },
  { id: "py-async-safety", language: "python", name: "异步安全", description: "async 函数中禁止阻塞调用（time.sleep, open 等）", severity: "error", pattern: "", enabled: true },
  { id: "py-import-order", language: "python", name: "导入排序", description: "标准库 → 第三方 → 本地，各组间空行分隔", severity: "info", pattern: "", enabled: true },
  { id: "py-docstring", language: "python", name: "公共 API 文档", description: "公共函数/类必须有 docstring", severity: "info", pattern: "", enabled: false },
  { id: "py-error-handling", language: "python", name: "异常处理规范", description: "禁止裸 except，必须指定异常类型", severity: "warning", pattern: "", enabled: true },
  { id: "ts-strict-null", language: "typescript", name: "严格空检查", description: "禁止隐式 any，必须处理 null/undefined", severity: "error", pattern: "", enabled: true },
  { id: "ts-no-unused", language: "typescript", name: "未使用变量", description: "声明但未使用的变量/导入应移除", severity: "warning", pattern: "", enabled: true },
  { id: "ts-async-await", language: "typescript", name: "Promise 处理", description: "异步操作必须 await 或显式 .catch()，禁止浮空 Promise", severity: "error", pattern: "", enabled: true },
  { id: "ts-explicit-return", language: "typescript", name: "显式返回类型", description: "导出函数必须声明返回类型", severity: "info", pattern: "", enabled: false },
  { id: "gen-naming", language: "general", name: "命名规范", description: "变量/函数 camelCase，类 PascalCase，常量 UPPER_SNAKE", severity: "info", pattern: "", enabled: true },
  { id: "gen-max-complexity", language: "general", name: "圈复杂度", description: "单函数圈复杂度不超过 15", severity: "warning", pattern: "", enabled: true },
  { id: "gen-max-lines", language: "general", name: "函数长度", description: "单函数不超过 80 行（不含注释）", severity: "warning", pattern: "", enabled: true },
  { id: "gen-no-magic-numbers", language: "general", name: "魔法数字", description: "数字字面量应提取为命名常量", severity: "info", pattern: "", enabled: false },
  { id: "rust-unwrap", language: "rust", name: "禁止 unwrap", description: "生产代码禁止 .unwrap()，使用 expect 或 ? 操作符", severity: "error", pattern: "", enabled: true },
  { id: "rust-lifetime", language: "rust", name: "生命周期标注", description: "公共 API 的引用参数必须显式标注生命周期", severity: "warning", pattern: "", enabled: true },
  { id: "sh-quote-vars", language: "shell", name: "变量引用", description: "Shell 变量展开必须加双引号防止词分割", severity: "warning", pattern: "", enabled: true },
  { id: "sh-set-flags", language: "shell", name: "安全标志", description: "脚本开头必须 set -euo pipefail", severity: "error", pattern: "", enabled: true },
];

function loadBuiltinRules(): Rule[] {
  try {
    const file = builtinRulesFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(data) && data.length > 0) return data as Rule[];
    }
  } catch (err) {
    console.warn(`[rules] Failed to load builtin rules: ${String(err)}`);
  }
  return BUILTIN_RULES_FALLBACK.map((r) => ({ ...r }));
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort
    }
    throw err;
  }
}

function readJsonArray(filePath: string): Rule[] {
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      if (Array.isArray(data)) return data as Rule[];
    }
  } catch (err) {
    console.warn(`[rules] Failed to load ${filePath}: ${String(err)}`);
  }
  return [];
}

function readToggles(): Record<string, boolean> {
  try {
    if (fs.existsSync(togglesFile())) {
      const data = JSON.parse(fs.readFileSync(togglesFile(), "utf8")) as Record<string, unknown>;
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "boolean") out[k] = v;
      }
      return out;
    }
  } catch (err) {
    console.warn(`[rules] Failed to load rule toggles: ${String(err)}`);
  }
  return {};
}

export function allRules(): Array<Rule & { source: "builtin" | "custom"; editable: boolean }> {
  const toggles = readToggles();
  const result: Array<Rule & { source: "builtin" | "custom"; editable: boolean }> = [];
  for (const r of loadBuiltinRules()) {
    const override = toggles[r.id];
    result.push({ ...r, enabled: override ?? r.enabled, source: "builtin", editable: false });
  }
  for (const r of readJsonArray(userRulesFile())) {
    result.push({ ...r, source: "custom", editable: true });
  }
  return result;
}

export function createRulesRoutes(): Hono {
  const app = new Hono();

  app.get("/api/rules", (c) => {
    const language = c.req.query("language");
    let rules = allRules();
    if (language) rules = rules.filter((r) => r.language === language);
    return c.json({ rules, total: rules.length });
  });

  app.get("/api/rules/languages", (c) => {
    const languages = [...new Set(allRules().map((r) => r.language))].sort();
    return c.json({ languages });
  });

  app.post("/api/rules", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<Rule>;
    // Pydantic RuleCreate 必填字段校验（name/description/language/severity）
    if (!body.name || !body.description || !body.language || !body.severity) {
      return c.json({ detail: "name, description, language, severity 为必填字段" }, 422);
    }
    const ruleId = body.id || `custom-${crypto.randomUUID().slice(0, 8).replace(/-/g, "")}`;
    const custom = readJsonArray(userRulesFile());
    if (custom.some((r) => r.id === ruleId)) {
      return c.json({ detail: `规则 ID '${ruleId}' 已存在` }, 409);
    }
    const newRule: Rule = {
      id: ruleId,
      name: body.name,
      description: body.description,
      language: body.language,
      severity: body.severity,
      pattern: body.pattern ?? "",
      enabled: body.enabled ?? true,
    };
    custom.push(newRule);
    writeJsonAtomic(userRulesFile(), custom);
    return c.json({ ...newRule, source: "custom", editable: true }, 201);
  });

  app.put("/api/rules/:ruleId", async (c) => {
    const ruleId = c.req.param("ruleId");
    const builtin = loadBuiltinRules().find((r) => r.id === ruleId);
    const custom = readJsonArray(userRulesFile());
    const rule = custom.find((r) => r.id === ruleId);
    if (!rule) {
      if (builtin) return c.json({ detail: "内置规则不可编辑" }, 403);
      return c.json({ detail: `规则 '${ruleId}' 不存在` }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as Partial<Rule>;
    const updates = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined && v !== null),
    );
    if (Object.keys(updates).length === 0) {
      return c.json({ detail: "未提供任何更新字段" }, 400);
    }
    Object.assign(rule, updates);
    writeJsonAtomic(userRulesFile(), custom);
    return c.json({ ...rule, source: "custom", editable: true });
  });

  app.delete("/api/rules/:ruleId", (c) => {
    const ruleId = c.req.param("ruleId");
    if (loadBuiltinRules().some((r) => r.id === ruleId)) {
      return c.json({ detail: "内置规则不可删除" }, 403);
    }
    const custom = readJsonArray(userRulesFile());
    const idx = custom.findIndex((r) => r.id === ruleId);
    if (idx < 0) return c.json({ detail: `规则 '${ruleId}' 不存在` }, 404);
    custom.splice(idx, 1);
    writeJsonAtomic(userRulesFile(), custom);
    return c.json({ status: "deleted", id: ruleId });
  });

  app.patch("/api/rules/:ruleId/toggle", async (c) => {
    const ruleId = c.req.param("ruleId");
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return c.json({ detail: "enabled 为必填布尔字段" }, 422);
    }
    const builtin = loadBuiltinRules().find((r) => r.id === ruleId);
    const custom = readJsonArray(userRulesFile());
    const rule = builtin ?? custom.find((r) => r.id === ruleId);
    if (!rule) return c.json({ detail: `规则 '${ruleId}' 不存在` }, 404);

    rule.enabled = body.enabled;
    const source = builtin ? "builtin" : "custom";
    if (builtin) {
      // RULES-TOGGLE-001：覆盖文件持久化（sidecar list_rules 同读磁盘状态）
      const toggles = readToggles();
      toggles[ruleId] = body.enabled;
      writeJsonAtomic(togglesFile(), toggles);
    } else {
      writeJsonAtomic(userRulesFile(), custom);
    }
    return c.json({ ...rule, source, editable: source === "custom" });
  });

  return app;
}
