/**
 * tests/plugins/pi-bridge.test.ts — pi ⇄ 插件 的双向翻译（PLUGIN-001 / P1）。
 *
 * 这一层的正确性只能靠「喂确定的 chunk 序列、断言 pi 事件序列」来锁：
 * 插件真实渠道要登录+联网，不适合做单测。故所有用例都用假的 `PluginCallSource`，
 * 把「翻译是否正确」与「插件是否可用」彻底解耦。
 *
 * 重点断言的是两类**会静默出错**的东西：
 *   - 事件序列：pi 要求 `start` 在最前、`done`/`error` 收尾；缺终止事件会让上层永远等；
 *   - 报文形状：工具结果必须发旧形状（`role:'user'` 内嵌 `tool-result`），
 *     工具调用参数必须是 JSON 字符串 —— 形状错了插件不会报错，只会「模型变傻」。
 */

import { describe, expect, test } from "bun:test";

import {
  createLlmRuntimeCallSource,
  createPluginStreamSimple,
  piMessagesToDshMessages,
  piToolsFromMessages,
  pluginProviderIds,
  type DshStreamChunk,
  type PluginCallSource,
} from "../../src/plugins/dsh/pi-bridge";
import { createPluginProviderRegistrar } from "../../src/plugins/dsh/pi-providers";

function sourceYielding(chunks: DshStreamChunk[], captured?: { options?: Record<string, unknown> }): PluginCallSource {
  return {
    async listModels() {
      return [{ id: "m1", name: "Model One" }];
    },
    async resolveModelInfo() {
      return { contextWindow: 200_000, maxTokens: 16_384, reasoning: true };
    },
    async prepareCall(config) {
      // 契约：入参是整份 config，派发时必须把它原样传回 stream（dsh-llm 会比对）
      if (captured) captured.options = config as unknown as Record<string, unknown>;
      return {
        config,
        stream(options) {
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        },
      };
    },
  };
}

async function collect(stream: AsyncIterable<unknown>) {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of stream) events.push(event as Record<string, unknown>);
  return events;
}

const model = { id: "m1", name: "Model One" };
const context = { messages: [{ role: "user", content: "你好", timestamp: 1 }] };

describe("pi → DSH 报文翻译", () => {
  test("tool results are sent in the legacy embedded shape", () => {
    const out = piMessagesToDshMessages([
      { role: "system", content: "你是 Maxma" },
      { role: "user", content: "读文件" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "好的" },
          { type: "thinking", thinking: "先看目录" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.txt" } },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", content: "文件内容", isError: false },
    ]) as Array<Record<string, unknown>>;

    expect(out[0]).toEqual({ role: "system", content: [{ type: "text", text: "你是 Maxma" }] });
    expect(out[1]).toEqual({ role: "user", content: [{ type: "text", text: "读文件" }] });

    // assistant：thinking → reasoning 块；toolCall → tool-call 且 arguments 是 JSON 字符串
    const assistant = out[2] as { role: string; content: Array<Record<string, unknown>> };
    expect(assistant.role).toBe("assistant");
    expect(assistant.content[0]).toEqual({ type: "text", text: "好的" });
    expect(assistant.content[1]).toEqual({ type: "reasoning", text: "先看目录" });
    expect(assistant.content[2]).toEqual({ type: "tool-call", id: "call_1", name: "read", arguments: '{"path":"a.txt"}' });

    // 工具结果：旧形状（0.1.7 的一等 role:'tool' 会被插件自己降级成这个形状）
    const toolResult = out[3] as { role: string; content: Array<Record<string, unknown>> };
    expect(toolResult.role).toBe("user");
    expect(toolResult.content[0]).toMatchObject({ type: "tool-result", toolCallId: "call_1", content: "文件内容", isError: false });
  });

  test("redacted thinking is dropped, and tools come off the system message", () => {
    const messages = [
      {
        role: "system",
        content: "",
        toolsAdded: [{ name: "bash", description: "run", parameters: { type: "object", properties: {} } }],
      },
      { role: "assistant", content: [{ type: "thinking", thinking: "secret", redacted: true }, { type: "text", text: "ok" }] },
    ];
    const out = piMessagesToDshMessages(messages) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    // 空 system 消息不产出（否则会给模型发一条空指令）
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toEqual([{ type: "text", text: "ok" }]);

    const tools = piToolsFromMessages(messages);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("bash");
  });
});

describe("DSH chunk → pi 事件翻译", () => {
  test("text / reasoning / tool-call / usage / finish 全链路", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const source = sourceYielding(
      [
        { type: "block-start", index: 0, blockType: "text" },
        { type: "text-delta", index: 0, text: "你" },
        { type: "text-delta", index: 0, text: "好" },
        { type: "block-end", index: 0, block: { type: "text", text: "你好" } },
        { type: "block-start", index: 1, blockType: "reasoning" },
        { type: "reasoning-delta", index: 1, text: "想一下" },
        { type: "block-end", index: 1, block: { type: "reasoning", text: "想一下" } },
        { type: "tool-call-delta", index: 2, id: "call_9", name: "read", argumentsDelta: '{"pa' },
        { type: "tool-call-delta", index: 2, id: "call_9", argumentsDelta: 'th":"x"}' },
        { type: "block-end", index: 2, block: { type: "tool-call", id: "call_9", name: "read", arguments: '{"path":"x"}' } },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 } },
        { type: "finish", reason: { kind: "tool-calls" } },
      ],
      captured,
    );

    const events = await collect(createPluginStreamSimple(source, "codearts")(model, context, { maxTokens: 512, temperature: 0.3 }) as never);
    const types = events.map((e) => e.type);

    expect(types[0]).toBe("start");
    expect(types).toContain("text_start");
    expect(types.filter((t) => t === "text_delta")).toHaveLength(2);
    expect(types).toContain("text_end");
    expect(types).toContain("thinking_start");
    expect(types).toContain("thinking_delta");
    expect(types).toContain("thinking_end");
    expect(types).toContain("toolcall_delta");
    expect(types).toContain("toolcall_end");

    const done = events.at(-1) as { type: string; reason: string; message: Record<string, unknown> };
    expect(done.type).toBe("done");
    expect(done.reason).toBe("toolUse"); // tool-calls → toolUse

    const content = done.message.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({ type: "text", text: "你好" });
    expect(content[1]).toMatchObject({ type: "thinking", thinking: "想一下" });
    expect(content[2]).toMatchObject({ type: "toolCall", id: "call_9", name: "read", arguments: { path: "x" } });

    // usage 落到 message 上（pi 没有独立的 usage 事件）
    expect(done.message.usage).toMatchObject({ input: 10, output: 4, cacheRead: 2, totalTokens: 16 });

    // 传给插件的请求参数如实透传，且工具结果/消息按 DSH 形状发出
    expect(captured.options).toMatchObject({ provider: "codearts", model: "m1", maxTokens: 512, temperature: 0.3 });
    expect(Array.isArray(captured.options?.messages)).toBe(true);
  });

  test("段序号错位时靠映射表对齐，不吃掉内容", async () => {
    // DSH 的块下标不从 0 开始（真实适配器会这样），pi 的 contentIndex 必须连续
    const source = sourceYielding([
      { type: "block-start", index: 7, blockType: "text" },
      { type: "text-delta", index: 7, text: "A" },
      { type: "block-end", index: 7, block: { type: "text", text: "A" } },
      { type: "finish", reason: { kind: "stop" } },
    ]);
    const events = await collect(createPluginStreamSimple(source, "trae")(model, context) as never);
    const delta = events.find((e) => e.type === "text_delta") as { contentIndex: number };
    expect(delta.contentIndex).toBe(0);
    const done = events.at(-1) as { message: { content: Array<{ text: string }> } };
    expect(done.message.content[0]?.text).toBe("A");
  });

  test("异常终止映射成 error 事件（stop kind=error）", async () => {
    const source = sourceYielding([{ type: "finish", reason: { kind: "error" } }]);
    const events = await collect(createPluginStreamSimple(source, "qoder")(model, context) as never);
    const last = events.at(-1) as { type: string; reason: string };
    expect(last.type).toBe("error");
    expect(last.reason).toBe("error");
    // 没有任何 failure 明细时也要有一句可读文案（不能是空串——空串会让 sidecar
    // 只剩「Unknown agent error」这种零诊断价值的兜底）
    const errMessage = (last as unknown as { error: { errorMessage?: string } }).error.errorMessage;
    expect(typeof errMessage).toBe("string");
    expect(errMessage!.length).toBeGreaterThan(0);
  });

  test("finish kind=error 的 failure 明细必须落到 errorMessage（真机踩过整条被丢）", async () => {
    // 用户报障：模型选择器发展示名 → 插件按 id 找不到模型 → finish kind=error，
    // failure 里的「模型不存在」没进 errorMessage，界面只剩 Unknown agent error。
    // 字符串形状
    const str = sourceYielding([
      { type: "finish", reason: { kind: "error", failure: "unknown model: Hy4 preview" } },
    ]);
    const ev1 = await collect(createPluginStreamSimple(str, "buddy")(model, context) as never);
    expect((ev1.at(-1) as { error: { errorMessage?: string } }).error.errorMessage).toContain("unknown model: Hy4 preview");
    // Error 实例形状
    const err = sourceYielding([
      { type: "finish", reason: { kind: "error", failure: new Error("模型不存在") } },
    ]);
    const ev2 = await collect(createPluginStreamSimple(err, "buddy")(model, context) as never);
    expect((ev2.at(-1) as { error: { errorMessage?: string } }).error.errorMessage).toContain("模型不存在");
    // 对象形状（取 message 键）
    const obj = sourceYielding([
      { type: "finish", reason: { kind: "error", failure: { code: "MODEL_NOT_FOUND", message: "未知模型" } } },
    ]);
    const ev3 = await collect(createPluginStreamSimple(obj, "buddy")(model, context) as never);
    expect((ev3.at(-1) as { error: { errorMessage?: string } }).error.errorMessage).toContain("未知模型");
  });

  test("流没给终态时补一个 done，避免上层永远等待", async () => {
    const source = sourceYielding([{ type: "text-delta", index: 0, text: "半句" }]);
    const events = await collect(createPluginStreamSimple(source, "cline")(model, context) as never);
    const last = events.at(-1) as { type: string };
    expect(last.type).toBe("done");
  });

  test("prepareCall 抛错 → error 事件而不是未捕获异常", async () => {
    const source: PluginCallSource = {
      async listModels() {
        return [];
      },
      async resolveModelInfo() {
        return {};
      },
      async prepareCall() {
        throw new Error("未登录");
      },
    };
    const events = await collect(createPluginStreamSimple(source, "buddy")(model, context) as never);
    const last = events.at(-1) as { type: string; error: { errorMessage?: string } };
    expect(last.type).toBe("error");
    expect(last.error.errorMessage).toContain("未登录");
  });

  test("prepareCall 收到整份 config，且 config 里不带 signal（dsh-llm 会 structuredClone）", async () => {
    // 两个真机踩过的契约细节，一起锁：
    //   1. dsh-llm 的 `LlmRuntime.prepareCall(config, signal)` 读 `config.provider`／
    //      `config.model`；传位置参数会让它拿到 provider=undefined → NO_ADAPTER。
    //   2. 它对 config 做 `structuredClone`，而 AbortSignal **不可克隆** →
    //      「The object can not be cloned.」。signal 是第二个位置参数。
    let seenConfig: Record<string, unknown> | undefined;
    let seenSignal: unknown;
    let dispatchOptions: Record<string, unknown> | undefined;
    const source: PluginCallSource = {
      async listModels() {
        return [];
      },
      async resolveModelInfo() {
        return {};
      },
      async prepareCall(config, signal) {
        seenConfig = config as unknown as Record<string, unknown>;
        seenSignal = signal;
        // 模拟 dsh-llm 的克隆：这里抛错就说明 config 里混进了不可克隆的东西
        const cloned = structuredClone(config) as unknown as never;
        return {
          config: cloned,
          stream(options) {
            dispatchOptions = options as unknown as Record<string, unknown>;
            return (async function* () {
              yield { type: "finish", reason: { kind: "stop" } } as const;
            })();
          },
        };
      },
    };

    const controller = new AbortController();
    await collect(createPluginStreamSimple(source, "trae")(model, context, { signal: controller.signal }) as never);

    expect(seenConfig).toBeDefined();
    expect(seenConfig?.provider).toBe("trae");
    expect(seenConfig?.model).toBe("m1");
    expect(Array.isArray(seenConfig?.messages)).toBe(true);
    // config 里不能有 signal（有的话 structuredClone 会抛）
    expect("signal" in (seenConfig ?? {})).toBe(false);
    // signal 走第二个位置参数，并在派发时附到 stream 的 options 上
    expect(seenSignal).toBe(controller.signal);
    expect(dispatchOptions?.signal).toBe(controller.signal);
  });
});

describe("插件路由注册器", () => {
  test("只接管插件路由，并带上 streamSimple 与模型清单", async () => {
    const calls: Array<{ id: string; config: Record<string, unknown> }> = [];
    const runtime = {
      registerProvider(id: string, config: Record<string, unknown>) {
        calls.push({ id, config });
      },
    };
    const host = {
      getService(name: string) {
        if (name !== "llm") return undefined;
        return {
          listProviders: () => [{ id: "codearts", name: "CodeArts" }, { id: "trae", name: "TRAE" }],
          listModels: async (provider: string) => [{ id: `${provider}-m1`, name: "M1" }],
          resolveModelInfo: async () => ({ context: { contextWindow: 200_000 }, defaultMaxTokens: 32_768, reasoning: { efforts: [{ id: "low" }] } }),
          prepareCall: async (config: never) => ({ config, stream: () => (async function* () {})() }),
        };
      },
    };

    const registrar = createPluginProviderRegistrar(host as never);
    expect(await registrar(runtime as never, "deepseek", "deepseek-chat")).toBe(false);
    expect(calls).toHaveLength(0);

    expect(await registrar(runtime as never, "codearts", "codearts-m1")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.id).toBe("codearts");
    const config = calls[0]!.config;
    expect(typeof config.streamSimple).toBe("function");
    const models = config.models as Array<Record<string, unknown>>;
    expect(models[0]).toMatchObject({ id: "codearts-m1", contextWindow: 200_000, maxTokens: 32_768, reasoning: true });
  });

  test("模型清单取不到时也注册（未登录不等于模型不存在）", async () => {
    const calls: Array<{ id: string }> = [];
    const runtime = { registerProvider: (id: string) => calls.push({ id }) };
    const host = {
      getService: () => ({
        listProviders: () => [{ id: "zcode" }],
        listModels: async () => [],
        resolveModelInfo: async () => ({}),
        prepareCall: async (config: never) => ({ config, stream: () => (async function* () {})() }),
      }),
    };
    const registrar = createPluginProviderRegistrar(host as never);
    expect(await registrar(runtime as never, "zcode", "zcode-x")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("注册必须带 baseUrl —— 否则 pi 会拒绝自定义模型（真机踩过）", async () => {
    // 真机现象：注册被 pi 拒（`Provider X: "baseUrl" is required when defining custom
    // models.`），而错误被 registerPluginProviderOn 的 try/catch 吞成一条 warn，
    // 表现为「模型 not found in pi registry」，很难联想到是缺 baseUrl。
    // 这里用一个**模拟 pi 那条规则**的 runtime 把它锁死。
    const seen: Array<Record<string, unknown>> = [];
    const runtime = {
      registerProvider(_id: string, config: Record<string, unknown>) {
        if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
          throw new Error(`Provider ${_id}: "baseUrl" is required when defining custom models.`);
        }
        seen.push(config);
      },
    };
    const host = {
      getService: () => ({
        listProviders: () => [{ id: "trae" }],
        listModels: async () => [{ id: "m1", name: "M1" }],
        resolveModelInfo: async () => ({}),
        prepareCall: async (config: never) => ({ config, stream: () => (async function* () {})() }),
      }),
    };

    const registrar = createPluginProviderRegistrar(host as never);
    await expect(registrar(runtime as never, "trae", "m1")).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    // 占位域必须是保留域：万一真被当 URL 用，要立刻响亮失败而不是打到别人的服务器
    expect(String(seen[0]?.baseUrl)).toContain("plugin.invalid");
    // 传输仍由 streamSimple 接管
    expect(typeof seen[0]?.streamSimple).toBe("function");
  });

  test("pluginProviderIds / createLlmRuntimeCallSource 读得动宿主 llm 服务", async () => {
    const llm = {
      listProviders: () => [{ id: "codearts" }, { id: "trae" }, { bad: true }],
      listModels: async () => [{ id: "m" }],
      resolveModelInfo: async () => ({ context: { contextWindow: 1000 }, defaultMaxTokens: 100, reasoning: { efforts: [{}] } }),
      prepareCall: async (config: never) => ({ config, stream: () => (async function* () {})() }),
    };
    expect(pluginProviderIds(llm)).toEqual(["codearts", "trae"]);

    const source = createLlmRuntimeCallSource(llm);
    expect(await source.listModels("codearts")).toEqual([{ id: "m" }]);
    expect(await source.resolveModelInfo("codearts", "m")).toMatchObject({ contextWindow: 1000, maxTokens: 100, reasoning: true });

    // 没有 llm 服务时不是崩，而是「没有插件路由」
    expect(pluginProviderIds(undefined)).toEqual([]);
  });
});
