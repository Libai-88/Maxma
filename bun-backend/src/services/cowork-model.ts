/**
 * M4 任务级模型路由（T4.3）。
 *
 * 三档策略：
 * - private：只允许本机模型；本机不可达就明确失败，不偷偷上云。
 * - balanced：优先本机；本机不可达且任务允许云端时切云端。
 * - quality：优先云端质量档；无可用云端时回落本机。
 *
 * data_policy=local_only 会强制 private，并在路由层拒绝任何云端候选；
 * 这样“0 次云端请求”不是靠提示词，而是路由根本不会返回云端 provider。
 */
import { isLocalProviderUrl, type ModelFit } from "./hardware";
import { probeLocalModelCached } from "./model-fallback";
import { decryptProviderKey, findProvider, loadProviders } from "../routes/providers";
import { CoworkConflictError } from "./cowork-store";

export type CoworkModelProfile = "private" | "balanced" | "quality";

export interface CoworkModelPolicy {
  profile: CoworkModelProfile;
  /** 选择原因，写入事件供 UI 解释。 */
  source: "task" | "project" | "default";
}

export interface CostEstimate {
  currency: "USD";
  prompt_tokens: number;
  max_output_tokens: number;
  input_usd_per_1k: number | null;
  output_usd_per_1k: number | null;
  estimated_usd: number | null;
  note: string;
}

export interface CoworkModelRoute {
  provider_id: string;
  provider_label: string;
  model: string;
  location: "local" | "cloud";
  profile: CoworkModelProfile;
  fit: ModelFit;
  reason: string;
  fallback: { from_provider: string; from_model: string; reason: string } | null;
  cost: CostEstimate;
  params: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function modelNames(entry: Record<string, unknown>): string[] {
  if (!Array.isArray(entry.models)) return [];
  return entry.models
    .map((item) => (typeof item === "string" ? item : text(record(item).id)))
    .filter((name): name is string => Boolean(name));
}

export function normalizeModelProfile(value: unknown): CoworkModelProfile {
  return value === "private" || value === "quality" || value === "balanced" ? value : "balanced";
}

export function readCoworkModelPolicy(raw: string): CoworkModelPolicy {
  try {
    const parsed = record(JSON.parse(raw || "{}"));
    return { profile: normalizeModelProfile(parsed.profile), source: parsed.profile ? "task" : "default" };
  } catch {
    return { profile: "balanced", source: "default" };
  }
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function estimateCost(
  provider: Record<string, unknown>,
  promptChars: number,
  maxOutputTokens: number,
  location: "local" | "cloud",
): CostEstimate {
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
  if (location === "local") {
    return {
      currency: "USD",
      prompt_tokens: promptTokens,
      max_output_tokens: maxOutputTokens,
      input_usd_per_1k: 0,
      output_usd_per_1k: 0,
      estimated_usd: 0,
      note: "本机模型，无 API 费用",
    };
  }
  const inputPrice = numberValue(provider.price_input_per_1k ?? provider.input_price_per_1k)
    ?? numberValue(record(provider.pricing).input_usd_per_1k);
  const outputPrice = numberValue(provider.price_output_per_1k ?? provider.output_price_per_1k)
    ?? numberValue(record(provider.pricing).output_usd_per_1k);
  if (inputPrice === null || outputPrice === null) {
    return {
      currency: "USD",
      prompt_tokens: promptTokens,
      max_output_tokens: maxOutputTokens,
      input_usd_per_1k: inputPrice,
      output_usd_per_1k: outputPrice,
      estimated_usd: null,
      note: "渠道未配置输入/输出单价，无法估算；不会把未知成本写成 0",
    };
  }
  const estimated = (promptTokens / 1000) * inputPrice + (maxOutputTokens / 1000) * outputPrice;
  return {
    currency: "USD",
    prompt_tokens: promptTokens,
    max_output_tokens: maxOutputTokens,
    input_usd_per_1k: inputPrice,
    output_usd_per_1k: outputPrice,
    estimated_usd: Math.round(estimated * 10_000) / 10_000,
    note: `按 ${inputPrice}/${outputPrice} USD 每千 token 估算`,
  };
}

function routeParams(provider: Record<string, unknown>, model: string): Record<string, unknown> {
  const apiKey = decryptProviderKey(provider.api_key);
  return {
    model,
    provider: text(provider.id),
    ...(typeof provider.base_url === "string" && provider.base_url ? { base_url: provider.base_url } : {}),
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(typeof provider.provider_type === "string" && provider.provider_type
      ? { provider_type: provider.provider_type }
      : {}),
    ...(Number(provider.context_window) > 0 ? { context_window: Number(provider.context_window) } : {}),
    ...(provider.reasoning === true ? { reasoning: true } : {}),
  };
}

function candidate(providers: Record<string, unknown>[], location: "local" | "cloud"): { provider: Record<string, unknown>; model: string } | null {
  for (const provider of providers) {
    if (provider.enabled === false) continue;
    const models = modelNames(provider);
    if (models.length === 0) continue;
    const baseUrl = text(provider.base_url);
    if (isLocalProviderUrl(baseUrl) !== (location === "local")) continue;
    if (location === "cloud" && !text(provider.api_key)) continue;
    return { provider, model: models[0]! };
  }
  return null;
}

function buildRoute(
  found: { provider: Record<string, unknown>; model: string },
  profile: CoworkModelProfile,
  promptChars: number,
  maxOutputTokens: number,
  reason: string,
  fallback: CoworkModelRoute["fallback"] = null,
): CoworkModelRoute {
  const baseUrl = text(found.provider.base_url);
  const location = isLocalProviderUrl(baseUrl) ? "local" : "cloud";
  return {
    provider_id: text(found.provider.id),
    provider_label: text(found.provider.label ?? found.provider.id),
    model: found.model,
    location,
    profile,
    fit: location === "local" ? "ok" : "cloud",
    reason,
    fallback,
    cost: estimateCost(found.provider, promptChars, maxOutputTokens, location),
    params: routeParams(found.provider, found.model),
  };
}

function explicitRoute(providers: Record<string, unknown>[], explicit: string, profile: CoworkModelProfile, promptChars: number, maxOutputTokens: number): CoworkModelRoute | null {
  if (!explicit.includes("/")) return null;
  const providerId = explicit.slice(0, explicit.indexOf("/"));
  const model = explicit.slice(explicit.indexOf("/") + 1);
  const provider = findProvider(providers, providerId);
  if (!provider || provider.enabled === false) return null;
  if (!modelNames(provider).includes(model)) return null;
  return buildRoute({ provider, model }, profile, promptChars, maxOutputTokens, "MAXMA_COWORK_MODEL 显式指定");
}

export interface ResolveCoworkModelInput {
  dataPolicy: string;
  modelPolicyJson: string;
  promptChars: number;
  longDocument?: boolean;
  maxOutputTokens?: number;
  providers?: Record<string, unknown>[];
  probeLocal?: typeof probeLocalModelCached;
}

export async function resolveCoworkModelRoute(input: ResolveCoworkModelInput): Promise<CoworkModelRoute> {
  const providers = (input.providers ?? loadProviders()).filter((entry) => entry.enabled !== false);
  if (providers.length === 0) throw new CoworkConflictError("没有可用的模型提供商：请先启用一个渠道，或设置 MAXMA_COWORK_MODEL");
  const maxOutput = Math.max(256, Math.min(32_000, input.maxOutputTokens ?? 8192));
  const localOnly = input.dataPolicy === "local_only";
  const policy = readCoworkModelPolicy(input.modelPolicyJson);
  const requestedProfile = localOnly ? "private" : (input.longDocument ? "quality" : policy.profile);
  const explicit = process.env.MAXMA_COWORK_MODEL?.trim() ?? "";
  const explicitCandidate = explicitRoute(providers, explicit, requestedProfile, input.promptChars, maxOutput);
  if (explicitCandidate) {
    if (localOnly && explicitCandidate.location === "cloud") {
      throw new CoworkConflictError("local_only 任务禁止使用云端模型；请改用本机渠道或切换数据策略");
    }
    return explicitCandidate;
  }

  if (requestedProfile === "quality") {
    const cloud = candidate(providers, "cloud");
    if (cloud) {
      return buildRoute(cloud, requestedProfile, input.promptChars, maxOutput,
        input.longDocument ? "长文档优先质量档" : "quality 策略优先云端");
    }
  }

  const local = candidate(providers, "local");
  if (local) {
    const probe = await (input.probeLocal ?? probeLocalModelCached)!(text(local.provider.base_url));
    if (probe.reachable) {
      return buildRoute(local, requestedProfile, input.promptChars, maxOutput,
        requestedProfile === "quality" ? "无可用云端，回落本机" : "优先本机模型");
    }
    if (requestedProfile === "private" || localOnly) {
      throw new CoworkConflictError(`本机模型不可达（${probe.detail}）；local_only/private 不会切换到云端`);
    }
    const cloud = candidate(providers, "cloud");
    if (cloud) {
      return buildRoute(cloud, requestedProfile, input.promptChars, maxOutput,
        `本机不可达（${probe.detail}），按 balanced 切换到云端`,
        { from_provider: text(local.provider.id), from_model: local.model, reason: probe.detail });
    }
    throw new CoworkConflictError(`本机模型不可达（${probe.detail}），且没有可用云端渠道`);
  }

  if (localOnly || requestedProfile === "private") {
    throw new CoworkConflictError("local_only/private 任务需要本机模型；当前没有启用的本机渠道，已阻断云端");
  }
  const cloud = candidate(providers, "cloud");
  if (cloud) {
    return buildRoute(cloud, requestedProfile, input.promptChars, maxOutput,
      requestedProfile === "quality" ? "quality 策略使用云端" : "没有本机渠道，使用云端");
  }
  throw new CoworkConflictError("没有可用的模型提供商：请先启用一个渠道，或设置 MAXMA_COWORK_MODEL");
}
