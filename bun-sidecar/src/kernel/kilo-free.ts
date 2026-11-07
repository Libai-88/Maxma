import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

/**
 * kernel/kilo-free.ts — Kilo 免费池渠道（内置第二免费车道）。
 *
 * ## 来源与判据（不是猜的）
 *
 * Kilo AI（https://kilo.ai）公共网关发布 OpenAI 兼容端点，其免费池
 * （清单 `isFree: true` 切片）**完全免凭据**——无 key、无登录、无指纹门禁：
 * 固定 base URL、每轮一个普通 POST。判据是 2026-11-08 用本文件同款请求形状
 * 的逐模型实测（全部候选打真实对话轮）：
 *
 *   - `GET https://api.kilo.ai/api/gateway/models` → 200，383 个模型、12 个 `isFree: true`；
 *   - 12 个免费 id 里 11 个实测 200 且拿到正文；唯一例外
 *     `liquid/lfm-3-1.7b:free` 实测 429（上游限流）——模型存在但
 *     **无法判定可用性**，与 zen 侧 iceman/inkling 同性质，不凭猜测放行。
 *
 * ## 与 OpenCode Zen 免费车道（`kernel/opencode-zen.ts`）的差别
 *
 *   - **无凭据、无门禁**：zen 匿名身份靠指纹头集 + 门禁 `read` 工具放行；
 *     kilo 恰恰相反——**带任何 `Authorization` 头都会按 key 校验**（实测
 *     `Bearer none` → 401），所以传输层唯一特殊动作是**剥掉授权头**。
 *   - **主模型本身就是兜底**：`kilo-auto/free` 是上游的自动路由（在可用免费
 *     模型间轮换），客户端侧不再另做换名重发链——上游已经干了这件事，
 *     再抄一遍 zen 的 fallback 链只会重复它覆盖的场景。
 *
 * ## 隐私（上游自己的声明，须如实带给用户）
 *
 * 免费池全部模型卡均声明 `mayTrainOnYourPrompts: true`——**prompt 可能被
 * 上游记录并用于改进服务**（清单原文，非我们的猜测）。该车道适合日常
 * 对话，不适合敏感内容；这条提示须随渠道一并带给用户。
 *
 * @module kilo-free
 */

/** 聊天端点（pi 的 openai-completions 适配器在其后拼 `/chat/completions`）。 */
export const KILO_DEFAULT_CHAT_BASE_URL = "https://api.kilo.ai/api/gateway/v1";
/** 清单端点（services 周期同步用；与聊天端点同源，分开放避免字符串拼错）。 */
export const KILO_DEFAULT_LISTING_BASE_URL = "https://api.kilo.ai/api/gateway";

/**
 * Kilo 免费池在 Maxma 的 provider 标识——**唯一来源**（kernel 定义，
 * `kernel/model.ts` 的解析分支与 `bun-backend/src/services/kilo-free.ts` 都从
 * 这里取；zen 渠道的同一 id 曾抄在 3 处，是上一轮治理的教训）。
 */
export const KILO_PROVIDER_ID = "kilo-free";

/**
 * 主模型：上游自动路由，在可用免费模型间轮换（实测当轮即被路由到
 * `reflection/beam-free` 并拿到正文）。
 */
export const KILO_PRIMARY_MODEL_ID = "kilo-auto/free";

/**
 * 兜底候选：**实测 200 并拿到正文**的免费直连模型（2026-11-08，逐个真实对话轮），
 * 按当轮实测首字延迟升序排列。同步与目录的可用性门从这里取。
 *
 * ⚠️ 别顺手加回来：`liquid/lfm-3-1.7b:free` 实测 429（无法判定，见文件头）；
 * `google/lyria-3-*` 是音频/视频生成模型（价格为 0 但 `isFree` 不为 true），
 * 不是对话模型，不进本清单。
 */
export const KILO_FALLBACK_MODEL_IDS: readonly string[] = [
  "cohere/north-mini-code:free",
  "reflection/beam-free",
  "nvidia/nemotron-3.5-super-vl:free",
  "openrouter/free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "dots-studio/dots-3-note-preview:free",
  "stealth/glyph-cluster",
  "stealth/crouton-alpha",
];

/**
 * **实测不可用**的免费模型（与正向常量同属"Kilo 免费池可用模型"这一个事实）：
 * `liquid/lfm-3-1.7b:free` 2026-11-08 实测 429（上游限流，是否真可用无法判定）。
 * 记下来的理由与 zen 侧相同："不能用"只能靠实测得出，不记就会有人看到
 * 上游清单里有它、顺手放回白名单。
 */
export const KILO_KNOWN_UNUSABLE_MODEL_IDS: readonly string[] = [
  "liquid/lfm-3-1.7b:free",
];

/**
 * 模型元数据（2026-11-08 清单实测值）：展示名与上下文窗口。
 * 只收白名单内的 id；上游改值后以 sync 拉到的清单为准重建本表。
 */
export const KILO_MODEL_META: Readonly<Record<string, { name: string; contextWindow: number; maxTokens: number }>> = {
  "kilo-auto/free": { name: "Auto Free（自动路由）", contextWindow: 256_000, maxTokens: 32_768 },
  "cohere/north-mini-code:free": { name: "North Mini Code（free）", contextWindow: 256_000, maxTokens: 64_000 },
  "reflection/beam-free": { name: "Beam 1.0（free）", contextWindow: 1_048_576, maxTokens: 131_072 },
  "nvidia/nemotron-3.5-super-vl:free": { name: "Nemotron 3.5 Super VL（free）", contextWindow: 1_000_000, maxTokens: 131_072 },
  "openrouter/free": { name: "OpenRouter 免费路由", contextWindow: 200_000, maxTokens: 32_768 },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": { name: "Nemotron 3 Nano Omni（free）", contextWindow: 256_000, maxTokens: 65_536 },
  "nvidia/nemotron-3.5-lightning:free": { name: "Nemotron 3.5 Lightning（free）", contextWindow: 1_000_000, maxTokens: 65_536 },
  "nvidia/nemotron-3-ultra-550b-a55b:free": { name: "Nemotron 3 Ultra（free）", contextWindow: 1_000_000, maxTokens: 65_536 },
  "dots-studio/dots-3-note-preview:free": { name: "Dots3-Note Preview（free）", contextWindow: 512_000, maxTokens: 460_800 },
  "stealth/glyph-cluster": { name: "Glyph Cluster（free）", contextWindow: 256_000, maxTokens: 256_000 },
  "stealth/crouton-alpha": { name: "Crouton Alpha（free）", contextWindow: 1_048_576, maxTokens: 943_718 },
};

const upstream = openAICompletionsApi();

/**
 * 剥掉授权头的 fetch 包装。
 *
 * Kilo 免费池的放行条件是**无 `Authorization` 头**：带任何 bearer 值都会进
 * key 校验（实测 `Bearer none` → 401）。而 pi 适配器要求请求带 apiKey 或
 * authorization 头（`getClientApiKey`：两者皆无 → 抛 "No API key"），
 * 所以这里传占位 key 让适配器放行、再在 fetch 层把头剥掉——线上形状与
 * 插件参考实现一致（无授权头的普通 POST）。
 */
function kiloFetchInner(url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  if (!init?.headers) return fetch(url, init);
  const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
  headers.delete("authorization");
  return fetch(url, { ...init, headers });
}

/** 与全局 fetch 同形（Bun 类型要求 preconnect）；预热连接不发头，直接委托。 */
export const kiloFetch: typeof fetch = Object.assign(kiloFetchInner, { preconnect: fetch.preconnect });

/**
 * Kilo 免费池的流式回合：默认 openai-completions 适配器 + 授权头剥离。
 *
 * 无客户端侧兜底链（理由见文件头：主模型即上游路由）；无指纹头/门禁工具
 * （那是 zen 网关的放行协议，kilo 不需要）。
 */
export function kiloStreamSimple(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void pumpKiloStream(stream, model, context, options);
  return stream;
}

async function pumpKiloStream(
  output: AssistantMessageEventStream,
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): Promise<void> {
  const streamOptions: SimpleStreamOptions = { ...options, apiKey: "unused", fetch: kiloFetch };
  for await (const event of upstream.streamSimple(model, context, streamOptions)) {
    output.push(event);
  }
  output.end();
}

/**
 * 把 Kilo 免费池传输注册进 ModelRuntime（与 `registerOpencodeZenTransport`
 * 同一模式：按请求的 modelId 注册单模型 provider，`kernel/model.ts` 的
 * 解析分支在 `provider === kilo-free` 时调用）。
 */
export function registerKiloTransport(
  runtime: { registerProvider: (id: string, config: Record<string, unknown>) => void },
  modelId: string,
  baseUrl = KILO_DEFAULT_CHAT_BASE_URL,
): void {
  const meta = KILO_MODEL_META[modelId];
  runtime.registerProvider(KILO_PROVIDER_ID, {
    name: "Kilo 免费池",
    baseUrl,
    api: "openai-completions",
    compat: {
      maxTokensField: "max_tokens",
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsDeveloperRole: false,
    },
    streamSimple: kiloStreamSimple,
    models: [{
      id: modelId,
      name: meta?.name ?? modelId,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true,
      contextWindow: meta?.contextWindow ?? 256_000,
      maxTokens: meta?.maxTokens ?? 32_768,
    }],
  });
}
