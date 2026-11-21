/**
 * routes/chat-model-fallback.ts — 开轮前的本地模型短路回退。
 *
 * 从 chat-ws 抽出：路由只负责决定“换不换”，这里负责重新解析模型、
 * 广播 model_fallback 并写活动记录。只执行一次，不重试已开始的回合。
 */
import { resolvePiModel, type ResolvedPiModel } from "../../../bun-sidecar/src/kernel/model";
import { record as recordActivity } from "../activity-hub";
import { resolveLocalFallback } from "../services/model-fallback";
import { decryptProviderKey, findProvider, loadProviders, type ProviderEntry } from "./providers";

export interface AppliedModelFallback {
  providerId: string;
  modelName: string;
  resolved: ResolvedPiModel;
}

export async function applyLocalModelFallback(args: {
  provider: ProviderEntry;
  providerId: string;
  modelName: string;
  maxTokens?: number;
  modelRuntime?: Parameters<typeof resolvePiModel>[1];
  sessionId: string;
  turnId: string;
  broadcast: (sessionId: string, event: { type: string; payload?: unknown }) => void;
}): Promise<AppliedModelFallback | null> {
  const fallback = await resolveLocalFallback(args.provider, args.modelName, loadProviders());
  if (!fallback) return null;
  const target = findProvider(loadProviders(), fallback.candidate.providerId);
  if (!target) return null;

  const from = {
    provider_id: args.providerId,
    model: args.modelName,
    label: String(args.provider.label ?? args.providerId),
  };
  const providerId = fallback.candidate.providerId;
  const modelName = fallback.candidate.model;
  const resolved = await resolvePiModel(
    {
      model: modelName,
      provider: providerId,
      baseUrl: typeof target.base_url === "string" ? target.base_url : undefined,
      apiKey: decryptProviderKey(target.api_key),
      providerType: typeof target.provider_type === "string" ? target.provider_type : undefined,
      contextWindow: Number(target.context_window) || undefined,
      reasoning: target.reasoning === true,
      maxTokens: args.maxTokens,
    },
    args.modelRuntime,
  );

  args.broadcast(args.sessionId, {
    type: "model_fallback",
    payload: {
      from,
      to: {
        provider_id: providerId,
        model: modelName,
        label: String(target.label ?? providerId),
      },
      reason: `本机模型不可达：${fallback.probeDetail}`,
    },
  });
  recordActivity("turn", "model_fallback", {
    session_id: args.sessionId,
    turn_id: args.turnId,
    message: fallback.probeDetail,
    payload: { from: from.provider_id, to: providerId },
  });
  return { providerId, modelName, resolved };
}
