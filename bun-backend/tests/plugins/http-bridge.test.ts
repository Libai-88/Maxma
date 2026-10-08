/**
 * tests/plugins/http-bridge.test.ts — 插件 HTTP 端点转发（PLUGIN-001 / P2）。
 *
 * 插件（Jet Hub）通过 DSH 的 `connection.fetch.register()` 把管理端点挂到宿主服务器上，
 * 全部 55 个 RPC 方法都走这一条路。这里锁三件事：
 *   1. `connection` 服务的注册/卸载契约（缺了它插件只打一行 warn 就静默失效）；
 *   2. 转发中间件**只**接管「路径 + 方法」都匹配的请求，其余原样放行给 Maxma 路由；
 *   3. 插件 handler 抛错不能把请求变成未捕获异常（要回结构化错误）。
 */

import { describe, expect, test } from "bun:test";
import { Context } from "@deepseek-ai/cordis";
import { Hono } from "hono";

import { MaxmaConnectionService, pluginHttpHandlers } from "../../src/plugins/dsh/connection";
import { createPluginHttpBridge } from "../../src/plugins/dsh/http-bridge";
import type { PluginHttpHandler } from "../../src/plugins/dsh/connection";

describe("connection 服务", () => {
  test("register 记录端点并返回可用的卸载函数", async () => {
    const ctx = new Context();
    await ctx.plugin(MaxmaConnectionService);
    const service = ctx.get("connection") as MaxmaConnectionService;

    expect(typeof service.fetch.register).toBe("function");
    const dispose = service.fetch.register({
      path: "/api/jet-hub",
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async () => new Response("ok"),
    });

    expect(pluginHttpHandlers(ctx).map((h) => `${h.methods.join(",")} ${h.path}`)).toEqual(["POST /api/jet-hub"]);
    // 方法名归一化成大写（插件写小写也不会漏匹配）
    service.fetch.register({ path: "/x", methods: ["get"], fetch: async () => new Response("x") });
    expect(pluginHttpHandlers(ctx).map((h) => h.methods[0])).toEqual(["POST", "GET"]);

    dispose();
    expect(pluginHttpHandlers(ctx).map((h) => h.path)).toEqual(["/x"]);
  });

  test("没有宿主时返回空清单（不是崩）", () => {
    expect(pluginHttpHandlers(undefined)).toEqual([]);
  });
});

describe("插件端点转发中间件", () => {
  function makeApp(handlers: PluginHttpHandler[]) {
    const app = new Hono();
    app.use("*", createPluginHttpBridge({ handlers: () => handlers }));
    app.get("/api/other", (c) => c.json({ from: "maxma" }));
    return app;
  }

  test("按路径+方法精确转发，其余放行给 Maxma 自己的路由", async () => {
    const handlers: PluginHttpHandler[] = [
      {
        path: "/api/jet-hub",
        methods: ["POST"],
        fetch: async (request) =>
          new Response(JSON.stringify({ echo: await request.text() }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    ];
    const app = makeApp(handlers);

    const hit = await app.request("/api/jet-hub", { method: "POST", body: "hello" });
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual({ echo: "hello" });

    // 方法不匹配 → 不接管，落到 Maxma 的 404
    const wrongMethod = await app.request("/api/jet-hub", { method: "GET" });
    expect(wrongMethod.status).toBe(404);

    // 路径不匹配 → 走 Maxma 自己的路由
    const other = await app.request("/api/other");
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ from: "maxma" });
  });

  test("端点清单为空时完全透明（未装插件/插件被停用）", async () => {
    const app = makeApp([]);
    const res = await app.request("/api/other");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: "maxma" });
  });

  test("插件 handler 抛错 → 结构化 500，而不是未捕获异常", async () => {
    const handlers: PluginHttpHandler[] = [
      {
        path: "/api/jet-hub",
        methods: ["POST"],
        fetch: async () => {
          throw new Error("handler 炸了");
        },
      },
    ];
    const app = makeApp(handlers);
    const res = await app.request("/api/jet-hub", { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("plugin/handler-failed");
    expect(body.error.message).toContain("handler 炸了");
  });
});
