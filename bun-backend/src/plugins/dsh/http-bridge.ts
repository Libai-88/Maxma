/**
 * plugins/dsh/http-bridge.ts — 把插件注册的 HTTP 端点接到 Maxma 的 Hono 上（P2）。
 *
 * 做成**通用转发**而不是硬编码 `/api/jet-hub`：插件自己决定路径（DSH 契约如此），
 * 宿主只按「路径 + 方法」查表转发。这样换插件、插件改路径都不用动 Maxma 的代码。
 *
 * 挂载位置很关键：必须放在鉴权中间件**之后**（见 server.ts 的中间件顺序），
 * 这样插件的管理端点与 Maxma 其它 `/api/**` 受同一套 Token 保护 —— 否则
 * 「多账号凭据管理」这类高敏感接口会变成无鉴权暴露。
 */

import type { Context, Next } from "hono";

import type { PluginHttpHandler } from "./connection";

export interface HttpBridgeOptions {
  /** 返回当前已注册的插件端点（每次请求现取，以便插件晚注册也能生效）。 */
  handlers: () => PluginHttpHandler[];
}

export function createPluginHttpBridge(options: HttpBridgeOptions) {
  return async function pluginHttpBridge(c: Context, next: Next) {
    const handlers = options.handlers();
    if (handlers.length === 0) return await next();

    let pathname: string;
    try {
      pathname = new URL(c.req.url).pathname;
    } catch {
      return await next();
    }

    const method = c.req.method.toUpperCase();
    const handler = handlers.find((item) => item.path === pathname && item.methods.includes(method));
    if (!handler) return await next();

    try {
      // c.req.raw 就是原始 Request（含 body 与 signal），插件侧用的是标准 fetch 语义。
      const response = await handler.fetch(c.req.raw);
      return response instanceof Response ? response : new Response(String(response));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[plugins] 插件端点 ${method} ${pathname} 处理失败：${message}`);
      return c.json({ error: { code: "plugin/handler-failed", message } }, 500);
    }
  };
}
