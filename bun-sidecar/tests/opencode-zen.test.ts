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
});
