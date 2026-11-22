/**
 * 任务会话的模型来源解析。
 *
 * 优先 `MAXMA_COWORK_MODEL=provider/model`，否则取 providers.yaml 里第一个启用且
 * 有模型的渠道（内置免费池排在最前）。不在任务表里存密钥；每次建会话时解密，
 * 避免把凭据落进事件/快照。
 */

import { CoworkConflictError } from "./cowork-store";
import { decryptProviderKey, findProvider, loadProviders } from "../routes/providers";

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

export function resolveCoworkModelParams(): Record<string, unknown> {
  const providers = loadProviders().filter((entry) => entry.enabled !== false);
  const explicit = process.env.MAXMA_COWORK_MODEL?.trim() ?? "";
  const provider = explicit
    ? findProvider(providers, explicit.split("/")[0] ?? "")
    : providers.find((entry) => modelNames(entry).length > 0) ?? null;
  if (!provider || modelNames(provider).length === 0) {
    throw new CoworkConflictError(
      "没有可用的模型提供商：请先在设置里启用一个渠道，或设置 MAXMA_COWORK_MODEL",
    );
  }
  const model = explicit && explicit.includes("/")
    ? explicit.slice(explicit.indexOf("/") + 1)
    : modelNames(provider)[0]!;
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
