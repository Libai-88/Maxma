import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Model, SimpleStreamOptions, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import type { AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createHash } from "node:crypto";

/**
 * OpenCode 免费渠道的端点。
 *
 * ⚠️ 上游 2026-10 起把推理/目录端点从 `/zen/v1` 迁到 **`/inference/v1`**。
 * 依据是上游原始仓库（gitee.com/iJetLi/deepseek-harness-codearts）的
 * `src/opencode-product.ts`：`baseUrl: 'https://opencode.ai/inference'`，
 * 且其 `docs/agent-notes/providers-opencode.md` 的逐变量实测矩阵明确记着
 * 「端点 `/zen/v1`（旧）→ **403**」。
 *
 * 实测补充（2026-10-28，本机）：两个端点的 `GET /v1/models` 都仍返回 84 条模型，
 * 所以**目录能读到并不能证明端点仍然受支持**；聊天门禁那格当时被 429 掩盖
 * （免费额度耗尽，所有组合包括无 auth 都回 429），故按上游源码为准切换。
 * `/zen` 前缀在 `opencode-proxy.ts` 的历史注释里也仍作为「生产主路径」被引用，
 * 但那是**代理缺陷**记录（IKK4BY），不构成端点仍然有效的证据。
 */
export const DEFAULT_BASE_URL = "https://opencode.ai/inference/v1";
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
 * 兜底候选：主模型无输出时按顺序换名重发。
 *
 * ## 依据（不是猜的）
 *
 * 交集运算：**上游原始仓库标为「匿名可用且已实测可用」** ∩ **当前
 * `/inference/v1/models` 仍在提供**。上游那份表在
 * `src/opencode-product.ts` 的 `OPENCODE_FALLBACK_MODELS`（`isFree: true` 条目），
 * 其上方注释写明「『已实测可用』= 用本插件自己的请求形状打过至少一次 200 并拿到正文」。
 *
 * 2026-10-28 实测交集为四条（`mimo-v2.6-flash-free` 已是主模型，故兜底列其余三个）：
 *   mimo-v2.6-flash-free / nemotron-3.5-lightning-free /
 *   deepseek-v4.1-flash-free / glm-5.3-flash-free / nemotron-3.5-super-vl-free
 *
 * ⚠️ 排除项与理由（**别顺手加回来**）：
 *   - `beam-free` / `flint-40b-free` / `jev-1.13-free`：目录里有，但**上游未标为已验证**；
 *     `beam-free` 另有实测 `403 RegionError`（地区封锁，与额度无关）。
 *   - `big-pickle` / `space-bunny-free` / `longcat-2.5-preview-free` /
 *     `nemotron-3-ultra-free`：上游表里有，但**当前目录已不再提供**。
 *     其中 `space-bunny-free` 正是上一轮被当作兜底目标、导致"必然失败"的那一个。
 *
 * ⚠️ 兜底仍然是"尽力而为"：这几个模型当前也可能因额度（429）而失败，
 * 与主模型一样受上游限流影响。它的价值是**换一条通道**，不是保证成功。
 */
export const FREE_LANE_FALLBACK_MODEL_IDS: readonly string[] = [
  "nemotron-3.5-lightning-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "nemotron-3.5-super-vl-free",
];

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

/**
 * 门禁桩工具：**只保留 `read` 一个**，且 schema 必须是上游 `read` 的完整形态。
 *
 * 依据上游原始仓库 `src/opencode-messages.ts` 的 `FREE_LANE_GATE_TOOLS` 与
 * `gateTool()`，以及其 `docs/agent-notes/providers-opencode.md` 的逐变量实测：
 *
 * - 「只带 read」必定放行；**只带 shell/edit/write/glob 一律 403**。
 *   Maxma 此前注入 `["bash","glob","grep","read"]` 四个 —— 多出来的三个既是
 *   403 的来源，也会与客户端同名工具互相干扰（模型偶发选中桩工具）。
 * - **`properties` 为空会 403**。Maxma 此前注入的是
 *   `parameters: { type: "object", properties: {} }`（空 properties）——
 *   这正是"形状门禁"要拒的形态之一。
 * - 描述**不参与校验**（空描述也放行），但上游用了明确的"不要调用"文案；
 *   照抄它，比自创文案更不容易与客户端工具描述混淆。
 * - ⚠️ 上游 `gateTool()` 里还有一个 `strict: false`，而 **Maxma 这一侧发不出去**：
 *   pi 的 `Tool` 类型把 strict 当 provider 能力（`supportsStrictTools`，默认 false），
 *   适配器不会把该字段透传到 wire（实测 wire 上 `strict` 为 `undefined`）。
 *   **不宣称它必需**：上游那张逐变量矩阵只验证了「properties 为空」与「改名」两格，
 *   没有单独验证 strict —— 属未验证项。若将来出现无法归因的 403，
 *   `strict: false` 缺席是**该怀疑的点之一**（已在此登记，避免下次重新推一遍）。
 */
const GATE_TOOL_NAME = "read" as const;

function gateReadTool(): Tool {
  return {
    name: GATE_TOOL_NAME,
    description:
      "Reserved for the host runtime; do not call or select this function. Use tools explicitly supplied by the user instead.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory to read" },
        offset: { type: "integer", minimum: 0, description: "Starting line or directory entry (1-based)" },
        limit: { type: "integer", minimum: 0, description: "Maximum lines or directory entries to read" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  } as Tool;
}

/**
 * 请求里必须带上门禁 `read` —— 但**只有当客户端自己没有 `read` 时才注入**。
 *
 * 上游做法是把门禁 `read` 与客户端工具**并列**广告，然后在响应层把模型对门禁
 * `read` 的调用**剔除**（不执行、只记 warn），因为两者的参数 schema 不同
 * （门禁是 `{path}`、客户端 `read` 是 `{file_path}`），猜错就是执行了模型没打算
 * 调的工具。见其 docs 的「保留门禁工具会被模型真的调用：只能『剔除』，不能整轮报错」。
 *
 * Maxma 这里是"缺失时才补"的变体：客户端已有同名工具时不再注入第二个同名桩
 * （避免同名歧义），代价是那一路请求的门禁由客户端自己的 `read` 满足 —— 该
 * schema 同样非空，符合门禁对形状的要求。
 */
function withFingerprint(context: TranscriptContext): TranscriptContext {
  const names = toolNames(context.messages);
  if (names.has(GATE_TOOL_NAME)) return context;
  return {
    messages: [...context.messages, { role: "system", content: "", toolsAdded: [gateReadTool()] }],
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

/**
 * 依次尝试兜底候选，**直到某一个真的产出了内容**。
 *
 * ## 为什么必须走完整条链（而不是只试第一个）
 *
 * 旧实现只取 `fallbacks[0]` 就 `return`：一旦那一个也失败（换模型后同样 429/403），
 * 整个回合就到此为止 —— 后面几个**明明可用的候选从未被尝试过**，
 * 而用户只看到最后一句 "Model is unavailable"。更糟的是旧行为连"换过一次"
 * 都不留痕。候选清单存在的意义就是「这一条不行还有下一条」，
 * 只试第一条等于把清单退化成单个 id。
 *
 * ⚠️ 每个候选都必须**独立判断是否产出内容**：换名后上游仍可能回同一个错误，
 * 不能只看"请求发出去了"就当成功。只有真的看到正文/工具调用才算数。
 *
 * ⚠️ 中途一旦有候选产出了部分内容，就**停在那里**（保留已输出的帧），
 * 不再继续换 —— 已经有正文了还再换一次会让用户看到两段互相矛盾的回复。
 */
async function runWithFallbacks(
  output: AssistantMessageEventStream,
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  fallbacks: readonly string[],
  primaryEventType: string,
  /**
   * 触发兜底的**那个终态帧**（error / done）。
   *
   * ⚠️ 只回放这一帧，**不能回放主模型的全部帧**：进入兜底分支时，
   * 之前那些非终态帧（message_start / thinking_* 等）**已经由调用方
   * `output.push` 下去了**，再回放一遍会让前端收到重复帧。
   */
  primaryTerminalEvent: AssistantMessageEvent,
): Promise<void> {
  console.warn(
    `[opencode-zen] ${model.id} 未产出内容（事件 ${primaryEventType}），` +
      `按序尝试 ${fallbacks.length} 个兜底候选：${fallbacks.join(" → ")}`,
  );
  for (let index = 0; index < fallbacks.length; index += 1) {
    const fallbackId = fallbacks[index]!;
    const fallbackModel = { ...model, id: fallbackId, name: fallbackId, reasoning: true };
    let sawContent = false;
    const pending: AssistantMessageEvent[] = [];
    try {
      const fallback = upstream.streamSimple(
        fallbackModel,
        withFingerprint(context),
        buildStreamOptions(context, fallbackModel, options),
      );
      for await (const event of fallback) {
        if (
          event.type === "text_delta" ||
          event.type === "toolcall_start" ||
          event.type === "toolcall_delta"
        ) {
          sawContent = true;
        }
        // 有内容之后照常下发；在此之前先攒着 —— 攒的是这一候选自己的帧，
        // 失败时整批丢弃（避免把"某个候选的中间态"泄给前端）。
        if (sawContent) output.push(event);
        else pending.push(event);
      }
    } catch (err) {
      console.warn(`[opencode-zen] 兜底 ${fallbackId} 抛错：${String(err)}`);
      continue;
    }

    if (sawContent) {
      // 先把该候选中"内容出现之前"的帧补上（思考/起始帧），再收尾。
      for (const e of pending) output.push(e);
      console.warn(`[opencode-zen] 兜底生效：${fallbackId}（第 ${index + 1}/${fallbacks.length} 个候选）`);
      output.end();
      return;
    }
    console.warn(`[opencode-zen] 兜底候选 ${fallbackId} 未产出内容`);
  }

  // ⚠️⚠️ 所有候选都失败：**必须把主模型的终态帧如实下发**。
  //
  // 这里曾有一个由本修复引入的静默失败：第一版写成"丢弃所有帧 + output.end()"，
  // 而消费端在既没有正文也没有 error 的情况下**什么都不会产出** ——
  // 真机实测：前端只收到握手 `hello`、随后一直等到超时（对话卡死、零报错、
  // 界面无从判断）。这与本仓反复在修的那类"没有信号的失败"同型。
  // 现在回放触发兜底的那个终态帧，让上游真实原因（429 / 403 / …）到达用户。
  // ⚠️ 只回放**终态帧**：进入兜底之前的非终态帧已经由调用方下发过，
  // 全部回放会让前端收到重复帧。
  console.warn(
    `[opencode-zen] ${fallbacks.length} 个兜底候选全部未产出内容，` +
      `回放主模型终态帧（主模型 ${model.id}）`,
  );
  output.push(primaryTerminalEvent);
  output.end();
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
    const isTerminal = event.type === "error" || event.type === "done";
    if (event.type === "text_delta" || event.type === "toolcall_start" || event.type === "toolcall_delta") {
      sawAnswer = true;
    }
    const wantsFallback =
      model.id === FREE_LANE_PRIMARY_MODEL_ID && !sawAnswer && options?.signal?.aborted !== true;
    if (wantsFallback && isTerminal) {
      if (fallbacks.length === 0) {
        // 没有可用的兜底目标：明确说出来，别让"兜底没发生"与"兜底失败"在日志里同形。
        console.warn(`[opencode-zen] ${model.id} 未产出内容（事件 ${event.type}），且无可用兜底模型`);
        output.push(event);
        continue;
      }
      // 当前这一帧就是触发兜底的终态帧（分支在上面立即 return / continue），
      // 所以直接把它传下去即可 —— 不需要另存数组。
      await runWithFallbacks(output, model, context, options, fallbacks, event.type, event);
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
  const sessionId = stableSessionId(sessionSeed);
  const headers = {
    ...(options?.headers ?? {}),
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: "Bearer public",
    // ── V2 指纹头集（依据上游 `src/opencode.ts` 的 `opencodeHeaders`）──
    // ⚠️ **绝不发送 `x-opencode-request`**：上游逐头实测记着
    //    「带上 `x-opencode-request`（即使三个 affinity 头都在）→ **403**（旧客户端标记即毒药）」。
    //    Maxma 此前每个请求都发 `x-opencode-request: msg_…`，这是 403 的直接来源之一。
    // ⚠️ 唯一**必需**的头是 `x-opencode-session-id`；其余三个 affinity 头保留只为贴合真实 CLI 外形
    //    （上游实测：只带 project+session+client 三头、不带 session-id → 403）。
    // ⚠️ `x-opencode-project` 的**取值形状未经实测**：上游用 40 位十六进制派生值，
    //    而 Maxma 用字面量 `"global"`。上游那组对照只验证了该头的**在场**，
    //    没有验证取值 —— 所以这里不做断言，也不能宣称"已验证"。它不参与门禁
    //    （真正决定放行的是上面的 session-id），但若将来出现无法归因的 403，
    //    这是**第一个该怀疑的点**。
    "user-agent": "opencode/latest/2.0.29/cli",
    "x-opencode-client": "cli",
    "x-opencode-project": "global",
    "x-opencode-session": sessionId,
    "x-opencode-session-id": sessionId,
    "x-session-affinity": sessionId,
    "X-Session-Id": sessionId,
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
