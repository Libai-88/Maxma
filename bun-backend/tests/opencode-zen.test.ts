import { describe, expect, test } from "bun:test";
import { isOpenCodeZenModelAvailable, orderModels } from "../src/services/opencode-zen";

describe("OpenCode Zen model availability", () => {
  test("excludes free Mimo models blocked outside OpenCode", () => {
    expect(isOpenCodeZenModelAvailable("mimo-v2.5-free")).toBe(false);
    expect(isOpenCodeZenModelAvailable("mimo-v2.6-flash-free")).toBe(false);
  });

  test("keeps supported free models and orders the default first", () => {
    expect(isOpenCodeZenModelAvailable("space-bunny-free")).toBe(true);
    expect(orderModels(["nemotron-3-ultra-free", "space-bunny-free"])).toEqual([
      "space-bunny-free",
      "nemotron-3-ultra-free",
    ]);
  });
});
