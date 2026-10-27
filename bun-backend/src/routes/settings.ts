/**
 * routes/settings.ts — 全局 Settings 读写（api/routes/settings.py 的 Bun 直译，
 * 阶段二 2.2）。
 *
 * 端点契约：
 *   - GET  /api/settings?paths=a,b → {path: value}（未登记/无值的路径跳过）
 *   - GET  /api/settings/schema    → 每个登记键的归属与支持状态（前端据此标注）
 *   - PUT  /api/settings {path, value} → {ok: true, consumer, engine_real}
 *
 * ⚠️ 与旧实现的差别（这是修 bug，不是改行为）：
 *   旧 PUT 对**任何**字符串路径都 `applyOverrides()` 并回 `{ok:true}`。pi 的
 *   `applyOverrides` 对未知键宽容，于是上一代引擎遗留的键、以及从未接线的开关，
 *   拨完都"保存成功"但毫无作用。现在按 `pi-contract.ts` 的登记表判定：
 *     · 未登记 → 422（新增配置项必须先登记由谁消费）
 *     · 登记为无人消费 → 409 并写明原因
 *   读写都走 settings-global.ts，显式改动落盘，引擎侧的改动经 create_session 生效。
 */

import { Hono } from "hono";

import {
  getSettingValue,
  SettingRejectedError,
  settingsSupportView,
  setSettingValue,
} from "../settings-global";
import { MAXMA_SETTINGS_KEYS } from "../../../bun-sidecar/src/kernel/pi-contract";

/**
 * 默认返回的键全集（不传 paths 时）。
 * 唯一来源是 `pi-contract.ts` 的登记表——以前这里手抄一份 26 项的列表，
 * 与前端面板的清单各写各的，漂移了也没人知道。
 */
export const CORE_SETTING_PATHS: readonly string[] = MAXMA_SETTINGS_KEYS.map((k) => k.path);

export function createSettingsRoutes(): Hono {
  const app = new Hono();

  // 必须在 /api/settings 之前声明吗？Hono 按完整路径匹配，二者不冲突；
  // 放前面是为了读的人一眼看到"schema 是只读元信息"。
  app.get("/api/settings/schema", (c) => c.json({ settings: settingsSupportView() }));

  app.get("/api/settings", (c) => {
    const pathsParam = c.req.query("paths");
    const pathList = pathsParam
      ? pathsParam.split(",").map((p) => p.trim()).filter(Boolean)
      : [...CORE_SETTING_PATHS];
    const result: Record<string, unknown> = {};
    for (const p of pathList) {
      const value = getSettingValue(p);
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
      const entry = setSettingValue(body.path, body.value);
      return c.json({
        ok: true,
        consumer: entry.consumer,
        engine_real: entry.engineReal,
      });
    } catch (err) {
      if (err instanceof SettingRejectedError) {
        // 这类拒绝必须是可读的：前端 UX-SETTINGS-FEEDBACK-001 会把 detail 弹出来。
        // 状态码用字面量三元收敛，而不是直接传 err.status（number）——Hono 的
        // c.json(data, status) 要求 ContentfulStatusCode，宽 number 会走重载失败。
        const status = err.status === 422 ? 422 : err.status === 503 ? 503 : 409;
        return c.json(
          { detail: err.message, code: err.code, path: err.settingPath },
          status,
        );
      }
      console.error(`[settings] Failed to set setting ${body.path}: ${String(err)}`);
      return c.json({ detail: "服务暂时不可用，请稍后重试" }, 500);
    }
  });

  return app;
}
