/**
 * plugins/dsh/host.ts — 在 Maxma 进程内托管 DSH（DeepSeek Harness）风格插件。
 *
 * 背景：Maxma 的 Agent 引擎是 pi，本身没有插件运行时；而目标插件
 * （`dsh-codearts-auth` / Jet Hub，10 万行级）是按 DSH 的 Cordis 契约写的。
 * 与其重写它的 15 个 provider 适配器与 55 个 RPC 方法，本模块在 Maxma 进程中
 * 起一个**最小的 Cordis 宿主**，把它原样加载进来。实测（Node 22 与 Bun 1.3.14
 * 均通过）：宿主只需提供三件事，插件即可完成注册并暴露 15 条 provider 路由。
 *
 * 宿主必须提供的服务：
 *   1. `credentials` —— DSH 只给了抽象类 `CredentialProvider`，由宿主实现
 *      （Maxma 版见 `./credential-provider.ts`）；
 *   2. `llm` —— `@deepseek-ai/dsh-llm` 的 `LlmRuntime`，**具体类，可直接复用**；
 *   3. `commands` —— `@deepseek-ai/dsh-commands` 的 `CommandRuntime`，同样可直接复用。
 *   其余（`logger` / `effect` / `plugin` / `get` / `provide` / `on` / `emit`）都是
 *   Cordis 自带的，无需实现。
 *
 * ⚠️ **环境变量必须在 import 插件之前设置**：插件多个模块在**模块作用域**求值
 * 路径与开关（如 `zcode-captcha.ts` 的 `ZCODE_HOME = homedir()`、
 * `trae-product.ts` 的通道列表、`dead-model-store.ts` 的落盘目录），
 * import 之后再改 env 不生效。故本模块把 `loadModule()` 做成**动态 import**，
 * 且在创建宿主时就写好 env。
 *
 * ⚠️ 路径隔离：插件的数据默认落在 `$DSH_HOME`（缺省 `~/.dsh`）。Maxma 通过
 * 设置 `DSH_HOME` 与 `DSH_JET_HUB_STATE_DIR` 把插件数据收进 Maxma 自己的数据
 * 目录（便携模式下随包走），并默认关闭插件的本机 OpenAI 网关以免占用端口。
 */

import type { Context } from "@deepseek-ai/cordis";

import * as path from "node:path";
import * as fs from "node:fs";

import { MaxmaCredentialProvider } from "./credential-provider";
import { MaxmaConnectionService, pluginHttpHandlers, type PluginHttpHandler } from "./connection";

/** `LlmRuntime.listProviders()` 的返回项（只取本模块用得到的字段）。 */
export interface DshProviderInfo {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface DshHostLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface DshPluginHostOptions {
  /** 插件状态根目录（会被指到 `DSH_HOME` 与 `DSH_JET_HUB_STATE_DIR`）。 */
  stateDir: string;
  /** 随宿主启动加载的插件模块说明符（npm 包名或绝对路径）。 */
  pluginSpecifiers?: readonly string[];
  /** 额外/覆盖的环境变量（在 import 之前写入）。 */
  env?: Readonly<Record<string, string>>;
  /** 是否允许插件的本机 OpenAI 网关监听端口（默认 false，避免与 Maxma 抢端口）。 */
  enableOpenAiGateway?: boolean;
  logger?: DshHostLogger;
}

export interface DshPluginHost {
  /** 根 Cordis 上下文；后续 RPC 桥、provider 桥都挂在它上面。 */
  readonly ctx: Context;
  /** 插件状态根目录。 */
  readonly stateDir: string;
  /** 宿主自有的凭据服务实现。 */
  readonly credentials: MaxmaCredentialProvider;
  /** 插件注册进来的 provider 路由（DSH 侧 15 条）。 */
  listProviders(): DshProviderInfo[];
  /** 插件挂到宿主服务器上的 HTTP 端点（Jet Hub 的 55 个 RPC 方法走这里）。 */
  httpHandlers(): PluginHttpHandler[];
  /** 取一个 Cordis 服务（插件注册的 `${product.id}Auth` 等）。 */
  getService<T = unknown>(name: string): T | undefined;
  /** 是否存在某个服务。 */
  hasService(name: string): boolean;
  /** 动态加载一个插件模块并交给 Cordis 装配。 */
  loadModule(specifier: string, config?: unknown): Promise<void>;
  /** 已加载的模块说明符。 */
  loadedModules(): readonly string[];
  /** 卸载全部插件与宿主服务，释放定时器与子进程。 */
  dispose(): Promise<void>;
}

const DEFAULT_LOGGER: DshHostLogger = {
  info: (message) => console.info(`[dsh-host] ${message}`),
  warn: (message) => console.warn(`[dsh-host] ${message}`),
  error: (message) => console.error(`[dsh-host] ${message}`),
};

/**
 * 把插件数据目录固定到 Maxma 数据目录内。
 *
 * 只在进程内设置一次（首次创建宿主时）；重复调用以首次为准，避免后建的宿主
 * 把已加载模块的路径判断改掉。
 */
function applyIsolationEnv(stateDir: string, extra: Readonly<Record<string, string>> | undefined, enableOpenAiGateway: boolean): void {
  const env = process.env;
  env.DSH_HOME = stateDir;
  env.DSH_JET_HUB_STATE_DIR = path.join(stateDir, "jet-hub");
  env.DSH_OPENAI_GATEWAY_ENABLED = enableOpenAiGateway ? "1" : "0";
  for (const [key, value] of Object.entries(extra ?? {})) env[key] = value;
}

/** 确保状态目录存在（插件假定 `$DSH_HOME` 可写）。 */
function ensureStateDir(stateDir: string): void {
  for (const dir of [stateDir, path.join(stateDir, "jet-hub"), path.join(stateDir, "cache"), path.join(stateDir, "logs")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 创建一个 DSH 插件宿主。
 *
 * ⚠️ 该函数会修改 `process.env`（`DSH_HOME` 等）。Maxma 是单进程单宿主模型，
 * 调用方应通过 `getDshPluginHost()` 取用同一个实例，不要并行创建多个。
 */
export async function createDshPluginHost(options: DshPluginHostOptions): Promise<DshPluginHost> {
  const logger = options.logger ?? DEFAULT_LOGGER;
  const stateDir = path.resolve(options.stateDir);
  ensureStateDir(stateDir);
  applyIsolationEnv(stateDir, options.env, options.enableOpenAiGateway === true);

  // ⚠️ env 就位之后才允许 import 插件相关模块。
  const { Context } = await import("@deepseek-ai/cordis");
  const { default: LlmRuntime } = await import("@deepseek-ai/dsh-llm");
  const { default: CommandRuntime } = await import("@deepseek-ai/dsh-commands");

  const ctx = new Context();

  // 1) 凭据服务（宿主实现）
  // ⚠️ 必须把**类**交给 Cordis（由框架 `new Class(ctx, config)`），传实例会被
  // 判为 invalid plugin —— 这正是本模块最早踩到并修掉的那个坑。
  // ⚠️ `ctx.plugin()` 返回的 fiber 必须 await：服务是在装配完成后才可见的，
  // 立刻 `ctx.get()` 会拿到 undefined。
  await ctx.plugin(MaxmaCredentialProvider, {
    // ⚠️ 位置与文件名都不能改：插件在 state.json 丢失时会文本扫描这个文件的
    // `refs:` 段来重建账号索引（见 credential-provider.ts 的 defaultStorePath 注释）。
    storePath: path.join(stateDir, ".credentials.yaml"),
  });
  const credentials = ctx.get("credentials") as MaxmaCredentialProvider;

  // 2) 命令运行时（DSH 具体实现，可直接复用）
  await ctx.plugin(CommandRuntime);

  // 3) LLM 运行时（DSH 具体实现；插件的 15 条 provider 路由注册到这里）
  await ctx.plugin(LlmRuntime);

  // 4) connection 服务（宿主实现）：插件靠它把管理端点挂到宿主服务器上。
  // ⚠️ 必须在加载插件**之前**注册：插件用 `ctx.inject(['connection'], cb)` 惰性挂载，
  // 服务缺失时它只打一行 warn 就跳过全部 RPC（管理界面会整体失效）。
  await ctx.plugin(MaxmaConnectionService);

  const loaded: string[] = [];

  const host: DshPluginHost = {
    ctx,
    stateDir,
    credentials,
    listProviders(): DshProviderInfo[] {
      try {
        const runtime = ctx.get("llm") as { listProviders?: () => unknown } | undefined;
        const list = runtime?.listProviders?.();
        if (!Array.isArray(list)) return [];
        return list.filter((item): item is DshProviderInfo => !!item && typeof item === "object" && typeof (item as DshProviderInfo).id === "string");
      } catch (err) {
        logger.warn(`listProviders failed: ${String(err)}`);
        return [];
      }
    },
    httpHandlers(): PluginHttpHandler[] {
      return pluginHttpHandlers(ctx);
    },
    getService<T = unknown>(name: string): T | undefined {
      try {
        return ctx.get(name) as T | undefined;
      } catch {
        return undefined;
      }
    },
    hasService(name: string): boolean {
      return host.getService(name) !== undefined;
    },
    async loadModule(specifier: string, config?: unknown): Promise<void> {
      const mod = await import(specifier);
      await ctx.plugin(mod, config ?? {});
      loaded.push(specifier);
      logger.info(`loaded plugin module: ${specifier}`);
    },
    loadedModules(): readonly string[] {
      return [...loaded];
    },
    async dispose(): Promise<void> {
      const anyCtx = ctx as unknown as {
        stop?: () => unknown;
        fiber?: { dispose?: () => unknown };
        scope?: { dispose?: () => unknown };
      };
      for (const fn of [anyCtx.stop?.bind(anyCtx), anyCtx.fiber?.dispose?.bind(anyCtx.fiber), anyCtx.scope?.dispose?.bind(anyCtx.scope)]) {
        if (typeof fn === "function") {
          try {
            await fn();
            return;
          } catch (err) {
            logger.warn(`dispose step failed: ${String(err)}`);
          }
        }
      }
    },
  };

  for (const specifier of options.pluginSpecifiers ?? []) {
    await host.loadModule(specifier);
  }

  return host;
}
