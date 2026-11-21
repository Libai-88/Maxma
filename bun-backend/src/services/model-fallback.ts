/**
 * services/model-fallback.ts — 本地模型健康预检与失败回退选择。
 *
 * 边界：
 * - 只探测 provider 的 `/models`，不发推理请求、不改模型参数。
 * - 只做一次短路回退：本地不可达时挑一个非 too_large 的候选，绝不无限重试。
 * - 探测只允许本机地址，避免把内网/公网端点当成本地模型探针。
 */
import { isLocalProviderUrl, type ModelRouteCandidate } from "./hardware";

export interface LocalProviderProbe {
  reachable: boolean;
  models: string[];
  detail: string;
}

const DEFAULT_TIMEOUT_MS = 2500;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item === "string" && item.trim()) {
      ids.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const id = entry.id ?? entry.name ?? entry.model;
    if (typeof id === "string" && id.trim()) ids.push(id.trim());
  }
  return [...new Set(ids)];
}

/** 探测 OpenAI 兼容的 `/models`；任何网络/格式问题都归为不可达，不抛异常。 */
export async function probeLocalProvider(
  baseUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalProviderProbe> {
  if (!isLocalProviderUrl(baseUrl)) {
    return { reachable: false, models: [], detail: "不是本机地址，已拒绝探测" };
  }
  const url = `${trimTrailingSlash(baseUrl)}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(300, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { reachable: false, models: [], detail: `HTTP ${response.status}` };
    }
    const payload = await response.json().catch(() => null);
    const models = extractModelIds(payload);
    return { reachable: true, models, detail: models.length ? `发现 ${models.length} 个模型` : "服务可达，但未返回模型列表" };
  } catch (error) {
    const detail = error instanceof Error
      ? error.name === "AbortError" ? `连接超时（${Math.max(300, timeoutMs)}ms）` : error.message
      : String(error);
    return { reachable: false, models: [], detail };
  } finally {
    clearTimeout(timer);
  }
}

/** 从已排序候选里选一个可回退路由；排除当前失败的 provider/model 与超显存模型。 */
export function pickFallbackRoute(
  candidates: ModelRouteCandidate[],
  exclude: { providerId?: string; model?: string } = {},
): ModelRouteCandidate | null {
  for (const candidate of candidates) {
    if (candidate.fit === "too_large") continue;
    if (exclude.providerId && candidate.providerId === exclude.providerId) continue;
    if (exclude.model && candidate.model === exclude.model) continue;
    if (!candidate.providerId || !candidate.model) continue;
    return candidate;
  }
  return null;
}

// ── 开轮前的本地模型预检与短路回退 ──

/** 本地模型健康预检缓存：避免每条消息都等 2.5s 探测；失败 30s 内不重复打。 */
const LOCAL_MODEL_PROBE_TTL_MS = 60_000;
const LOCAL_MODEL_FAILURE_TTL_MS = 30_000;
const localModelProbeCache = new Map<string, { at: number; reachable: boolean; detail: string; models: string[] }>();

export async function probeLocalModelCached(baseUrl: string): Promise<LocalProviderProbe> {
  const key = trimTrailingSlash(baseUrl);
  const cached = localModelProbeCache.get(key);
  if (cached) {
    const ttl = cached.reachable ? LOCAL_MODEL_PROBE_TTL_MS : LOCAL_MODEL_FAILURE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached;
  }
  const probe = await probeLocalProvider(key);
  localModelProbeCache.set(key, {
    at: Date.now(),
    reachable: probe.reachable,
    detail: probe.detail,
    models: probe.models,
  });
  return probe;
}

export interface LocalFallbackResolution {
  candidate: ModelRouteCandidate;
  probeDetail: string;
}

/**
 * 本地模型失败自动回退：只在发 prompt 前做一次短路探测。
 *
 * 不重试已经开始的回合——预检失败直接换到排序后的下一个候选，避免
 * 用户看着本地模型超时后才收到一条错误。云端模型不做预检（不额外打网络）。
 * providers 由调用方从 providers.yaml 读入，服务层不反向依赖路由模块。
 */
export async function resolveLocalFallback(
  provider: Record<string, unknown>,
  modelName: string,
  providers: readonly Record<string, unknown>[],
): Promise<LocalFallbackResolution | null> {
  const baseUrl = typeof provider.base_url === "string" ? provider.base_url : "";
  if (!baseUrl || !isLocalProviderUrl(baseUrl)) return null;
  const probe = await probeLocalModelCached(baseUrl);
  if (probe.reachable) return null;
  try {
    const failedId = String(provider.id ?? "");
    // 1) 优先云端：本地挂了不依赖本机硬件重新探测，直接换到有凭据的云渠道。
    for (const entry of providers) {
      const id = String(entry.id ?? "");
      if (!id || id === failedId || entry.enabled === false) continue;
      const entryUrl = typeof entry.base_url === "string" ? entry.base_url : "";
      if (isLocalProviderUrl(entryUrl)) continue;
      const hasKey = typeof entry.api_key === "string" && entry.api_key.length > 0;
      if (!hasKey) continue;
      const model = Array.isArray(entry.models) ? String(entry.models.find((m) => String(m ?? "").trim()) ?? "") : "";
      if (!model || model === modelName) continue;
      return {
        candidate: {
          providerId: id,
          providerLabel: String(entry.label ?? id),
          model,
          location: "cloud",
          fit: "cloud",
          requiredMemoryGb: null,
          device: "remote",
          reason: "本地模型不可达，切换到有凭据的云端渠道",
        },
        probeDetail: probe.detail,
      };
    }
    // 2) 再试另一台本机服务（例如 Ollama 挂了但 LM Studio 在跑）。
    for (const entry of providers) {
      const id = String(entry.id ?? "");
      if (!id || id === failedId || entry.enabled === false) continue;
      const entryUrl = typeof entry.base_url === "string" ? entry.base_url : "";
      if (!isLocalProviderUrl(entryUrl)) continue;
      const targetProbe = await probeLocalModelCached(entryUrl);
      if (!targetProbe.reachable || targetProbe.models.length === 0) continue;
      const model = Array.isArray(entry.models) && entry.models.length > 0
        ? String(entry.models[0])
        : targetProbe.models[0] ?? "";
      if (!model || model === modelName) continue;
      return {
        candidate: {
          providerId: id,
          providerLabel: String(entry.label ?? id),
          model,
          location: "local",
          fit: "ok",
          requiredMemoryGb: null,
          device: "cpu",
          reason: "另一个本机模型服务可用",
        },
        probeDetail: probe.detail,
      };
    }
    return null;
  } catch {
    return null;
  }
}
