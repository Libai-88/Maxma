import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createMcpRoutes } from "../src/routes/mcp";
import { createCapabilitiesRoutes } from "../src/routes/capabilities";
import { zipSync } from "fflate";

describe("ModelScope MCP marketplace", () => {
  test("search proxies Chinese query and maps server metadata", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ success: true, data: { total_count: 1, mcp_server_list: [{ id: "demo/search", chinese_name: "搜索工具", publisher: "社区作者", view_count: 42, locales: { zh: { description: "中文搜索" } } }] } });
    }) as typeof fetch;
    try {
      const app = createMcpRoutes({ sessions: new Map(), callRpc: async () => ({ ok: true, result: {} }) });
      const response = await app.request("/api/mcp/modelscope?q=%E6%90%9C%E7%B4%A2&page=2");
      expect(response.status).toBe(200);
      expect(requestBody).toEqual({ search: "搜索", page_number: 2, page_size: 20 });
      expect(await response.json()).toEqual({ servers: [{ id: "demo/search", name: "搜索工具", description: "中文搜索", author: "社区作者", logo_url: "", view_count: 42, categories: [] }], total: 1, page: 2, page_size: 20 });
    } finally { globalThis.fetch = originalFetch; }
  });

  test("rejects invalid marketplace server identifiers before network access", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("unexpected network call"); }) as typeof fetch;
    try {
      const app = createMcpRoutes({ sessions: new Map(), callRpc: async () => ({ ok: true, result: {} }) });
      const response = await app.request("/api/mcp/modelscope/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ server_id: "../../outside" }) });
      expect(response.status).toBe(400);
    } finally { globalThis.fetch = originalFetch; }
  });

  test("imports valid stdio configuration and requires placeholder credentials", async () => {
    const originalFetch = globalThis.fetch;
    const originalDataDir = process.env.MAXMA_DATA_DIR;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-modelscope-"));
    process.env.MAXMA_DATA_DIR = dataDir;
    globalThis.fetch = (async () => Response.json({ success: true, data: {
      id: "@demo/search", name: "Search", description: "Search server",
      server_config: [{ mcpServers: { search: { command: "npx", args: ["-y", "search-mcp"], env: { API_KEY: "${API_KEY}" } } } }],
    } })) as typeof fetch;
    try {
      const app = createMcpRoutes({ sessions: new Map(), callRpc: async () => ({ ok: true, result: {} }) });
      const missingEnv = await app.request("/api/mcp/modelscope/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ server_id: "@demo/search" }) });
      expect(missingEnv.status).toBe(422);
      const installed = await app.request("/api/mcp/modelscope/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ server_id: "@demo/search", env: { API_KEY: "test-secret" } }) });
      expect(installed.status).toBe(200);
      const saved = fs.readFileSync(path.join(dataDir, "api", "data", "mcp_servers.yaml"), "utf8");
      expect(saved).toContain("test-secret");
      expect((await installed.json() as { server: { env: Record<string, string> } }).server.env.API_KEY).toBe("[REDACTED]");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
      else process.env.MAXMA_DATA_DIR = originalDataDir;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });


  test("rejects oversized declared Skill ZIP contents before extraction", async () => {
    const originalFetch = globalThis.fetch;
    const archive = zipSync({ "SKILL.md": [new Uint8Array(20 * 1024 * 1024 + 1), { level: 9 }] });
    expect(archive.length).toBeLessThan(25 * 1024 * 1024);
    globalThis.fetch = (() => new Response(archive)) as typeof fetch;
    try {
      const app = createCapabilitiesRoutes({ sessionCount: () => 0, endpoints: () => [] });
      const response = await app.request("/api/skills/market/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "oversized-test-skill" }) });
      expect(response.status).toBe(502);
      expect((await response.json() as { detail: string }).detail).toContain("20 MB");
    } finally { globalThis.fetch = originalFetch; }
  });


  test("enforces a hard expansion limit when a ZIP understates its declared size", async () => {
    const originalFetch = globalThis.fetch;
    const archive = zipSync({ "SKILL.md": [new Uint8Array(20 * 1024 * 1024 + 1), { level: 9 }] });
    const bytes = new Uint8Array(archive);
    const view = new DataView(bytes.buffer);
    let central = -1;
    for (let offset = 0; offset < bytes.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) { central = offset; break; }
    }
    expect(central).toBeGreaterThanOrEqual(0);
    view.setUint32(central + 24, 1, true);
    globalThis.fetch = (() => new Response(bytes)) as typeof fetch;
    try {
      const app = createCapabilitiesRoutes({ sessionCount: () => 0, endpoints: () => [] });
      const response = await app.request("/api/skills/market/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "forged-size-test-skill" }) });
      expect(response.status).toBe(502);
      expect((await response.json() as { detail: string }).detail).toContain("20 MB");
    } finally { globalThis.fetch = originalFetch; }
  });


  test("installs a valid Skill ZIP into the user skills directory", async () => {
    const originalFetch = globalThis.fetch;
    const originalUserProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-skill-install-"));
    process.env.USERPROFILE = homeDir;
    process.env.HOME = homeDir;
    const archive = zipSync({ "market-skill/SKILL.md": new TextEncoder().encode("---\nname: market-skill\ndescription: Test skill\n---\n") });
    globalThis.fetch = (() => new Response(archive)) as typeof fetch;
    try {
      const app = createCapabilitiesRoutes({ sessionCount: () => 0, endpoints: () => [] });
      const response = await app.request("/api/skills/market/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: "market-skill" }) });
      expect(response.status).toBe(200);
      expect(fs.readFileSync(path.join(homeDir, ".agents", "skills", "market-skill", "SKILL.md"), "utf8")).toContain("name: market-skill");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

});
