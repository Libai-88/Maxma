/**
 * kernel/model.ts — 模型解析与凭据注入（阶段一 §6.2 任务 7）。
 *
 * 全部走 pi 官方 ModelRuntime API（官方 SDK 示例 02-custom-model / 09-api-keys-and-oauth）：
 *   - ModelRuntime.create()                          ← 规范的 auth/model 运行时
 *   - modelRuntime.setRuntimeApiKey(provider, key)   ← 运行时密钥覆盖（示例 09）
 *   - modelRuntime.getModel(provider, id)            ← registry 查找（含 models.json 自定义）
 *   - modelRuntime.registerProvider(id, config)      ← 自定义 provider 程序化注册（baseUrl/apiKey/api/models）
 *
 * 参数语义镜像 OMP 版 parseModel（src/model.ts）：provider 覆写存在时 modelStr
 * 整体视为 model id。registry 未命中且带 baseUrl/providerType 时注册单模型
 * 自定义 provider（ProviderConfigInput，字段默认值镜像 OMP Option B 兜底）。
 */

import { ModelRuntime, type ModelRuntime as ModelRuntimeType } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface MaxmaModelParams {
  /** "provider/model-id" 或裸 model id（provider 覆写存在时整体视为 id）。 */
  model: string;
  /** 显式 provider（Maxma providers.yaml）。 */
  provider?: string;
  /** 自定义端点。 */
  baseUrl?: string;
  /** 凭据信封解密后的 API key。 */
  apiKey?: string;
  /** provider api 类型（如 openai-completions / anthropic-messages），来自 providers.yaml。 */
  providerType?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ResolvedPiModel {
  model: Model<Api>;
  modelRuntime: ModelRuntimeType;
}

/** 零成本兜底定价（Usage.cost 同形状；自定义端点无目录价可用）。 */
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export async function resolvePiModel(p: MaxmaModelParams): Promise<ResolvedPiModel> {
  const modelRuntime = await ModelRuntime.create();

  // 与 OMP parseModel 相同的 provider/id 拆分语义
  const slashIdx = p.model.indexOf("/");
  const parsedProvider = slashIdx >= 0 ? p.model.slice(0, slashIdx) : "";
  const parsedModelId = slashIdx >= 0 ? p.model.slice(slashIdx + 1) : p.model;
  const provider = p.provider ?? parsedProvider;
  const modelId = p.provider ? p.model : parsedModelId;

  if (!provider) {
    throw new Error(`model string must be "provider/model-id" when no provider override is given: ${p.model}`);
  }

  // 1) 运行时密钥（官方示例 09：请求期覆盖 auth.json）
  if (p.apiKey) {
    await modelRuntime.setRuntimeApiKey(provider, p.apiKey);
  }

  // 2) registry 查找（内建目录 + models.json 自定义模型）
  let model = modelRuntime.getModel(provider, modelId);

  // 3) 未命中且带自定义端点/api 类型 → 注册单模型自定义 provider 后重查
  if (!model && (p.baseUrl || p.providerType)) {
    modelRuntime.registerProvider(provider, {
      name: provider,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      ...(p.apiKey ? { apiKey: p.apiKey } : {}),
      ...(p.providerType ? { api: p.providerType as Api } : {}),
      models: [
        {
          id: modelId,
          name: modelId,
          input: ["text"],
          cost: ZERO_COST,
          reasoning: false,
          contextWindow: p.contextWindow ?? 128_000,
          maxTokens: p.maxTokens ?? 8_192,
        },
      ],
    });
    model = modelRuntime.getModel(provider, modelId);
  }

  if (!model) {
    throw new Error(
      `model not found in pi registry: ${provider}/${modelId}` +
        (p.baseUrl ? "" : "（自定义端点请随 providers.yaml 配置 base_url）"),
    );
  }

  return { model, modelRuntime };
}
