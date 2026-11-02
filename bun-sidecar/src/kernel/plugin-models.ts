/**
 * kernel/plugin-models.ts — 插件模型接入点（PLUGIN-001）。
 *
 * kernel 是**纯引擎层**：它不该 import 后端（那会形成 bun-backend ⇄ bun-sidecar 环）。
 * 所以这里只放一个「注册器」插槽 —— 后端在启动时把「插件路由 → pi provider」的
 * 注册函数装进来，`resolvePiModel()` 在解析模型时调用它。
 *
 * 与内置免费通道 `kernel/opencode-zen.ts` 的 `registerOpencodeZenTransport` 是同一种
 * 模式：两者都是在拿到某个 ModelRuntime 实例后，把自定义传输注册上去。差别只在
 * opencode-zen 是编译期写死的单例，而插件路由是运行期由后端装配的。
 *
 * 未装注册器（插件被停用/加载失败）时，这里恒为 no-op —— 插件模型只是「不存在」，
 * 不会影响任何内建 provider 的解析。
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * 把某个插件路由注册到给定 runtime。
 * @returns true 表示「这个 provider 归我管，已注册」（无论该 modelId 是否在清单里）。
 */
export type PluginProviderRegistrar = (
  runtime: ModelRuntime,
  provider: string,
  modelId: string,
) => Promise<boolean> | boolean;

const registrars = new Set<PluginProviderRegistrar>();

/** 装上注册器；返回卸载函数。 */
export function registerPluginProviderRegistrar(registrar: PluginProviderRegistrar): () => void {
  registrars.add(registrar);
  return () => {
    registrars.delete(registrar);
  };
}

/** 是否已装注册器（自检/诊断用）。 */
export function hasPluginProviderRegistrar(): boolean {
  return registrars.size > 0;
}

/**
 * 让已装的注册器依次尝试接管该 provider。
 *
 * ⚠️ 单个注册器抛错只记日志并继续 —— 插件出问题不该让内建 provider 的模型解析失败。
 */
export async function registerPluginProviderOn(
  runtime: ModelRuntime,
  provider: string,
  modelId: string,
): Promise<boolean> {
  for (const registrar of registrars) {
    try {
      if (await registrar(runtime, provider, modelId)) return true;
    } catch (err) {
      console.warn(`[plugin-models] registrar failed for ${provider}/${modelId}: ${String(err)}`);
    }
  }
  return false;
}
