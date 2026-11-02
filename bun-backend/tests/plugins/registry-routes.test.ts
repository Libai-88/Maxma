/**
 * tests/plugins/registry-routes.test.ts — 插件注册表与 REST 面（PLUGIN-001）。
 *
 * 覆盖「可插拔」的真实语义：
 *   - 列表/详情来自注册表（内置描述符 + 用户态合并），不再是空数组与 404；
 *   - 启用开关与配置**持久化**，且停用后 `enabledDshSpecifiers()` 真的不返回它
 *     （即「停用 → 重启 → 不装配」这条链路成立，而不是只改了个界面字段）；
 *   - 响应形状与前端的既有契约逐字对齐（`stores/plugin.ts` 期望 `{ok}`、
 *     `{ok, plugin}`，`PluginConfigPanel` 读 `config_schema`）；
 *   - 内置插件不可卸载，未支持的网络安装如实返回 501 而不是假装成功。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createPluginsRoutes } from "../../src/routes/plugins";
import { enabledDshSpecifiers, getPlugin, listPlugins } from "../../src/plugins/registry";

let dataDir: string;
let prevDataDir: string | undefined;
let app: Hono;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-plugins-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  app = new Hono();
  app.route("/", createPluginsRoutes());
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("plugin registry", () => {
  test("lists the built-in plugin with default enabled state", () => {
    const plugins = listPlugins();
    expect(plugins.map((p) => p.id)).toEqual(["codearts-auth"]);
    expect(plugins[0]?.enabled).toBe(true);
    expect(plugins[0]?.kind).toBe("dsh");
    expect(plugins[0]?.specifier).toBe("dsh-codearts-auth");
  });

  test("persists the enable flag and drives the load list", () => {
    expect(enabledDshSpecifiers()).toEqual(["dsh-codearts-auth"]);

    const before = getPlugin("codearts-auth");
    expect(before?.enabled).toBe(true);

    // 停用 → 持久化 → 装配清单不再包含它
    const { setPluginEnabled } = require("../../src/plugins/registry") as typeof import("../../src/plugins/registry");
    setPluginEnabled("codearts-auth", false);
    expect(enabledDshSpecifiers()).toEqual([]);
    expect(getPlugin("codearts-auth")?.enabled).toBe(false);

    // 落盘确实发生（重启后仍生效）
    const registryPath = path.join(dataDir, "plugins", "registry.json");
    expect(fs.existsSync(registryPath)).toBe(true);
    expect(fs.readFileSync(registryPath, "utf8")).toContain('"enabled": false');

    setPluginEnabled("codearts-auth", true);
    expect(enabledDshSpecifiers()).toEqual(["dsh-codearts-auth"]);
  });
});

describe("plugin routes", () => {
  test("GET /api/plugins returns the merged record list", async () => {
    const res = await app.request("/api/plugins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: "codearts-auth", enabled: true, category: "integration" });
  });

  test("GET /api/plugins/:name returns detail with a renderable config schema", async () => {
    const res = await app.request("/api/plugins/codearts-auth");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("codearts-auth");
    expect(body.builtin).toBe(true);
    expect(body.restart_required).toBe(true);
    // PluginConfigPanel 只认 type/properties/required 的 JSON Schema 子集
    const schema = body.config_schema as { type: string; properties: Record<string, unknown> };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toContain("providers");
  });

  test("GET /api/plugins/:name 404s for an unknown plugin", async () => {
    const res = await app.request("/api/plugins/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { detail: string }).detail).toContain("nope");
  });

  test("PUT toggle flips persisted state and rejects non-boolean input", async () => {
    const ok = await app.request("/api/plugins/codearts-auth/toggle", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(getPlugin("codearts-auth")?.enabled).toBe(false);
    expect(enabledDshSpecifiers()).toEqual([]);

    const bad = await app.request("/api/plugins/codearts-auth/toggle", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(bad.status).toBe(400);

    const missing = await app.request("/api/plugins/nope/toggle", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(missing.status).toBe(404);
  });

  test("plugin config round-trips through GET/PUT", async () => {
    const empty = await app.request("/api/plugins/codearts-auth/config");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ config: {} });

    const put = await app.request("/api/plugins/codearts-auth/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { providers: { trae: { maxMode: true } } } }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });

    const read = await app.request("/api/plugins/codearts-auth/config");
    expect(await read.json()).toEqual({ config: { providers: { trae: { maxMode: true } } } });
  });

  test("built-in plugins cannot be uninstalled; unknown names 404", async () => {
    const builtin = await app.request("/api/plugins/codearts-auth", { method: "DELETE" });
    expect(builtin.status).toBe(400);
    expect(((await builtin.json()) as { detail: string }).detail).toContain("不能卸载");

    const unknown = await app.request("/api/plugins/nope", { method: "DELETE" });
    expect(unknown.status).toBe(404);
  });

  test("providers endpoint is 404 for unknown plugins and empty while disabled", async () => {
    // 管理界面的数据源：渠道清单由后端从插件运行时转出，前端不硬编码。
    const unknown = await app.request("/api/plugins/nope/providers");
    expect(unknown.status).toBe(404);

    // 停用后必须走「不启动宿主、直接返回空」的快路径 —— 否则一个被停用的插件
    // 仍会在每次打开界面时被拉起来。
    const { setPluginEnabled } = require("../../src/plugins/registry") as typeof import("../../src/plugins/registry");
    setPluginEnabled("codearts-auth", false);
    const disabled = await app.request("/api/plugins/codearts-auth/providers");
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ providers: [] });
  });

  test("install enables a known spec and honestly refuses unknown ones", async () => {
    const known = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: "dsh-codearts-auth" }),
    });
    expect(known.status).toBe(200);
    const knownBody = (await known.json()) as { ok: boolean; plugin?: { name: string; enabled: boolean } };
    expect(knownBody.ok).toBe(true);
    expect(knownBody.plugin).toMatchObject({ name: "codearts-auth", enabled: true });

    const unknown = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec: "some-third-party-plugin" }),
    });
    expect(unknown.status).toBe(501);
    expect(((await unknown.json()) as { message: string }).message).toContain("安全评审");
  });
});
