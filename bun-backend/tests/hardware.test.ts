/** tests/hardware.test.ts — 硬件探针纯函数与模型路由排序。 */
import { describe, expect, test } from "bun:test";

import {
  assessModelFit,
  estimateModelMemoryGb,
  estimateParameterBillions,
  isLocalProviderUrl,
  rankModelRoutes,
  type HardwareInfo,
} from "../src/services/hardware";

const hardware: HardwareInfo = {
  platform: "win32",
  arch: "x64",
  cpuModel: "AMD Ryzen 9",
  cpuCores: 16,
  memoryTotalBytes: 32 * 1024 ** 3,
  memoryFreeBytes: 12 * 1024 ** 3,
  gpus: [{ name: "NVIDIA RTX 4060 Laptop", memoryBytes: 8 * 1024 ** 3, source: "wmi" }],
  probedAt: 1,
  warnings: [],
};

describe("hardware and model routing", () => {
  test("parses parameter counts and quantization into memory estimates", () => {
    expect(estimateParameterBillions("qwen2.5:7b")).toBe(7);
    expect(estimateParameterBillions("llama-3.1-70B-Instruct")).toBe(70);
    expect(estimateParameterBillions("some-model")).toBeNull();
    expect(estimateModelMemoryGb("qwen2.5:7b", 7)).toBeGreaterThan(4);
    expect(estimateModelMemoryGb("qwen2.5:14b-q8", 14)).toBeGreaterThan(15);
  });

  test("classifies local URLs and cloud providers", () => {
    expect(isLocalProviderUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalProviderUrl("http://localhost:8080")).toBe(true);
    expect(isLocalProviderUrl("https://api.openai.com/v1")).toBe(false);
    const cloud = assessModelFit("gpt-4o", hardware, "https://api.openai.com/v1");
    expect(cloud).toMatchObject({ location: "cloud", fit: "cloud", device: "remote" });
  });

  test("uses GPU when model fits, CPU when only RAM fits, rejects oversized models", () => {
    const good = assessModelFit("qwen2.5:7b", hardware, "http://127.0.0.1:11434/v1");
    expect(good.fit).toBe("good");
    expect(good.device).toBe("gpu");

    const cpu = assessModelFit("llama-3.1-32b", hardware, "http://127.0.0.1:11434/v1");
    expect(cpu.fit).toBe("tight");
    expect(cpu.device).toBe("cpu");

    const tooLarge = assessModelFit("llama-3.1-180b", hardware, "http://127.0.0.1:11434/v1");
    expect(tooLarge.fit).toBe("too_large");
  });

  test("ranks viable local models ahead of cloud and oversized ones", () => {
    const ranked = rankModelRoutes(hardware, [
      { id: "local", label: "Ollama", base_url: "http://127.0.0.1:11434/v1", enabled: true, models: ["qwen2.5:32b", "qwen2.5:7b"] },
      { id: "cloud", label: "Cloud", base_url: "https://api.openai.com/v1", enabled: true, models: ["gpt-4o"] },
      { id: "off", label: "Disabled", base_url: "http://127.0.0.1:11434/v1", enabled: false, models: ["qwen2.5:7b"] },
    ]);
    expect(ranked[0]?.model).toBe("qwen2.5:7b");
    expect(ranked.some((candidate) => candidate.providerId === "off")).toBe(false);
    expect(ranked.find((candidate) => candidate.model === "gpt-4o")?.fit).toBe("cloud");
  });
});
