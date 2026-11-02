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
        baseUrl: "https://opencode.ai/inference/v1",
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

    // ── V2 指纹头集（依据上游 src/opencode.ts 的 opencodeHeaders + 逐变量实测矩阵）──
    // session 外形：ses_ + 12hex + 14base62
    expect(request?.headers.get("x-opencode-session")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(request?.headers.get("x-opencode-session-id")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    // 四个 affinity 头必须复用同一个 session
    expect(request?.headers.get("x-opencode-session-id")).toBe(request?.headers.get("x-opencode-session"));
    expect(request?.headers.get("x-session-affinity")).toBe(request?.headers.get("x-opencode-session"));
    expect(request?.headers.get("X-Session-Id")).toBe(request?.headers.get("x-opencode-session"));

    // ⚠️⚠️ 这条断言**曾经写反了**：旧版断言 `x-opencode-request` 必须存在
    //（并且匹配 msg_ 外形），而上游逐变量实测明确记着
    //「带上 `x-opencode-request`（即使三个 affinity 头都在）→ **403**（旧客户端标记即毒药）」。
    // 也就是说：旧断言把"必然 403 的形态"锁成了契约。现在反过来断言它**不得出现**。
    expect(
      request?.headers.get("x-opencode-request"),
      "x-opencode-request 是旧客户端标记，上游实测『在场即 403』，绝不能发送",
    ).toBeNull();

    // UA 必须是 V2 外形（上游实测它不参与门禁，但外形要对齐）
    expect(request?.headers.get("user-agent")).toMatch(/^opencode\/[A-Za-z0-9_-]+\/2\.\d+\.\d+\/cli$/);
    expect(request?.headers.get("x-opencode-client")).toBe("cli");

    // 门禁工具：只允许 `read`，且 schema 必须是完整形态（空 properties 会 403）
    const tools = (request?.body.tools ?? []) as Array<{ function?: { name?: string; parameters?: Record<string, unknown> } }>;
    const names = tools.map((t) => t.function?.name);
    expect(names, "门禁工具只允许 read（只带 read 必定放行，多带 bash/glob 等一律 403）").toEqual(["read"]);
    const params = tools[0]?.function?.parameters as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    expect(Object.keys(params?.properties ?? {}).length, "空 properties 会被形状门禁拒成 403").toBeGreaterThan(0);
    expect(params?.required).toEqual(["path"]);
  });

  test("主模型无输出时，按注入的兜底列表换名重发", async () => {
    let calls = 0;
    const stream = opencodeZenStreamSimple(
      {
        id: "mimo-v2.6-flash-free",
        name: "MiMo V2.6 Flash",
        provider: "opencode-zen",
        api: "openai-completions",
        baseUrl: "https://opencode.ai/inference/v1",
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
        baseUrl: "https://opencode.ai/inference/v1",
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
