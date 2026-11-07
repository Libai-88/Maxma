import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  isKiloModelAvailable,
  orderKiloModels,
} from "../src/services/kilo-free";
import {
  KILO_FALLBACK_MODEL_IDS,
  KILO_KNOWN_UNUSABLE_MODEL_IDS,
  KILO_PRIMARY_MODEL_ID,
  registerKiloTransport,
} from "../../bun-sidecar/src/kernel/kilo-free";

describe("Kilo 免费池可用性", () => {
  test("主模型与全部兜底候选都可用", () => {
    expect(isKiloModelAvailable(KILO_PRIMARY_MODEL_ID)).toBe(true);
    for (const id of KILO_FALLBACK_MODEL_IDS) expect(isKiloModelAvailable(id)).toBe(true);
  });

  test("实测不可用的模型不进目录（liquid 429 无法判定）", () => {
    for (const id of KILO_KNOWN_UNUSABLE_MODEL_IDS) {
      expect(isKiloModelAvailable(id)).toBe(false);
    }
    expect(KILO_KNOWN_UNUSABLE_MODEL_IDS).toContain("liquid/lfm-3-1.7b:free");
  });

  test("上游清单里的非白名单项不凭清单放行（价格 0 ≠ 实测可用）", () => {
    // lyria-3-* 是音频/视频生成模型：价格为 0 但未实测对话能力
    expect(isKiloModelAvailable("google/lyria-3-pro-preview")).toBe(false);
    // 白名单外的普通模型
    expect(isKiloModelAvailable("openai/gpt-5.3")).toBe(false);
    expect(isKiloModelAvailable(null)).toBe(false);
    expect(isKiloModelAvailable("  ")).toBe(false);
  });

  test("排序稳定：主模型首位，兜底按实测顺序，其余字母序", () => {
    expect(
      orderKiloModels(["stealth/crouton-alpha", "zeta/unknown", KILO_PRIMARY_MODEL_ID, KILO_FALLBACK_MODEL_IDS[0]!]),
    ).toEqual([KILO_PRIMARY_MODEL_ID, KILO_FALLBACK_MODEL_IDS[0]!, "stealth/crouton-alpha", "zeta/unknown"]);
  });
});

describe("Kilo 免费池内核传输", () => {
  test("注册进 provider 的元数据来自实测清单", () => {
    const registered: Record<string, Record<string, unknown>> = {};
    const runtime = {
      registerProvider: (id: string, config: Record<string, unknown>) => {
        registered[id] = config;
      },
    };
    registerKiloTransport(runtime, KILO_PRIMARY_MODEL_ID);
    const config = registered["kilo-free"]!;
    expect(config).toBeDefined();
    const models = config.models as Array<Record<string, unknown>>;
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe(KILO_PRIMARY_MODEL_ID);
    expect(models[0]!.contextWindow).toBe(256_000);
    expect(models[0]!.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(typeof config.streamSimple).toBe("function");
  });

  test("未知模型 id 的兜底元数据不会夸大上下文", () => {
    const registered: Record<string, Record<string, unknown>> = {};
    registerKiloTransport(
      { registerProvider: (id, config) => { registered[id] = config; } },
      "future/new-model",
    );
    const models = registered["kilo-free"]!.models as Array<Record<string, unknown>>;
    expect(models[0]!.contextWindow).toBe(256_000);
    expect(models[0]!.maxTokens).toBe(32_768);
  });
});

/**
 * 同一个模型 id 此前在 zen 渠道抄在 5 处（kernel 2 + services 3），失效时改不完。
 * Kilo 渠道从第一天起就锁住：services 必须引用内核常量，不得出现字面量副本。
 */
describe("Kilo 模型标识单源", () => {
  test("services 里不得出现免费模型 id 字面量", () => {
    const services = fs.readFileSync(
      path.resolve(import.meta.dir, "../src/services/kilo-free.ts"),
      "utf8",
    );
    const literals = [
      "kilo-auto/free",
      ...KILO_FALLBACK_MODEL_IDS,
      ...KILO_KNOWN_UNUSABLE_MODEL_IDS,
    ]
      .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    expect(
      new RegExp(`"(${literals})"`).test(services),
      "services 里出现了硬编码的免费模型 id，请改引用 kernel 的 KILO_* 常量",
    ).toBe(false);
    expect(services, "services 必须从内核常量取模型标识").toContain("KILO_PRIMARY_MODEL_ID");
  });
});
