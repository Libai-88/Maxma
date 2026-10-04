import { describe, expect, test } from "bun:test";
import { isOpenCodeZenModelAvailable, orderModels } from "../src/services/opencode-zen";

describe("OpenCode Zen model availability", () => {
  test("excludes free models not verified for anonymous external access", () => {
    expect(isOpenCodeZenModelAvailable("mimo-v2.5-free")).toBe(false);
    expect(isOpenCodeZenModelAvailable("nemotron-3-ultra-free")).toBe(false);
    expect(isOpenCodeZenModelAvailable("big-pickle")).toBe(false);
  });

  test("keeps supported free models and orders the default first", () => {
    expect(isOpenCodeZenModelAvailable("mimo-v2.6-flash-free")).toBe(true);
    expect(isOpenCodeZenModelAvailable("space-bunny-free")).toBe(true);
    expect(orderModels(["nemotron-3-ultra-free", "space-bunny-free", "mimo-v2.6-flash-free"])).toEqual([
      "mimo-v2.6-flash-free",
      "space-bunny-free",
      "nemotron-3-ultra-free",
    ]);
  });
});
