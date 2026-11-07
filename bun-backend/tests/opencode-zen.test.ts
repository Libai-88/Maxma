import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isOpenCodeZenModelAvailable,
  orderModels,
} from "../src/services/opencode-zen";
import {
  FREE_LANE_FALLBACK_MODEL_IDS,
  FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS,
  FREE_LANE_PRIMARY_MODEL_ID,
} from "../../bun-sidecar/src/kernel/opencode-zen";

describe("OpenCode Zen model availability", () => {
  test("excludes free models not verified for anonymous external access", () => {
    expect(isOpenCodeZenModelAvailable("mimo-v2.5-free")).toBe(false);
    expect(isOpenCodeZenModelAvailable("nemotron-3-ultra-free")).toBe(false);
    expect(isOpenCodeZenModelAvailable("big-pickle")).toBe(false);
  });

  test("默认模型排在首位，未验证的免费模型不进列表", () => {
    expect(isOpenCodeZenModelAvailable(FREE_LANE_PRIMARY_MODEL_ID)).toBe(true);
    expect(
      orderModels(["nemotron-3-ultra-free", FREE_LANE_PRIMARY_MODEL_ID]),
    ).toEqual([FREE_LANE_PRIMARY_MODEL_ID, "nemotron-3-ultra-free"]);
  });

  /**
   * `space-bunny-free` 曾被当作兜底目标与内置可选项，但 2026-10-27 实测上游
   * `GET /zen/v1/models`（84 个模型、8 个 `-free`）里**没有它**：
   * 选了必然报错、兜底必然失败。这条断言锁住"不要把没在目录里的模型放回列表"，
   * 恢复条件写在内核注释里（上游重新提供时加进 FREE_LANE_FALLBACK_MODEL_IDS）。
   */
  test("不再提供上游已下架的 space-bunny-free", () => {
    expect(FREE_LANE_FALLBACK_MODEL_IDS).not.toContain("space-bunny-free");
    expect(isOpenCodeZenModelAvailable("space-bunny-free")).toBe(false);
  });

  /**
   * `crouton-alpha-free` 是 2026-10-28 探测时还不存在的新目录项，2026-11-08
   * 实测 `403 This model is not available in your country`（与 beam-free 同款的
   * 地区封锁）。锁两件事：不进正向白名单、进地区受限名单（防将来被顺手放行）。
   */
  test("地区受限的 crouton-alpha-free 不进模型列表", () => {
    expect(FREE_LANE_FALLBACK_MODEL_IDS).not.toContain("crouton-alpha-free");
    expect(FREE_LANE_KNOWN_UNUSABLE_MODEL_IDS).toContain("crouton-alpha-free");
    expect(isOpenCodeZenModelAvailable("crouton-alpha-free")).toBe(false);
  });

  /**
   * 同一个模型 id 此前抄在 5 处（kernel 2 + services 3），失效时改不完。
   * 现在 services 必须引用内核常量，不得再出现字面量副本。
   */
  test("免费模型标识只有内核一处字面量", () => {
    const services = fs.readFileSync(
      path.resolve(import.meta.dir, "../src/services/opencode-zen.ts"),
      "utf8",
    );
    expect(
      /"mimo-v2\.6-flash-free"|"space-bunny-free"/.test(services),
      "services 里又出现了硬编码的免费模型名，请改引用 kernel 的 FREE_LANE_* 常量",
    ).toBe(false);
    expect(services, "services 必须从内核常量取模型标识").toContain("FREE_LANE_PRIMARY_MODEL_ID");
  });
});
