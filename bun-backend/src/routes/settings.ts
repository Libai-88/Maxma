/**
 * routes/settings.ts — 全局 Settings 读写（api/routes/settings.py 的 Bun 直译，
 * 阶段二 2.2）。
 *
 * 语义说明：Python 版把该端点桥接到 sidecar 的全局 settings RPC；Bun 后端
 * kernel in-process 后直接使用官方 SettingsManager 全局单例（inMemory +
 * overrides），端点契约不变：
 *   - GET /api/settings?paths=a,b → {path: value}（未知路径静默跳过）
 *   - PUT /api/settings {path, value} → {ok: true}
 *
 * ⚠️ pi 的 settings 树与旧内核键名不同（无 compaction.thresholdPercent/strategy
 * 等）——CORE_SETTING_PATHS 列表保留原样作为"请求键全集"，实际返回以 pi 树
 * 为准；前端设置面板键对齐为独立后续任务。
 */

import { Hono } from "hono";

import { getGlobalSettingsSingleton } from "../settings-global";

// 核心配置项列表（与 Python 版逐条一致——作为"请求键全集"）
export const CORE_SETTING_PATHS = [
  "compaction.enabled",
  "compaction.strategy",
  "compaction.thresholdPercent",
  "compaction.midTurnEnabled",
  "compaction.idleEnabled",
  "compaction.idleThresholdTokens",
  "compaction.idleTimeoutSeconds",
  "retry.enabled",
  "retry.maxRetries",
  "retry.baseDelayMs",
  "retry.maxDelayMs",
  "retry.modelFallback",
  "tools.approvalMode",
  "tools.discoveryMode",
  "advisor.enabled",
  "advisor.subagents",
  "steeringMode",
  "followUpMode",
  "interruptMode",
  "thinkingBudgets.minimal",
  "thinkingBudgets.low",
  "thinkingBudgets.medium",
  "thinkingBudgets.high",
  "thinkingBudgets.xhigh",
  "thinkingBudgets.max",
  "skills.enabled",
];

/** 全局 SettingsManager 单例（与 settings-panels 共享同一实例）。 */
function getGlobalSettings() {
  return getGlobalSettingsSingleton();
}

/** 从 Settings 对象解析点路径。 */
export function readDottedPath(root: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, root);
}

/** 点路径 → 嵌套覆盖对象（applyOverrides 需要 Partial<Settings> 形状）。 */
function buildNestedOverride(dotted: string, value: unknown): Record<string, unknown> {
  const keys = dotted.split(".").filter((k) => k.length > 0);
  let node: Record<string, unknown> = { [keys[keys.length - 1]!]: value };
  for (let i = keys.length - 2; i >= 0; i--) {
    node = { [keys[i]!]: node };
  }
  return node;
}

export function createSettingsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/settings", (c) => {
    const pathsParam = c.req.query("paths");
    const pathList = pathsParam
      ? pathsParam.split(",").map((p) => p.trim()).filter(Boolean)
      : CORE_SETTING_PATHS;
    const settings = getGlobalSettings().getSettings();
    const result: Record<string, unknown> = {};
    for (const p of pathList) {
      const value = readDottedPath(settings, p);
      if (value !== undefined) result[p] = value;
    }
    return c.json(result);
  });

  app.put("/api/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; value?: unknown };
    if (!body.path) {
      return c.json({ detail: "path 为必填字段" }, 422);
    }
    try {
      const overrides = buildNestedOverride(body.path, body.value);
      getGlobalSettings().applyOverrides(overrides as never);
      await getGlobalSettings().flush();
      return c.json({ ok: true });
    } catch (err) {
      console.error(`[settings] Failed to set setting ${body.path}: ${String(err)}`);
      return c.json({ detail: "服务暂时不可用，请稍后重试" }, 500);
    }
  });

  return app;
}
