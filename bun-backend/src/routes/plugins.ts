/**
 * routes/plugins.ts — 插件管理 REST（PLUGIN-001，取代阶段二的 501 桩）。
 *
 * 契约与前端既有实现对齐（`web/src/api/index.ts:754-786`、`web/src/stores/plugin.ts`）：
 *   - `GET    /api/plugins`                 → `Plugin[]`
 *   - `GET    /api/plugins/:name`           → `PluginDetail`（不存在 404 `{detail}`）
 *   - `GET    /api/plugins/:name/config`    → `{config}`
 *   - `PUT    /api/plugins/:name/config`    → `{ok:true}`
 *   - `PUT    /api/plugins/:name/toggle`    → `{ok:true}`（body `{enabled}`）
 *   - `POST   /api/plugins/install`         → `{ok, plugin?, message?}`（body `{spec, features?}`）
 *   - `DELETE /api/plugins/:name`           → `{ok:true}`（内置插件 400 `{detail}`）
 *
 * ⚠️ 这里**不做 npm 安装**：`install` 只在已随包分发/已可解析的说明符上登记启用，
 * 不联网拉包。理由：安装未审计的第三方代码是安全边界变更，必须走独立的安全评审
 * （对照 `capabilities.ts` 的 skills 安装：下载 → 解压校验 → 体积/条目上限 →
 * 路径穿越防护 → 原子落盘）。在那套校验落地前，宁可如实返回「不支持」也不开洞。
 */

import { Hono } from "hono";

import {
  getPlugin,
  listPlugins,
  setPluginConfig,
  setPluginEnabled,
  uninstallPlugin,
  type PluginRecord,
} from "../plugins/registry";

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 注册表记录 → 前端 `Plugin` 形状（多余字段前端会忽略，保留便于详情页展示）。 */
function toPlugin(record: PluginRecord) {
  return {
    name: record.id,
    version: undefined as string | undefined,
    description: record.description,
    enabled: record.enabled,
    features: record.features,
    homepage: record.homepage,
    author: record.author,
    repository: record.repository,
    tags: [record.kind === "dsh" ? "dsh-host" : record.kind, record.builtin ? "内置" : "外部"].filter(Boolean),
    category: record.category ?? "other",
  };
}

function toPluginDetail(record: PluginRecord) {
  return {
    ...toPlugin(record),
    label: record.label,
    kind: record.kind,
    builtin: record.builtin,
    specifier: record.specifier,
    config_schema: record.configSchema,
    installed_at: record.installedAt,
    last_updated: record.updatedAt,
    /** 启用/停用需重启后端才生效（见 plugins/registry.ts 顶部说明）。 */
    restart_required: true,
    readme: record.description,
  };
}

export function createPluginsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/plugins", (c) => c.json(listPlugins().map(toPlugin)));

  app.get("/api/plugins/:name", (c) => {
    const record = getPlugin(c.req.param("name"));
    if (!record) return c.json({ detail: `插件 '${c.req.param("name")}' 不存在` }, 404);
    return c.json(toPluginDetail(record));
  });

  app.get("/api/plugins/:name/config", (c) => {
    const record = getPlugin(c.req.param("name"));
    if (!record) return c.json({ detail: `插件 '${c.req.param("name")}' 不存在` }, 404);
    return c.json({ config: record.config });
  });

  /**
   * 该插件提供的模型路由（P4：管理界面的数据源）。
   *
   * ⚠️ 前端**不能**自己硬编码这份清单：插件上游增删渠道时，硬编码那份会静默过期，
   * 表现为「某个渠道在界面上永远不出现」。真源是插件运行时注册进 `ctx.llm` 的路由，
   * 由这里转出去（插件没启用/宿主没起来时返回空数组，而不是报错）。
   */
  app.get("/api/plugins/:name/providers", async (c) => {
    const name = c.req.param("name");
    const record = getPlugin(name);
    if (!record) return c.json({ detail: `插件 '${name}' 不存在` }, 404);
    if (!record.enabled || record.kind !== "dsh") return c.json({ providers: [] });
    try {
      // 动态 import：让不涉插件的路由测试不必加载 Cordis 与插件本身。
      const { getDshPluginHost } = await import("../plugins/dsh");
      const host = await getDshPluginHost();
      const providers = host.listProviders().map((item) => ({
        id: item.id,
        name: typeof item.name === "string" && item.name ? item.name : item.id,
      }));
      return c.json({ providers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ providers: [], detail: `插件未就绪：${message}` });
    }
  });

  /**
   * 该插件提供的渠道**及其模型清单**（模型选择器的数据源）。
   *
   * `providers` 端点只给渠道路由（管理界面 rail 用）；模型选择器还需要每个渠道下的
   * 模型 id，否则用户根本无法在 Maxma 里选到插件模型（pi 侧能解析、但选不到）。
   *
   * 逐渠道容错：某个渠道取不到（未登录/断网）只让它空着，不影响其余渠道。
   */
  app.get("/api/plugins/:name/models", async (c) => {
    const name = c.req.param("name");
    const record = getPlugin(name);
    if (!record) return c.json({ detail: `插件 '${name}' 不存在` }, 404);
    if (!record.enabled || record.kind !== "dsh") return c.json({ providers: [] });
    try {
      const { getDshPluginHost } = await import("../plugins/dsh");
      const { createLlmRuntimeCallSource, pluginProviderIds } = await import("../plugins/dsh/pi-bridge");
      const host = await getDshPluginHost();
      const llm = host.getService("llm");
      const source = createLlmRuntimeCallSource(llm);
      const providers = await Promise.all(
        pluginProviderIds(llm).map(async (id) => {
          const label = host.listProviders().find((item) => item.id === id)?.name;
          try {
            const models = await source.listModels(id);
            return { id, name: typeof label === "string" && label ? label : id, models };
          } catch {
            return { id, name: typeof label === "string" && label ? label : id, models: [] };
          }
        }),
      );
      return c.json({ providers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ providers: [], detail: `插件未就绪：${message}` });
    }
  });

  app.put("/api/plugins/:name/config", async (c) => {
    const name = c.req.param("name");
    if (!getPlugin(name)) return c.json({ detail: `插件 '${name}' 不存在` }, 404);
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    const config = bodyRecord(body.config);
    setPluginConfig(name, config);
    return c.json({ ok: true });
  });

  app.put("/api/plugins/:name/toggle", async (c) => {
    const name = c.req.param("name");
    if (!getPlugin(name)) return c.json({ detail: `插件 '${name}' 不存在` }, 404);
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    if (typeof body.enabled !== "boolean") {
      return c.json({ detail: "enabled 必须是布尔值" }, 400);
    }
    setPluginEnabled(name, body.enabled);
    return c.json({ ok: true });
  });

  app.post("/api/plugins/install", async (c) => {
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    const spec = typeof body.spec === "string" ? body.spec.trim() : "";
    if (!spec) return c.json({ ok: false, message: "缺少 spec" }, 400);

    // 已随包分发的插件：登记为启用即可（这就是「安装」）。
    const existing = listPlugins().find((plugin) => plugin.id === spec || plugin.specifier === spec);
    if (existing) {
      const updated = setPluginEnabled(existing.id, true);
      return c.json({ ok: true, plugin: updated ? toPlugin(updated) : undefined });
    }

    return c.json(
      {
        ok: false,
        message:
          "当前仅支持启用已随包分发的插件。从网络安装第三方插件需要先通过安全评审（下载校验、体积与条目上限、路径穿越防护、原子落盘）。",
      },
      501,
    );
  });

  app.delete("/api/plugins/:name", (c) => {
    const result = uninstallPlugin(c.req.param("name"));
    if (!result.ok) {
      // 内置插件不可卸载属「请求合法但不允许」，与「插件不存在」区分开。
      const exists = getPlugin(c.req.param("name")) !== undefined;
      return c.json({ detail: result.reason }, exists ? 400 : 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
