/**
 * GAP-A7-001 回归：checkpoint.enabled 必须真实写入 session settings——
 * OMP 工具注册门（tools/index.ts isToolAllowed）读 session.settings，
 * 若此处不生效则清单宣告的 checkpoint/rewind 工具不会出现在模型 schema。
 */
import { describe, test, expect } from "bun:test";
import { buildCreateSessionOptions } from "../src/session-bridge";
import { parseModel } from "../src/model";

async function buildOpts(permissionMode: string) {
  return buildCreateSessionOptions({
    model: parseModel("opencode-zen/deepseek-v4-flash-free"),
    cwd: "D:\\Maxma\\MaxmaHere",
    authStorage: { getApiKey: async () => "test-key" } as never,
    tools: ["read", "write", "checkpoint", "rewind"],
    permissionMode,
  }, async () => null);
}

describe("checkpoint.enabled default (GAP-A7-001)", () => {
  test("yolo path registers checkpoint tools by default", async () => {
    const { options } = await buildOpts("auto");
    const settings = options.settings as unknown as { get(p: string): unknown };
    expect(settings.get("checkpoint.enabled")).toBe(true);
  });

  test("always-ask path registers checkpoint tools by default", async () => {
    const { options } = await buildOpts("ask");
    const settings = options.settings as unknown as { get(p: string): unknown };
    expect(settings.get("checkpoint.enabled")).toBe(true);
  });

  test("advisor and memory pins remain intact", async () => {
    const { options } = await buildOpts("auto");
    const settings = options.settings as unknown as { get(p: string): unknown };
    expect(settings.get("advisor.enabled")).toBe(false);
    expect(settings.get("memory.backend")).toBe("off");
  });
});
