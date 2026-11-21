/** tests/local-model-setup.test.ts — 一键接入本机模型的写入边界。 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { authHeaderFor } from "./_helpers/auth";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;
let originalFetch: typeof fetch;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-local-model-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function authHeader(): Record<string, string> {
  return authHeaderFor(dataDir);
}

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

function providerYamlPath(): string {
  return path.join(dataDir, "api", "data", "providers.yaml");
}

describe("local model one-click setup", () => {
  test("does not write a dead provider when the local service is unreachable", async () => {
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const app = await makeApp();
    const response = await app.request("/api/models/local-setup", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ preset: "ollama" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json() as Record<string, unknown>;
    expect(body.code).toBe("LOCAL_MODEL_UNREACHABLE");
    expect(fs.existsSync(providerYamlPath())).toBe(false);
  });

  test("creates a local provider with discovered models, then reuses it", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5:7b" }, { id: "llama3.1:8b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const app = await makeApp();
    const headers = { "content-type": "application/json", ...authHeader() };
    const first = await app.request("/api/models/local-setup", {
      method: "POST",
      headers,
      body: JSON.stringify({ preset: "ollama" }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as Record<string, any>;
    expect(firstBody.created).toBe(true);
    expect(firstBody.provider).toMatchObject({ base_url: "http://127.0.0.1:11434/v1", models: ["qwen2.5:7b", "llama3.1:8b"] });
    expect(firstBody.provider.api_key).toBe("");

    const second = await app.request("/api/models/local-setup", {
      method: "POST",
      headers,
      body: JSON.stringify({ preset: "ollama" }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as Record<string, any>;
    expect(secondBody.created).toBe(false);
    expect(secondBody.provider.id).toBe(firstBody.provider.id);
    expect(calls).toBe(2);

    const yaml = fs.readFileSync(providerYamlPath(), "utf8");
    expect(yaml).toContain("qwen2.5:7b");
    expect(yaml.match(/base_url: http:\/\/127\.0\.0\.1:11434\/v1/g)?.length ?? 0).toBe(1);
  });

  test("rejects remote base_url even if the caller supplies one", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const app = await makeApp();
    const response = await app.request("/api/models/local-setup", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ base_url: "https://api.example.com/v1" }),
    });
    expect(response.status).toBe(400);
    expect(fetched).toBe(false);
  });
});
