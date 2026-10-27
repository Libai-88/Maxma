import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Model, SimpleStreamOptions, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createHash, randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const QUARTET = ["bash", "glob", "grep", "read"] as const;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const upstream = openAICompletionsApi();
const sessionIds = new Map<string, string>();
/**
 * 内置免费渠道（Maxma 免费模型）的模型标识——**唯一来源**，
 * `bun-backend/src/services/opencode-zen.ts` 从这里取，不再各自抄一份
 * （此前同一个 id 在 5 处出现：kernel 2 处、services 3 处，失效时改不完）。
 */
export const FREE_LANE_PRIMARY_MODEL_ID = "mimo-v2.6-flash-free";

/**
 * 兜底候选：**必须是上游目录里仍在提供的免费模型**。
 *
 * 2026-10-27 实测 `GET https://opencode.ai/zen/v1/models` 返回 84 个模型、
 * 8 个 `-free`，其中**没有** `space-bunny-free`。保留它作为兜底目标只会发出一版
 * 必然失败的请求，用户看到的是 `Model is unavailable`——一条注定失败、又没有
 * 任何信号的分支。因此这里置空，并保留注释说明怎么加回来：
 * 上游恢复该模型（或新增其它可用免费模型）时，把 id 加进本数组即可，
 * 兜底与离线默认可见性会一起生效，不必再改第二个地方。
 */
export const FREE_LANE_FALLBACK_MODEL_IDS: readonly string[] = [];

/**
 * **实测不可用**的免费模型——与上面两个正向常量同属"免费渠道可用模型"这一个事实，
 * 所以放在同一处（`bun-backend/src/services/opencode-zen.ts` 从这里取用）。
 *
 * 判据来自 `scripts/verify-free-models.mjs` 的可重复实测（不是猜测）：
 *   - `beam-free`：实测 `403 RegionError — This model is not available in your
 *     country`。这是**地区**限制、与额度无关，不会"过阵子就好"，
 *     也不该因为"上游列表里有它"就放行。
 *   - `space-bunny-free`：实测已从 `GET /zen/v1/models` 消失（下架），
 *     而它曾被当作兜底目标与便携包内置可选项。
 *
 * 之所以要显式记下来：上游目录随时变，而"不能用"这个结论只能靠实测得出、
 * 读代码读不出来；不记下来就会有人看到列表里有它、顺手放回白名单。
 */
export const FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS: readonly string[] = [
  "beam-free",
  "space-bunny-free",
];

function base62From(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => BASE62[byte % BASE62.length]).join("");
}

function timestampPrefix(kind: "ses" | "msg"): string {
  const timestamp = BigInt(Date.now());
  const value = kind === "ses" ? ~(timestamp * 0x1000n + 1n) : timestamp * 0x1000n + 1n;
  let hex = "";
  for (let index = 0; index < 6; index += 1) {
    hex += Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, "0");
  }
  return hex;
}

function stableSessionId(seed: string): string {
  const existing = sessionIds.get(seed);
  if (existing) return existing;
  const id = opencodeZenGatewayId("ses", seed);
  sessionIds.set(seed, id);
  return id;
}

export function opencodeZenGatewayId(prefix: "ses" | "msg", value: string): string {
  const digest = createHash("sha256").update(`maxma-opencode-zen\0${value}`).digest();
  return `${prefix}_${timestampPrefix(prefix)}${base62From(digest.subarray(6, 20))}`;
}

function toolNames(messages: TranscriptContext["messages"]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsAdded ?? []) names.add(tool.name.toLowerCase());
  }
  return names;
}

function withFingerprint(context: TranscriptContext): TranscriptContext {
  const names = toolNames(context.messages);
  const additions: Tool[] = QUARTET.filter((name) => !names.has(name)).map((name) => ({
    name,
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  }));
  if (additions.length === 0) return context;
  return {
    messages: [...context.messages, { role: "system", content: "", toolsAdded: additions }],
  } as TranscriptContext;
}

/** OpenCode Zen's free lane needs the same client identity and tool quartet as OpenCode. */
export function opencodeZenStreamSimple(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
  /**
   * 兜底候选，默认取 `FREE_LANE_FALLBACK_MODEL_IDS`（当前为空——上游不再提供
   * space-bunny-free）。参数化是为了让**机制本身**继续被测试覆盖：注入一个假目标
   * 就能验证"主模型无输出时换名重发"，不必为了测试而保留一条线上必然失败的请求。
   */
  fallbacks: readonly string[] = FREE_LANE_FALLBACK_MODEL_IDS,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void pumpOpencodeZenStream(stream, model, context, options, fallbacks);
  return stream;
}

async function pumpOpencodeZenStream(
  output: AssistantMessageEventStream,
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
  fallbacks: readonly string[] = FREE_LANE_FALLBACK_MODEL_IDS,
): Promise<void> {
  const streamOptions = buildStreamOptions(context, model, options);
  const primary = upstream.streamSimple(model, withFingerprint(context), streamOptions);
  let sawAnswer = false;

  for await (const event of primary) {
    if (event.type === "text_delta" || event.type === "toolcall_start" || event.type === "toolcall_delta") {
      sawAnswer = true;
    }
    const wantsFallback =
      model.id === FREE_LANE_PRIMARY_MODEL_ID && !sawAnswer && options?.signal?.aborted !== true;
    if (wantsFallback && (event.type === "error" || event.type === "done")) {
      const [fallbackId] = fallbacks;
      if (!fallbackId) {
        // 没有可用的兜底目标（当前就是这种情况：上游目录已不提供 space-bunny-free）。
        // 明确说出来，别让"兜底没发生"和"兜底失败"在日志里长得一样。
        console.warn(`[opencode-zen] ${model.id} 未产出内容（事件 ${event.type}），且无可用兜底模型`);
        output.push(event);
        continue;
      }
      // 兜底必须留痕：此前是静默换名重发，用户只看到最后一句 "Model is unavailable"，
      // 既不知道发生过兜底、也不知道目标是谁。
      console.warn(`[opencode-zen] ${model.id} 未产出内容，兜底到 ${fallbackId}（事件类型 ${event.type}）`);
      const fallbackModel = { ...model, id: fallbackId, name: fallbackId, reasoning: true };
      const fallback = upstream.streamSimple(
        fallbackModel,
        withFingerprint(context),
        buildStreamOptions(context, fallbackModel, options),
      );
      for await (const fallbackEvent of fallback) output.push(fallbackEvent);
      output.end();
      return;
    }
    output.push(event);
  }
  output.end();
}

function buildStreamOptions(
  context: TranscriptContext,
  model: Model<"openai-completions">,
  options?: SimpleStreamOptions,
): SimpleStreamOptions {
  const firstUser = context.messages.find((message) => message.role === "user");
  const sessionSeed = String((options as Record<string, unknown> | undefined)?.sessionId
    ?? JSON.stringify(firstUser ?? model.provider));
  const requestSeed = randomUUID();
  const headers = {
    ...(options?.headers ?? {}),
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: "Bearer public",
    "user-agent": "opencode/1.18.31",
    "x-opencode-client": "desktop",
    "x-opencode-session": stableSessionId(sessionSeed),
    "x-opencode-request": opencodeZenGatewayId("msg", requestSeed),
    "x-opencode-project": "global",
  };
  return { ...options, headers };
}

export function registerOpencodeZenTransport(runtime: { registerProvider: (id: string, config: Record<string, unknown>) => void }, modelId: string, baseUrl = DEFAULT_BASE_URL): void {
  runtime.registerProvider("opencode-zen", {
    name: "Maxma 免费模型",
    baseUrl,
    api: "openai-completions",
    compat: {
      maxTokensField: "max_tokens",
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsDeveloperRole: false,
    },
    streamSimple: opencodeZenStreamSimple,
    models: [{
      id: modelId,
      name: modelId,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 32768,
    }],
  });
}
