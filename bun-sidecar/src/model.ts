/**
 * model.ts — 模型字符串解析（bundled catalog 优先，手工构造兜底）。
 */
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { Model } from "@oh-my-pi/pi-ai";
import type { GeneratedProvider } from "./omp-compat";

/**
 * Parse a model string like "openai/gpt-4o" into a proper Model object.
 *
 * Strategy:
 *   A — Try `getBundledModel(provider, modelId)` from the bundled catalog.
 *   B — Fall back to constructing a minimal Model object manually.
 */
export function parseModel(
  modelStr: string,
  options?: { provider?: string; baseUrl?: string; providerType?: string; contextWindow?: number },
): Model {
  const slashIdx = modelStr.indexOf("/");
  const parsedProvider = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : "";
  const parsedModelId = slashIdx >= 0 ? modelStr.slice(slashIdx + 1) : modelStr;
  const provider = options?.provider ?? parsedProvider;
  const modelId = options?.provider ? modelStr : parsedModelId;

  // Option A: bundled catalog lookup
  if (provider) {
    try {
      const bundled = getBundledModel(provider as GeneratedProvider, modelId);
      if (bundled) {
        // 修复 BASE_URL-OVERRIDE-001：目录命中时保留用户配置的 base_url。
        // 此前 bundled 原样返回，用户在 Web UI 配置的自定义端点（自建网关/
        // 代理）被目录内置端点静默覆盖，请求发往错误地址必然失败。
        // 能力元数据（reasoning/api/compat）仍用目录值，仅端点以用户配置优先。
        if (options?.baseUrl && options.baseUrl.trim()) {
          return { ...bundled, baseUrl: options.baseUrl };
        }
        return bundled;
      }
    } catch {
      // Fall through to manual construction
    }
  }

  // Option B: manual fallback (minimal Model object from env vars)
  const baseUrl = options?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  // 修复 API-FORMAT-001：按端点识别协议格式。此前回退硬编码 openai-completions，
  // anthropic 端点（默认供应商 claude-haiku-3-5 等非目录模型）收到 OpenAI 格式
  // 请求必然失败。anthropic 端点用 anthropic-messages 协议。
  const isAnthropic = /anthropic/i.test(baseUrl) || provider === "anthropic";
  return {
    id: modelId,
    name: modelId,
    api: (isAnthropic ? "anthropic-messages" : "openai-completions") as "anthropic-messages" | "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options?.contextWindow ?? 128000,
    maxTokens: 4096,
    compat: {
      supportsDeveloperRole: true,
      supportsStrictMode: false,
      supportsReasoningEffort: false,
      reasoningEffortMap: {},
      supportsReasoningParams: false,
      thinkingFormat: "openai" as const,
      reasoningDisableMode: "omit" as const,
      omitReasoningEffort: false,
      includeEncryptedReasoning: false,
      filterReasoningHistory: false,
      disableReasoningOnForcedToolChoice: false,
      disableReasoningOnToolChoice: false,
      supportsToolChoice: true,
      supportsForcedToolChoice: true,
      supportsNamedToolChoice: true,
      reasoningContentField: undefined,
      requiresReasoningContentForToolCalls: false,
      requiresReasoningContentForAllAssistantTurns: false,
      allowsSyntheticReasoningContentForToolCalls: false,
      replayReasoningContent: false,
      qwenPreserveThinking: false,
      requiresThinkingAsText: false,
      requiresMistralToolIds: false,
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      requiresAssistantContentForToolCalls: false,
      stripDeepseekSpecialTokens: false,
      streamMarkupHealingPattern: undefined,
      reasoningDeltasMayBeCumulative: false,
      emptyLengthFinishIsContextError: false,
      usesOpenAIToolCallIdLimit: false,
      promptCacheSessionHeader: undefined,
      isOpenRouterHost: false,
      alwaysSendMaxTokens: true,
      enableGeminiThinkingLoopGuard: undefined,
      openRouterRouting: undefined,
      wireModelIdMode: "raw" as const,
      supportsStore: false,
      supportsMultipleSystemMessages: true,
      maxTokensField: "max_tokens" as const,
      supportsUsageInStreaming: true,
      cacheControlFormat: undefined,
      supportsLongPromptCacheRetention: false,
      supportsImageDetailOriginal: false,
      strictResponsesPairing: false,
      toolStrictMode: "none" as const,
      streamIdleTimeoutMs: undefined,
      vercelGatewayRouting: undefined,
      extraBody: undefined,
    },
  } as Model;
}
