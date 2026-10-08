/**
 * plugins/dsh/connection.ts — Maxma 侧的 `connection` 服务（PLUGIN-001 / P2）。
 *
 * DSH 的插件用 `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`
 * 把自己的 HTTP 端点挂到宿主服务器上。Jet Hub 的**全部 55 个管理 RPC 方法**都走这条路：
 *
 *   `lib/jet-hub-rpc.js:772`  const connection = ctx.connection ?? ctx.get('connection')
 *   `lib/jet-hub-rpc.js:773`  if (!connection || typeof connection.fetch?.register !== 'function') {
 *   `lib/jet-hub-rpc.js:774`      ctx.logger.warn('connection.fetch not available, RPC endpoints not registered')
 *
 * 也就是说：**没有这个服务，插件的管理面会整体消失，而且只留一行 warn**（不报错）。
 * 之前「插件管理界面点了没反应」那一类症状的根因就是这个。
 *
 * 本实现只做最小契约：`fetch.register()` 记下 `{path, methods, fetch}`，返回卸载函数；
 * 再由 `http-bridge.ts` 把这些 handler 接到 Maxma 的 Hono 上（放在鉴权中间件之后，
 * 所以插件端点与 Maxma 其它 API 受同一套 Token 保护）。
 *
 * ⚠️ 这里**不实现** DSH 客户端的 `connection.rpc.call` —— 那是浏览器侧的另一半；
 * Maxma 的界面用普通 HTTP 调这些端点即可（信封格式与 DSH 完全一致，见 §P2 计划）。
 */

import { Service } from "@deepseek-ai/cordis";
import type { Context } from "@deepseek-ai/cordis";

export interface PluginHttpHandler {
  /** 端点路径（插件给的绝对路径，如 `/api/jet-hub`）。 */
  path: string;
  /** 允许的方法（大写）。 */
  methods: string[];
  /** 标准 WHATWG fetch：吃一个 Request，回一个 Response。 */
  fetch: (request: Request) => Promise<Response> | Response;
  /** 注册它的插件标识（诊断用；由宿主在加载时打点）。 */
  owner?: string;
}

export interface PluginHttpRegistration {
  path: string;
  methods: readonly string[];
  requestBody?: string;
  fetch: (request: Request) => Promise<Response> | Response;
}

/**
 * `connection` 服务。Cordis 会把服务实例包成 Proxy 再调用，
 * 所以**不能用 ES `#private` 成员**（同 credential-provider.ts 的踩坑记录）。
 */
export class MaxmaConnectionService extends Service {
  _handlers: PluginHttpHandler[] = [];

  constructor(ctx: Context) {
    super(ctx, "connection");
  }

  /** DSH 契约：`connection.fetch.register(...)`。 */
  get fetch() {
    const self = this;
    return {
      /** 注册一个端点；返回卸载函数。 */
      register(options: PluginHttpRegistration): () => void {
        const methods = (Array.isArray(options.methods) ? options.methods : ["GET"]).map((m) => String(m).toUpperCase());
        const handler: PluginHttpHandler = {
          path: options.path,
          methods,
          fetch: options.fetch,
        };
        self._handlers.push(handler);
        return () => {
          self._handlers = self._handlers.filter((item) => item !== handler);
        };
      },
      /** 按路径取回已注册的 handler（DSH 客户端侧 `fetchRoutes.get` 的同义实现）。 */
      get(path: string): PluginHttpHandler | undefined {
        return self._handlers.find((item) => item.path === path);
      },
      /** 全部已注册端点（诊断/测试用）。 */
      list(): PluginHttpHandler[] {
        return [...self._handlers];
      },
    };
  }
}

/** 从宿主上下文里取已注册的插件 HTTP 端点。 */
export function pluginHttpHandlers(ctx: Context | undefined): PluginHttpHandler[] {
  if (!ctx) return [];
  try {
    const service = ctx.get("connection") as MaxmaConnectionService | undefined;
    return service?._handlers ? [...service._handlers] : [];
  } catch {
    return [];
  }
}
