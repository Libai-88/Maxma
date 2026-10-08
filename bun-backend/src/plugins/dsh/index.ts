/**
 * plugins/dsh/index.ts — DSH 插件子系统的对外入口（惰性单例）。
 *
 * Maxma 是单进程单宿主模型：整个进程只起**一个** Cordis 宿主，所有 DSH 风格
 * 插件都装进它。原因不只是省资源 —— `@deepseek-ai/cordis` 的服务名是全局作用域，
 * 同一个进程里注册两个 `llm` / `credentials` 服务会互相覆盖；而插件的多个模块
 * 在 import 时会按 `process.env.DSH_HOME` 记忆路径，多宿主也无法各自隔离。
 */

import { getDshPluginStateDir } from "../../app-paths";
import { registerPluginProviderRegistrar } from "../../../../bun-sidecar/src/kernel/plugin-models";
import { enabledDshSpecifiers, getPlugin } from "../registry";
import { createDshPluginHost, type DshPluginHost, type DshPluginHostOptions } from "./host";
import { createPluginProviderRegistrar } from "./pi-providers";

export type { DshPluginHost, DshPluginHostOptions, DshProviderInfo } from "./host";
export { MaxmaCredentialProvider } from "./credential-provider";
export type { PluginHttpHandler } from "./connection";

let hostPromise: Promise<DshPluginHost> | null = null;

/**
 * 从插件注册表解析宿主装配参数。
 *
 * 抽成独立函数是为了**可测**：这段「用户配置 → 宿主 env」的映射（尤其网关开关）
 * 如果只在装配时才求值，就只能靠启动真宿主来验证。
 */
export function resolveDshHostOptions(): DshPluginHostOptions {
  const specifiers = enabledDshSpecifiers();
  const gatewayEnabled = specifiers.includes("dsh-codearts-auth")
    ? getPlugin("codearts-auth")?.config?.gatewayEnabled === true
    : false;
  return {
    stateDir: getDshPluginStateDir(),
    pluginSpecifiers: specifiers,
    enableOpenAiGateway: gatewayEnabled,
  };
}

/**
 * 取进程内唯一的 DSH 宿主（首次调用时创建并加载**已启用**的插件）。
 *
 * 启用清单来自插件注册表（`plugins/registry.ts`）—— 用户在管理界面停用某个插件后
 * 重启后端，它就不会被装配。插件描述符本身也定义在注册表里（那里是「Maxma 的插件」
 * 的唯一清单来源），本模块只负责按清单装配。
 *
 * ⚠️ 失败时不缓存拒绝值：下次调用会重试，避免一次瞬时故障把插件子系统永久钉死。
 */
export function getDshPluginHost(): Promise<DshPluginHost> {
  if (!hostPromise) {
    hostPromise = createDshPluginHost(resolveDshHostOptions())
      .then((host) => {
        hostInstance = host;
        return host;
      })
      .catch((err) => {
        hostPromise = null;
        hostInstance = null;
        throw err;
      });
  }
  return hostPromise;
}

/** 卸载宿主（进程退出或重启插件子系统时调用）。 */
export async function disposeDshPluginHost(): Promise<void> {
  const pending = hostPromise;
  hostPromise = null;
  hostInstance = null;
  uninstallBridge?.();
  uninstallBridge = null;
  if (!pending) return;
  try {
    const host = await pending;
    await host.dispose();
  } catch {
    // 卸载路径不抛：调用方通常已在退出流程里
  }
}

let uninstallBridge: (() => void) | null = null;

/**
 * 启动插件子系统：装配宿主，并把「插件路由 → pi provider」的注册器装进 kernel。
 *
 * 幂等；失败**不抛**（插件起不来不该拦住 Maxma 启动，只是插件模型不可用）。
 * 后端在 `startServer()` 里 fire-and-forget 调用它。
 */
export async function ensurePluginBridgeInstalled(): Promise<boolean> {
  try {
    const host = await getDshPluginHost();
    if (!uninstallBridge) {
      uninstallBridge = registerPluginProviderRegistrar(createPluginProviderRegistrar(host));
    }
    return true;
  } catch (err) {
    console.error(`[plugins] 插件子系统启动失败（插件模型将不可用）：${String(err)}`);
    return false;
  }
}

/**
 * 当前插件注册的 HTTP 端点（供 server.ts 的转发中间件实时查表）。
 *
 * 宿主尚未装配时返回空数组 —— 中间件随即 `next()`，不影响 Maxma 自身路由。
 */
export function currentPluginHttpHandlers(): PluginHttpHandler[] {
  return hostInstance ? hostInstance.httpHandlers() : [];
}

/**
 * 该 provider 是否由插件提供（Jet Hub 的渠道路由）。
 *
 * 用途：`chat-ws` 解析模型时先按 providers.yaml 查；插件渠道**不在那份文件里**
 * （凭据与端点在插件自己的适配器内），所以查不到时要问一句「是不是插件的」，
 * 否则会把整条插件模型链路挡在「所选提供商不可用」上。
 *
 * 未装/未启动宿主时恒为 false —— 插件不可用时给用户的就该是明确的「不可用」。
 */
export function isPluginProvider(providerId: string): boolean {
  if (!hostInstance) return false;
  try {
    return hostInstance.listProviders().some((item) => item.id === providerId);
  } catch {
    return false;
  }
}

/** 已装配好的宿主实例（同步可见；未装配时为 null）。 */
let hostInstance: DshPluginHost | null = null;
