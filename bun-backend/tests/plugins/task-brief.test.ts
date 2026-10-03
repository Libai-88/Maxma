import { describe, expect, test } from "bun:test";
import { createTaskBrief } from "../../src/plugins/task-brief";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

function runtimeReturning(body: string) {
  let captured: unknown;
  const runtime = {
    completeSimple: async (_model: unknown, context: unknown, options: unknown) => {
      captured = { context, options };
      return {
        role: "assistant",
        content: [{ type: "text", text: body }],
        usage: { input: 4, output: 4, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        api: "openai-completions", provider: "test", model: "test", stopReason: "stop", timestamp: Date.now(),
      };
    },
  } as unknown as Pick<ModelRuntime, "completeSimple">;
  return { runtime, captured: () => captured };
}

const model = { provider: "test", id: "test" } as Model<Api>;

describe("task brief plugin", () => {
  test("returns focused clarifying questions from the selected Maxma model", async () => {
    const mock = runtimeReturning('{"status":"clarify","summary":"需要确定早餐搜索范围","questions":["你希望在哪个区域找？","有预算范围吗？"],"missing":["区域会影响搜索结果"],"confidence":0.42,"risk_level":"medium"}');
    const result = await createTaskBrief({ originalRequest: "帮我找早餐", answers: [] }, model, mock.runtime);
    expect(result).toMatchObject({ status: "clarify", summary: "需要确定早餐搜索范围", questions: ["你希望在哪个区域找？", "有预算范围吗？"], missing: ["区域会影响搜索结果"], confidence: 0.42, riskLevel: "medium" });
    const call = mock.captured() as { context: { systemPrompt: string; messages: Array<{ content: string }> }; options: { temperature: number; maxTokens: number } };
    expect(call.context.systemPrompt).toContain("不要追问已明确的信息");
    expect(call.context.messages[0]?.content).toContain("帮我找早餐");
    expect(call.options).toEqual({ temperature: 0.2, maxTokens: 1200 });
  });

  test("returns the authored execution prompt after the user has aligned scope", async () => {
    const mock = runtimeReturning('{"status":"ready","summary":"在指定区域找早餐","executionPrompt":"目标：搜索人民广场附近早餐店。预算 30 元以内。列出营业时间和距离。","assumptions":["默认按步行距离排序"],"confidence":0.88,"risk_level":"low"}');
    const result = await createTaskBrief({ originalRequest: "找早餐", answers: ["人民广场附近，30元以内"] }, model, mock.runtime);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.executionPrompt).toContain("列出营业时间和距离");
    expect(result).toMatchObject({ assumptions: ["默认按步行距离排序"], confidence: 0.88, riskLevel: "low" });
  });

  test("rejects malformed model output", async () => {
    const mock = runtimeReturning("not json");
    await expect(createTaskBrief({ originalRequest: "任务", answers: [] }, model, mock.runtime)).rejects.toThrow();
  });
});
