import { describe, expect, test } from "bun:test";

import { pickFallbackRoute, probeLocalProvider } from "../src/services/model-fallback";
import type { ModelRouteCandidate } from "../src/services/hardware";

function candidate(overrides: Partial<ModelRouteCandidate> = {}): ModelRouteCandidate {
  return {
    providerId: "local-ollama",
    providerLabel: "本机 Ollama",
    model: "qwen2.5:7b",
    location: "local",
    fit: "good",
    requiredMemoryGb: 4,
    device: "gpu",
    reason: "fit",
    ...overrides,
  };
}

describe("model fallback", () => {
  test("probes only local providers and normalizes OpenAI / Ollama model shapes", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5:7b" }, { id: "qwen2.5:7b" }, { id: "llama3.1:8b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const probe = await probeLocalProvider("http://127.0.0.1:11434/v1/", 500, fetchImpl);
    expect(probe.reachable).toBe(true);
    expect(probe.models).toEqual(["qwen2.5:7b", "llama3.1:8b"]);
    expect(requests).toEqual(["http://127.0.0.1:11434/v1/models"]);
  });

  test("does not probe remote providers even when a caller asks", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const probe = await probeLocalProvider("https://api.example.com/v1", 500, fetchImpl);
    expect(probe.reachable).toBe(false);
    expect(called).toBe(false);
  });

  test("turns HTTP failures and malformed payloads into unreachable instead of throwing", async () => {
    const failing = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    expect(await probeLocalProvider("http://localhost:11434/v1", 500, failing)).toMatchObject({
      reachable: false,
      models: [],
    });
    const malformed = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const probe = await probeLocalProvider("http://localhost:11434/v1", 500, malformed);
    expect(probe.reachable).toBe(true);
    expect(probe.models).toEqual([]);
  });

  test("picks a fallback route but skips the failed pair and over-memory models", () => {
    const candidates: ModelRouteCandidate[] = [
      candidate(),
      candidate({ providerId: "cloud-a", providerLabel: "Cloud A", model: "big-model", location: "cloud", fit: "too_large" }),
      candidate({ providerId: "cloud-b", providerLabel: "Cloud B", model: "small-cloud", location: "cloud", fit: "cloud" }),
    ];
    expect(pickFallbackRoute(candidates, { providerId: "local-ollama", model: "qwen2.5:7b" })).toMatchObject({
      providerId: "cloud-b",
      model: "small-cloud",
    });
  });
});
