/**
 * plugins/dsh/pi-bridge.ts — 把插件的模型接进 **pi**（Maxma 的引擎）。
 *
 * 这是「融合进 Maxma」的核心一步。插件（Jet Hub）按 DSH 的 `LlmAdapter` 契约实现了
 * 14 个渠道的模型调用；Maxma 的会话只认 pi 的模型。本模块做**双向翻译**：
 *
 *   pi 侧                                  DSH 插件侧
 *   ────────────────────────────────────   ──────────────────────────────────
 *   StreamFunction(model, ctx, options) →  prepareCall(provider, model).stream(opts)
 *   TranscriptContext.messages          →  GenerateOptions.messages
 *   system 消息上的 toolsAdded           →  GenerateOptions.tools
 *   reasoning / maxTokens / temperature →  reasoningEffort / maxTokens / temperature
 *   AssistantMessageEventStream         ←  StreamChunk（text-delta / reasoning-delta /
 *                                           tool-call-delta / block-end / usage / finish）
 *
 * ⚠️ 两条铁律（都来自插件 AGENTS.md 记录的线上事故）：
 *   1. **生产派发只走 `prepareCall().stream(options)`**，绝不直接调适配器的顶层
 *      `stream()` —— 否则插件的 Token 记账与失效模型剔除包装会静默失效
 *      （请求照常成功、账本永远为空）。本模块只调 `prepareCall`。
 *   2. 工具结果一律发**旧形状**（`role:'user'` 内嵌 `{type:'tool-result'}`）。
 *      插件自带 `normalizeHarnessMessages()` 会把 0.1.7 的一等 `role:'tool'` 降级成
 *      这个形状，对已是旧形状的输入原样透传 —— 所以发旧形状是两种版本下都安全的选择。
 */

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

// ── DSH 侧的结构类型（只声明本模块实际用到的字段，避免绑死插件包的具体版本） ──

export interface DshTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export type DshContentBlockType = "text" | "reasoning" | "tool-call" | string;

export type DshStreamChunk =
  | { type: "block-start"; index: number; blockType: DshContentBlockType }
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: "block-end"; index: number; block: { type: string; text?: string; id?: string; name?: string; arguments?: string } }
  | { type: "usage"; usage: DshTokenUsage }
  | { type: "finish"; reason: { kind: string; failure?: unknown } };

export interface DshGenerateOptions {
  provider: string;
  model: string;
  messages: unknown[];
  system?: string;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  signal?: AbortSignal;
}

export interface DshPreparedCall {
  /**
   * 已解析的配置。**派发时必须把它原样传回 `stream()`** ——
   * dsh-llm 有 `callConfigEquals(options, resolvedConfig)` 守卫，配置不等会抛
   * `INVALID_PREPARED_CALL`（"prepared LLM call config changed before adapter dispatch"）。
   */
  config: DshGenerateOptions;
  stream: (options: DshGenerateOptions) => AsyncIterable<DshStreamChunk>;
}

/**
 * 插件模型调用面。抽成接口是为了可测：单测用假实现喂确定的 chunk 序列，
 * 从而把「翻译是否正确」与「插件是否联网可用」彻底解耦。
 */
export interface PluginCallSource {
  /** 该路由下的模型清单。 */
  listModels(provider: string): Promise<Array<{ id: string; name?: string }>>;
  /** 单模型的上下文/输出上限（取不到时返回空对象）。 */
  resolveModelInfo(provider: string, model: string): Promise<{ contextWindow?: number; maxTokens?: number; reasoning?: boolean }>;
  /**
   * 准备一次调用。
   *
   * ⚠️ 入参是**整份配置对象**而不是 `(provider, model, signal)` 三个位置参数 ——
   * 真机踩过：dsh-llm 的 `LlmRuntime.prepareCall(config, signal)` 读的是 `config.provider`，
   * 传字符串进去会让它拿到 `provider === undefined`，报
   * `no adapter registered for provider "undefined"`（NO_ADAPTER），
   * 而**模型清单、模型解析全都是好的**，只有真正发请求时才炸。
   */
  prepareCall(config: DshGenerateOptions, signal?: AbortSignal): Promise<DshPreparedCall>;
}

// ── pi 侧的结构类型 ──

interface PiToolSchema {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface PiMessageLike {
  role: string;
  content?: unknown;
  toolsAdded?: PiToolSchema[];
  toolCallId?: string;
  isError?: boolean;
  timestamp?: number;
}

interface PiTextContent { type: "text"; text: string }
interface PiThinkingContent { type: "thinking"; thinking: string; redacted?: boolean }
interface PiImageContent { type: string; data?: string; mimeType?: string }
interface PiToolCallContent { type: "toolCall"; id: string; name: string; arguments?: unknown }

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function piUsageFromDsh(usage: DshTokenUsage) {
  const input = Math.max(0, Number(usage.inputTokens) || 0);
  const output = Math.max(0, Number(usage.outputTokens) || 0);
  const cacheRead = Math.max(0, Number(usage.cacheReadTokens) || 0);
  const cacheWrite = Math.max(0, Number(usage.cacheWriteTokens) || 0);
  const reasoning = usage.reasoningTokens === undefined ? undefined : Math.max(0, Number(usage.reasoningTokens) || 0);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(reasoning === undefined ? {} : { reasoning }),
    totalTokens: Math.max(0, Number(usage.totalTokens) || input + output + cacheRead + cacheWrite),
    cost: { ...ZERO_COST, total: 0 },
  };
}

/** pi 的 StopReason 只接受这几个终态；DSH 的 finish.kind 映射到它们。 */
function stopReasonFromFinish(kind: string): "stop" | "length" | "toolUse" | "aborted" | "error" {
  switch (kind) {
    case "tool-calls":
      return "toolUse";
    case "max-tokens":
      return "length";
    case "aborted":
      return "aborted";
    case "error":
      return "error";
    default:
      return "stop";
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") return b.text;
        if (b.type === "thinking" && typeof b.thinking === "string") return b.thinking;
        if (b.type === "tool-result" || b.type === "toolResult") {
          const inner = b.content;
          if (typeof inner === "string") return inner;
          if (Array.isArray(inner)) {
            return inner.map((x) => (x && typeof x === "object" && typeof (x as PiTextContent).text === "string" ? (x as PiTextContent).text : "")).join("");
          }
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * pi 的 transcript → DSH 的 `GenerateOptions.messages`。
 *
 * 工具结果刻意发**旧形状**（见模块头的铁律 2）。
 */
export function piMessagesToDshMessages(messages: readonly PiMessageLike[]): unknown[] {
  const out: unknown[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = message.role;

    if (role === "system") {
      const text = textOf(message.content);
      if (text) out.push({ role: "system", content: [{ type: "text", text }] });
      continue;
    }

    if (role === "user") {
      const content = Array.isArray(message.content)
        ? (message.content as PiImageContent[])
            .map((block) => {
              if (block?.type === "text") return { type: "text", text: (block as PiTextContent).text };
              if (block?.type === "image" && typeof block.data === "string") {
                return { type: "image", data: block.data, mimeType: block.mimeType ?? "image/png" };
              }
              return null;
            })
            .filter(Boolean)
        : [{ type: "text", text: textOf(message.content) }];
      out.push({ role: "user", content });
      continue;
    }

    if (role === "assistant") {
      const content: unknown[] = [];
      const blocks = Array.isArray(message.content) ? (message.content as Array<PiTextContent | PiThinkingContent | PiToolCallContent>) : [];
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "thinking" && !block.redacted) content.push({ type: "reasoning", text: block.thinking });
        else if (block.type === "toolCall") {
          content.push({
            type: "tool-call",
            id: block.id,
            name: block.name,
            arguments: typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? {}),
          });
        }
      }
      out.push({ role: "assistant", content });
      continue;
    }

    // 工具结果：发旧形状的内嵌 tool-result（两种 DSH 版本下都安全）。
    const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    if (toolCallId || role === "tool" || role === "toolResult" || role === "tool-result") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool-result",
            ...(toolCallId ? { toolCallId } : {}),
            content: textOf(message.content),
            isError: message.isError === true,
          },
        ],
      });
    }
  }
  return out;
}

/** pi 把工具定义挂在 system 消息的 `toolsAdded` 上（见 kernel/opencode-zen.ts 的实测）。 */
export function piToolsFromMessages(messages: readonly PiMessageLike[]) {
  const tools = new Map<string, { name: string; description: string; parameters: Record<string, unknown> }>();
  for (const message of messages) {
    if (!message || message.role !== "system" || !Array.isArray(message.toolsAdded)) continue;
    for (const tool of message.toolsAdded) {
      if (!tool || typeof tool.name !== "string") continue;
      tools.set(tool.name, {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
      });
    }
  }
  return [...tools.values()];
}

/**
 * 造一个 pi 的 `streamSimple`：把 pi 的一次调用翻成插件的一次流式调用，再翻回来。
 *
 * `partial` 是 pi 约定的**共享活对象**（不是事件时快照）：文本/思考块在 `*_start`
 * 时为空，靠 `*_delta` 增长，最后由 `*_end` 定稿。
 */
export function createPluginStreamSimple(source: PluginCallSource, provider: string) {
  return function pluginStreamSimple(model: { id: string; name?: string }, context: { messages: readonly PiMessageLike[] }, options?: Record<string, unknown>) {
    const output = createAssistantMessageEventStream();
    void pump(output, source, provider, model, context, options);
    return output;
  };
}

async function pump(
  output: ReturnType<typeof createAssistantMessageEventStream>,
  source: PluginCallSource,
  provider: string,
  model: { id: string; name?: string },
  context: { messages: readonly PiMessageLike[] },
  options?: Record<string, unknown>,
): Promise<void> {
  const signal = options?.signal as AbortSignal | undefined;
  const partial: Record<string, unknown> = {
    role: "assistant",
    content: [] as unknown[],
    api: "openai-completions",
    provider,
    model: model.id,
    usage: piUsageFromDsh({}),
    stopReason: "pending",
    timestamp: Date.now(),
  };

  /** DSH 的块下标 → pi 的 contentIndex（两者不一定同号，故显式映射）。 */
  const contentIndexByBlock = new Map<number, number>();
  const openToolCalls = new Map<number, { id: string; name: string; args: string }>();

  function ensureBlock(blockIndex: number, blockType: DshContentBlockType): number {
    const existing = contentIndexByBlock.get(blockIndex);
    if (existing !== undefined) return existing;
    const content = partial.content as unknown[];
    const contentIndex = content.length;
    if (blockType === "reasoning") content.push({ type: "thinking", thinking: "" });
    else if (blockType === "tool-call") {
      const call = { type: "toolCall", id: "", name: "", arguments: {} };
      openToolCalls.set(blockIndex, { id: "", name: "", args: "" });
      content.push(call);
    } else content.push({ type: "text", text: "" });
    contentIndexByBlock.set(blockIndex, contentIndex);
    return contentIndex;
  }

  let finished = false;
  try {
    const messages = context?.messages ?? [];
    const tools = piToolsFromMessages(messages);
    const dshConfig: DshGenerateOptions = {
      provider,
      model: model.id,
      messages: piMessagesToDshMessages(messages),
      ...(tools.length > 0 ? { tools } : {}),
      ...(typeof options?.maxTokens === "number" ? { maxTokens: options.maxTokens } : {}),
      ...(typeof options?.temperature === "number" ? { temperature: options.temperature } : {}),
      ...(typeof options?.reasoning === "string" ? { reasoningEffort: options.reasoning as string } : {}),
      // ⚠️ **不要把 signal 放进 config**：dsh-llm 会对 config 做 `structuredClone`，
      // 而 AbortSignal 不可结构化克隆 —— 真机报「The object can not be cloned.」。
      // signal 是 `prepareCall(config, signal)` 的**第二个位置参数**，
      // 派发时再放进 stream 的 options（那条路径不克隆）。
    };

    // ⚠️ 整份配置对象进 prepareCall（不是位置参数），见 PluginCallSource 的说明。
    const prepared = await source.prepareCall(dshConfig, signal);

    output.push({ type: "start", partial } as never);

    // ⚠️ 派发必须基于 prepared.config（已解析的配置）：dsh-llm 的
    // `callConfigEquals` 会比对 provider/model/reasoningEffort/temperature/maxTokens/stop，
    // 不等就抛 INVALID_PREPARED_CALL。signal 不在比对字段里，可以安全附加。
    const dispatchOptions: DshGenerateOptions = { ...prepared.config, ...(signal ? { signal } : {}) };

    for await (const chunk of prepared.stream(dispatchOptions)) {
      if (!chunk || typeof chunk !== "object") continue;
      switch (chunk.type) {
        case "block-start": {
          const contentIndex = ensureBlock(chunk.index, chunk.blockType);
          if (chunk.blockType === "reasoning") output.push({ type: "thinking_start", contentIndex, partial } as never);
          else if (chunk.blockType === "tool-call") output.push({ type: "toolcall_start", contentIndex, partial } as never);
          else output.push({ type: "text_start", contentIndex, partial } as never);
          break;
        }
        case "text-delta": {
          const contentIndex = ensureBlock(chunk.index, "text");
          const block = (partial.content as PiTextContent[])[contentIndex];
          if (block && block.type === "text") block.text += chunk.text;
          output.push({ type: "text_delta", contentIndex, delta: chunk.text, partial } as never);
          break;
        }
        case "reasoning-delta": {
          const contentIndex = ensureBlock(chunk.index, "reasoning");
          const block = (partial.content as PiThinkingContent[])[contentIndex];
          if (block && block.type === "thinking") block.thinking += chunk.text;
          output.push({ type: "thinking_delta", contentIndex, delta: chunk.text, partial } as never);
          break;
        }
        case "tool-call-delta": {
          const contentIndex = ensureBlock(chunk.index, "tool-call");
          const state = openToolCalls.get(chunk.index) ?? { id: "", name: "", args: "" };
          if (chunk.id) state.id = String(chunk.id);
          if (chunk.name) state.name = chunk.name;
          state.args += chunk.argumentsDelta ?? "";
          openToolCalls.set(chunk.index, state);
          // partial 是活对象：id/name 到齐后立刻回填，pi 的 UI 才能显示工具名。
          const call = (partial.content as PiToolCallContent[])[contentIndex];
          if (call && call.type === "toolCall") {
            call.id = state.id;
            call.name = state.name;
          }
          output.push({ type: "toolcall_delta", contentIndex, delta: chunk.argumentsDelta ?? "", partial } as never);
          break;
        }
        case "block-end": {
          const blockType = chunk.block?.type ?? "text";
          const contentIndex = ensureBlock(chunk.index, blockType);
          if (blockType === "reasoning") {
            const text = chunk.block?.text ?? "";
            const block = (partial.content as PiThinkingContent[])[contentIndex];
            if (block && block.type === "thinking") block.thinking = text || block.thinking;
            output.push({ type: "thinking_end", contentIndex, content: block?.thinking ?? text, partial } as never);
          } else if (blockType === "tool-call") {
            const state = openToolCalls.get(chunk.index) ?? { id: "", name: "", args: "" };
            const id = chunk.block?.id ?? state.id;
            const name = chunk.block?.name ?? state.name;
            const rawArgs = chunk.block?.arguments ?? state.args;
            let parsed: unknown = {};
            try {
              parsed = rawArgs ? JSON.parse(rawArgs) : {};
            } catch {
              parsed = {};
            }
            const toolCall = { type: "toolCall" as const, id, name, arguments: parsed as Record<string, unknown> };
            (partial.content as unknown[])[contentIndex] = toolCall;
            partial.stopReason = "toolUse";
            output.push({ type: "toolcall_end", contentIndex, toolCall, partial } as never);
          } else {
            const text = chunk.block?.text ?? "";
            const block = (partial.content as PiTextContent[])[contentIndex];
            if (block && block.type === "text" && text) block.text = text;
            output.push({ type: "text_end", contentIndex, content: block?.text ?? text, partial } as never);
          }
          break;
        }
        case "usage": {
          partial.usage = piUsageFromDsh(chunk.usage ?? {});
          break;
        }
        case "finish": {
          const reason = stopReasonFromFinish(chunk.reason?.kind ?? "stop");
          finished = true;
          if (reason === "aborted" || reason === "error") {
            partial.stopReason = reason;
            output.push({ type: "error", reason, error: partial } as never);
          } else {
            partial.stopReason = reason;
            output.push({ type: "done", reason, message: partial } as never);
          }
          break;
        }
        default:
          break;
      }
    }

    if (!finished) {
      // 流没给终态就断了：按 pi 约定必须补一个终止事件，否则上层永远等下去。
      const stopReason = partial.stopReason === "toolUse" ? "toolUse" : "stop";
      partial.stopReason = stopReason;
      output.push({ type: "done", reason: stopReason, message: partial } as never);
    }
    output.end();
  } catch (err) {
    partial.stopReason = signal?.aborted ? "aborted" : "error";
    partial.errorMessage = err instanceof Error ? err.message : String(err);
    try {
      output.push({ type: "start", partial } as never);
    } catch {
      // 已经 start 过就不再补
    }
    output.push({ type: "error", reason: signal?.aborted ? "aborted" : "error", error: partial } as never);
    output.end();
  }
}

// ── 真实调用面：把宿主的 DSH `llm` 服务适配成 `PluginCallSource` ──

interface LlmRuntimeLike {
  listProviders?: () => Array<{ id: string; name?: string }>;
  listModels?: (provider: string) => Promise<Array<{ id: string; name?: string }>>;
  resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  prepareCall?: (config: DshGenerateOptions, signal?: AbortSignal) => Promise<DshPreparedCall>;
}

/** 宿主 `ctx.llm` 的模型路由 id 清单（插件注册进来的那 15 条）。 */
export function pluginProviderIds(llm: unknown): string[] {
  const runtime = llm as LlmRuntimeLike | undefined;
  try {
    const list = runtime?.listProviders?.();
    if (Array.isArray(list)) return list.filter((item) => item && typeof item.id === "string").map((item) => item.id);
  } catch {
    // 取不到就当作没有插件路由
  }
  return [];
}

/** 用宿主的 DSH `llm` 服务构造真实调用面。 */
export function createLlmRuntimeCallSource(llm: unknown): PluginCallSource {
  const runtime = llm as LlmRuntimeLike;
  return {
    async listModels(provider) {
      const list = await runtime.listModels?.(provider);
      return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string") : [];
    },
    async resolveModelInfo(provider, model) {
      try {
        const info = await runtime.resolveModelInfo?.(provider, model);
        const context = (info?.context ?? undefined) as { contextWindow?: number } | undefined;
        const reasoning = info?.reasoning as { efforts?: unknown[] } | undefined;
        return {
          contextWindow: typeof context?.contextWindow === "number" ? context.contextWindow : undefined,
          maxTokens: typeof info?.defaultMaxTokens === "number" ? info.defaultMaxTokens : undefined,
          reasoning: Array.isArray(reasoning?.efforts) && reasoning.efforts.length > 0,
        };
      } catch {
        return {};
      }
    },
    async prepareCall(config, signal) {
      if (typeof runtime.prepareCall !== "function") {
        throw new Error(`plugin llm runtime cannot prepareCall(${config.provider}/${config.model})`);
      }
      // ⚠️ 传整份 config：dsh-llm 读 `config.provider` / `config.model`，
      // 位置参数会被它当成一个字符串，导致 provider=undefined → NO_ADAPTER。
      return await runtime.prepareCall(config, signal);
    },
  };
}
