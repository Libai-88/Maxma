import { describe, expect, test } from "bun:test";
import { opencodeZenGatewayId, opencodeZenStreamSimple } from "../src/kernel/opencode-zen";

describe("OpenCode Zen gateway identity", () => {
  test("uses the gateway session/request identifier shape", () => {
    expect(opencodeZenGatewayId("ses", "session-seed")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(opencodeZenGatewayId("msg", "request-seed")).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });
});

describe("OpenCode Zen request compatibility", () => {
  test("uses the gateway-compatible token field and SSE headers", async () => {
    let request: { headers: Headers; body: Record<string, unknown> } | undefined;
    const stream = opencodeZenStreamSimple(
      {
        id: "mimo-v2.6-flash-free",
        name: "MiMo V2.6 Flash",
        provider: "opencode-zen",
        api: "openai-completions",
        baseUrl: "https://opencode.ai/zen/v1",
        apiKey: "public",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 262144,
        maxTokens: 32768,
        compat: {
          maxTokensField: "max_tokens",
          supportsReasoningEffort: false,
          supportsStore: false,
          supportsDeveloperRole: false,
        },
      },
      { messages: [{ role: "user", content: [{ type: "text", text: "Reply exactly OK" }] }] },
      {
        sessionId: "request-compatibility-test",
        fetch: async (_input, init) => {
          request = {
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          };
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n' +
              "data: [DONE]\n\n",
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        },
      },
    );

    let answer = "";
    for await (const event of stream) {
      if (event.type === "text_delta") answer += event.delta;
    }

    expect(answer).toBe("OK");
    expect(request?.body.max_tokens).toBe(32768);
    expect(request?.body.max_completion_tokens).toBeUndefined();
    expect(request?.headers.get("accept")).toBe("text/event-stream");
    expect(request?.headers.get("x-opencode-session")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(request?.headers.get("x-opencode-request")).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  test("主模型无输出时，按注入的兜底列表换名重发", async () => {
    let calls = 0;
    const stream = opencodeZenStreamSimple(
      {
        id: "mimo-v2.6-flash-free",
        name: "MiMo V2.6 Flash",
        provider: "opencode-zen",
        api: "openai-completions",
        baseUrl: "https://opencode.ai/zen/v1",
        apiKey: "public",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 262144,
        maxTokens: 32768,
        compat: { maxTokensField: "max_tokens", supportsReasoningEffort: false },
      },
      { messages: [{ role: "user", content: [{ type: "text", text: "Reply exactly OK" }] }] },
      {
        sessionId: "fallback-test",
        fetch: async () => {
          calls += 1;
          if (calls === 1) return new Response(JSON.stringify({ error: { message: "temporary failure" } }), { status: 503 });
          return new Response(
            'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n' +
              "data: [DONE]\n\n",
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        },
      },
      // 兜底目标由测试注入：线上的 FREE_LANE_FALLBACK_MODEL_IDS 当前是空的
      //（上游已不提供 space-bunny-free，留着就是必然失败的请求）。
      // 参数化让"换名重发"这个机制本身仍可被验证。
      ["space-bunny-free"],
    );

    let answer = "";
    for await (const event of stream) {
      if (event.type === "text_delta") answer += event.delta;
      expect(event.type).not.toBe("error");
    }

    expect(answer).toBe("OK");
    expect(calls).toBe(2);
  });

  test("兜底列表为空时不再追加请求，错误如实透传（不静默换名）", async () => {
    let calls = 0;
    const stream = opencodeZenStreamSimple(
      {
        id: "mimo-v2.6-flash-free",
        name: "MiMo",
        provider: "opencode-zen",
        api: "openai-completions",
        baseUrl: "https://opencode.ai/zen/v1",
        apiKey: "public",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: true,
        contextWindow: 262144,
        maxTokens: 32768,
        compat: { maxTokensField: "max_tokens", supportsReasoningEffort: false },
      },
      { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
      {
        sessionId: "no-fallback-test",
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({ error: { message: "Model is unavailable" } }), { status: 400 });
        },
      },
      [], // 生产当前的取值
    );

    const types: string[] = [];
    for await (const event of stream) types.push(event.type as string);
    expect(calls).toBe(1);                       // 没有兜底目标就不该再发第二个请求
    expect(types).toContain("error");            // 错误如实上报，不藏
  });
});
