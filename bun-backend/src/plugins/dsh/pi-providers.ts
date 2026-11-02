/**
 * plugins/dsh/pi-providers.ts — 把插件的 provider 路由注册成 **pi** provider。
 *
 * 这是 `kernel/plugin-models.ts` 那个插槽的具体实现：后端启动时装上它，
 * `resolvePiModel()` 解析到插件路由时就会调用这里。
 *
 * 注册粒度是**按路由懒注册**（用户真正选到某个渠道的模型时才注册该渠道），
 * 与内置免费通道 `kernel/opencode-zen.ts` 的做法一致 —— 避免每次建会话都为
 * 14 个渠道拉一遍模型清单（那些清单有网络请求）。
 */

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type { DshPluginHost } from "./host";
import { createLlmRuntimeCallSource, createPluginStreamSimple, pluginProviderIds } from "./pi-bridge";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * 占位 baseUrl。
 *
 * ⚠️ pi 的 `registerProvider` 在定义**自定义模型**时**强制要求** baseUrl，
 * 否则抛 `Provider X: "baseUrl" is required when defining custom models.` ——
 * 而这个错误会被 `registerPluginProviderOn` 的 try/catch 吞成一条 warn，
 * 表现为「模型解析失败 / not found in pi registry」，很难联想到是缺 baseUrl。
 *
 * 插件渠道的端点由插件适配器自己决定，这里的 baseUrl **从不被使用**
 *（传输完全由 `streamSimple` 接管，见 pi-bridge.ts）。用保留域 `.invalid`
 * 是刻意的：万一哪天真被当 URL 用，会**立刻响亮地失败**，而不是悄悄打到别人的服务器上。
 */
function placeholderBaseUrl(provider: string): string {
  return `https://plugin.invalid/${encodeURIComponent(provider)}`;
}

/**
 * 占位 API key。
 *
 * ⚠️ 光注册 provider 还不够：pi 的 `AgentSession.setModel()` 会先
 * `await modelRuntime.checkAuth(provider)`，为假时抛 `No API key for <provider>/<model>`
 * ——**发消息时才会走到这一步**（真机踩到：模型能解析、一发送就报无 key）。
 * 插件渠道的鉴权在插件适配器内部（本模块的 streamSimple 接管传输，这个 key 从不被使用），
 * 所以这里只是让 pi 的鉴权前置检查放行。
 *
 * 用 `setRuntimeApiKey` 而不是往 provider config 里塞 `apiKey`：前者是 pi 官方示例 09
 * 的运行时密钥覆盖路径，也正是 Maxma 给 providers.yaml 里的渠道注入密钥用的同一 API。
 */
const PLACEHOLDER_API_KEY = "plugin-managed";

/**
 * 造一个「插件路由 → pi provider」的注册器。
 *
 * @param host 已装配的插件宿主（拿 `ctx.llm` 的服务实例）。
 */
export function createPluginProviderRegistrar(host: DshPluginHost) {
  return async function registerPluginProvider(
    runtime: ModelRuntime,
    provider: string,
    modelId: string,
  ): Promise<boolean> {
    const llm = host.getService<unknown>("llm");
    if (!llm) return false;

    // 不属于插件路由 → 交回给 pi 的常规解析路径。
    if (!pluginProviderIds(llm).includes(provider)) return false;

    const source = createLlmRuntimeCallSource(llm);
    let models = await source.listModels(provider);
    if (models.length === 0) {
      // 清单暂不可得（未登录/断网）也要注册 —— 否则用户会看到「模型不存在」，
      // 而这其实是「还没登录」。把当前请求的模型单独兜底进去。
      models = [{ id: modelId, name: modelId }];
    }
    if (!models.some((m) => m.id === modelId)) {
      models = [...models, { id: modelId, name: modelId }];
    }

    // 只为**这次要用的**模型取准确上限，避免 N 次远端查询。
    const info = await source.resolveModelInfo(provider, modelId);

    runtime.registerProvider(provider, {
      name: provider,
      // ⚠️ 必须有 baseUrl（pi 定义自定义模型的硬要求），见 placeholderBaseUrl 的说明。
      baseUrl: placeholderBaseUrl(provider),
      // api 只是元数据：真正的传输由 streamSimple 接管（与 opencode-zen 同构）。
      api: "openai-completions",
      compat: { maxTokensField: "max_tokens", supportsReasoningEffort: false, supportsStore: false, supportsDeveloperRole: false },
      streamSimple: createPluginStreamSimple(source, provider),
      models: models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
        input: ["text"],
        cost: { ...ZERO_COST },
        reasoning: info.reasoning === true,
        contextWindow: info.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: info.maxTokens ?? DEFAULT_MAX_TOKENS,
      })),
    } as never);

    // 让 pi 的鉴权前置检查放行（见 PLACEHOLDER_API_KEY 的说明）。
    // 写在 registerProvider 之后：先有 provider 再挂密钥，语义上更直白。
    const runtimeWithKey = runtime as unknown as {
      setRuntimeApiKey?: (provider: string, key: string) => Promise<void> | void;
    };
    if (typeof runtimeWithKey.setRuntimeApiKey === "function") {
      await runtimeWithKey.setRuntimeApiKey(provider, PLACEHOLDER_API_KEY);
    }

    return true;
  };
}
