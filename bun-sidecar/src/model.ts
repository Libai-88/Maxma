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
      if (bundled) return bundled;
    } catch {
      // Fall through to manual construction
    }
  }

  // Option B: manual fallback (minimal Model object from env vars)
  const baseUrl = options?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions" as const,
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
