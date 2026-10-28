import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_BASE_URL, opencodeZenStreamSimple, FREE_LANE_FALLBACK_MODEL_IDS, FREE_LANE_PRIMARY_MODEL_ID, FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS } from "../src/kernel/opencode-zen";

function model(id: string) {
  return {
    id,
    name: id,
    provider: "opencode-zen",
    api: "openai-completions" as const,
    baseUrl: "https://opencode.ai/inference/v1",
    apiKey: "public",
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: 262144,
    maxTokens: 32768,
    compat: { maxTokensField: "max_tokens", supportsReasoningEffort: false },
  };
}

const ctx = { messages: [{ role: "user", content: [{ type: "text", text: "Reply exactly OK" }] }] } as never;

/** 造一个 SSE 响应（含正文）。 */
function okResponse(text = "OK") {
  return new Response(
    `data: {"choices":[{"delta":{"content":${JSON.stringify(text)}},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
/** 造一个失败响应（非 2xx → 适配器会产出 error 事件）。 */
function failResponse(status = 429, type = "FreeUsageLimitError") {
  return new Response(JSON.stringify({ type: "error", error: { type, message: "rate limited" } }), { status });
}

describe("免费渠道端点：单一来源 + 禁止回退到已废弃路径", () => {
  const REPO = path.resolve(import.meta.dir, "../..");

  test("端点必须是上游 V2 的 /inference，不得是已废弃的 /zen", () => {
    // 上游 2026-10 把推理/目录端点迁到 /inference/v1；其 docs 的逐变量实测矩阵
    // 记着「端点 /zen/v1（旧）→ 403」。这条断言防止有人在别处"顺手"把地址改回去。
    expect(DEFAULT_BASE_URL).toContain("/inference");
    expect(DEFAULT_BASE_URL).not.toContain("/zen");
  });

  test("源码与脚本里不得再出现旧的 /zen 端点字面量（端点只允许一个来源）", () => {
    // 端点此前散在两处（内核 + services），改一处另一处静默失效 ——
    // 症状是"聊天能用、但模型同步看起来正常却拿不到新模型"。
    const files = [
      "bun-sidecar/src/kernel/opencode-zen.ts",
      "bun-backend/src/services/opencode-zen.ts",
      "scripts/verify-free-models.mjs",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const abs = path.join(REPO, rel);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, "utf8");
      // 允许注释里提到旧端点（那是事故记录），但不得出现在**字符串字面量**里
      for (const line of text.split("\n")) {
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        if (/["'`]https:\/\/opencode\.ai\/zen/.test(code)) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      `这些地方把已废弃的 /zen 端点写成了字符串（应改为引用 DEFAULT_BASE_URL）：\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("免费渠道兜底链", () => {
  test("兜底清单非空，且不含实测不可用的模型", () => {
    expect(FREE_LANE_FALLBACK_MODEL_IDS.length, "兜底清单为空 ⇒ 兜底机制等于没有").toBeGreaterThan(0);
    for (const bad of FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS) {
      expect(FREE_LANE_FALLBACK_MODEL_IDS, `兜底清单不得含实测不可用模型 ${bad}`).not.toContain(bad);
    }
    expect(FREE_LANE_FALLBACK_MODEL_IDS).not.toContain(FREE_LANE_PRIMARY_MODEL_ID);
    // 不应有重复项
    expect(new Set(FREE_LANE_FALLBACK_MODEL_IDS).size).toBe(FREE_LANE_FALLBACK_MODEL_IDS.length);
  });

  test("第一个兜底候选也失败时，必须继续尝试下一个（旧实现只试第一个就放弃）", async () => {
    const seen: string[] = [];
    const stream = opencodeZenStreamSimple(
      model(FREE_LANE_PRIMARY_MODEL_ID),
      ctx,
      {
        sessionId: "chain-test",
        // ⚠️ 请求经 OpenAI SDK 发出 ⇒ 调用形态是 `fetch(url, init)`，
        // body 在**第二个参数**里（不是 `input` 上的 `.body`；第一版探针写成
        // `(input as Request).body` 拿到的是 undefined，模型名全记成 "?"）。
        fetch: async (_url, init) => {
          const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as { model?: string };
          seen.push(body.model ?? "?");
          // 主模型失败、候选1 失败、候选2 成功
          if (seen.length <= 2) return failResponse();
          return okResponse("OK");
        },
      },
      ["candidate-one", "candidate-two", "candidate-three"],
    );

    let answer = "";
    for await (const event of stream) {
      if (event.type === "text_delta") answer += event.delta;
    }

    expect(answer, "第二个候选成功时正文必须到达").toBe("OK");
    expect(seen.length, "应发 3 次：主模型 + 2 个候选（第 3 个候选未被尝试）").toBe(3);
    expect(seen[1]).toBe("candidate-one");
    expect(seen[2]).toBe("candidate-two");
  });

  test("所有候选都失败时不静默：不产出正文，且不重复已失败候选", async () => {
    let calls = 0;
    const stream = opencodeZenStreamSimple(
      model(FREE_LANE_PRIMARY_MODEL_ID),
      ctx,
      { sessionId: "chain-all-fail", fetch: async () => { calls += 1; return failResponse(); } },
      ["c1", "c2"],
    );
    let answer = "";
    for await (const event of stream) {
      if (event.type === "text_delta") answer += event.delta;
    }
    expect(answer).toBe("");
    expect(calls, "主模型 + 2 个候选 = 3 次，每个候选只试一次").toBe(3);
  });

  test("所有候选都失败时，必须把主模型的终态帧发出去（否则前端静默挂死）", async () => {
    // ⚠️⚠️ 回归：本修复的第一版在"全部候选失败"分支里**丢弃所有帧**然后 `output.end()`，
    // 结果消费端既没有内容也没有错误 ⇒ 什么都不产出 ⇒ 前端只收到握手 hello、
    // 然后一直等到超时（真机实测：一场对话卡死、零报错、界面无从判断）。
    // 判据：全败时必须收到**至少一个终态帧**（error 或 done），不能空收尾。
    const stream = opencodeZenStreamSimple(
      model(FREE_LANE_PRIMARY_MODEL_ID),
      ctx,
      { sessionId: "chain-all-fail-emit", fetch: async () => failResponse() },
      ["c1", "c2"],
    );
    const types: string[] = [];
    for await (const event of stream) types.push(String((event as { type: string }).type));

    expect(
      types.some((t) => t === "error" || t === "done"),
      `全部候选失败时必须有终态帧，实得：${JSON.stringify(types)}`,
    ).toBe(true);
    expect(types.filter((t) => t === "error").length, "应回放主模型的错误帧").toBeGreaterThan(0);
  });

  test("候选产出的正文完整透传，不夹带被丢弃候选的帧", async () => {
    const stream = opencodeZenStreamSimple(
      model(FREE_LANE_PRIMARY_MODEL_ID),
      ctx,
      {
        sessionId: "chain-content",
        fetch: async () => okResponse("来自候选"),
      },
      ["c1"],
    );
    let answer = "";
    for await (const event of stream) {
      if (event.type === "text_delta") answer += event.delta;
    }
    expect(answer).toBe("来自候选");
  });
});
