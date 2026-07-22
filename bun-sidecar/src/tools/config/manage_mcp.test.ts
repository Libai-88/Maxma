import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import manageMcpTool, { redactSensitive } from "./manage_mcp";
import { createConfiguredMcp, loadConfiguredMcp, mcpReloadUnsupportedResponse } from "../../session-bridge";

const SECRET = "bun-mcp-secret";
let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  tempRoots = [];
  delete process.env.MAXMA_PROJECT_ROOT;
});

test("redactSensitive masks case-insensitive nested sensitive keys", () => {
  const redacted = redactSensitive({
    Env: { TOKEN: SECRET, nested: { API_KEY: SECRET } },
    headers: { AUTHORIZATION: SECRET },
    safe: "visible",
  }) as Record<string, any>;

  expect(JSON.stringify(redacted)).not.toContain(SECRET);
  expect(redacted.Env.TOKEN).toBe("[REDACTED]");
  expect(redacted.Env.nested.API_KEY).toBe("[REDACTED]");
  expect(redacted.headers.AUTHORIZATION).toBe("[REDACTED]");
  expect(redacted.safe).toBe("visible");
});

test("manage_mcp get does not expose configured secrets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-test-"));
  tempRoots.push(root);
  const dataDir = path.join(root, "api", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "mcp_servers.yaml"),
    [
      "mcp_servers:",
      "- id: secure",
      "  transport: sse",
      "  url: https://example.test",
      "  headers:",
      `    Authorization: ${SECRET}`,
      "    nested:",
      `      api_key: ${SECRET}`,
      "  env:",
      `    TOKEN: ${SECRET}`,
    ].join("\n"),
  );
  process.env.MAXMA_PROJECT_ROOT = root;

  const result = await manageMcpTool.execute("test", {
    action: "get",
    server_id: "secure",
  });
  const text = result.content?.[0]?.text ?? "";

  expect(result.isError).not.toBe(true);
  expect(text).not.toContain(SECRET);
  expect(text).toContain("[REDACTED]");
});

test("sidecar converts Maxma MCP YAML to the OMP manager config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-bridge-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "api", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api", "data", "mcp_servers.yaml"),
    [
      "mcp_servers:",
      "- server_id: stdio-server",
      "  transport: stdio",
      "  command: node",
      "  args: [server.js]",
      "  env:",
      "    MODE: test",
      "  allowed_tools: [read]",
      "  blocked_tools: [write]",
      "- server_id: sse-server",
      "  transport: sse",
      "  url: https://example.test/sse",
      "  headers:",
      "    X-Test: yes",
      "- server_id: http-server",
      "  transport: streamable_http",
      "  url: https://example.test/mcp",
      "- server_id: websocket-server",
      "  transport: websocket",
      "  url: wss://example.test/mcp",
    ].join("\n"),
  );
  process.env.MAXMA_PROJECT_ROOT = root;

  const loaded = loadConfiguredMcp();
  expect(loaded?.configs["stdio-server"]).toMatchObject({
    type: "stdio",
    command: "node",
    args: ["server.js"],
    env: { MODE: "test" },
  });
  expect(loaded?.configs["sse-server"]).toMatchObject({ type: "sse", url: "https://example.test/sse" });
  expect(loaded?.configs["http-server"]).toMatchObject({ type: "http", url: "https://example.test/mcp" });
  expect(loaded?.configs["websocket-server"]).toMatchObject({ type: "websocket", url: "wss://example.test/mcp" });
  expect(loaded?.allowBlock["stdio-server"]).toEqual({ allow: ["read"], block: ["write"] });
  expect(loaded?.unsupported["websocket-server"]).toContain("does not support");
});

test("sidecar keeps the old create path when no MCP config exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-empty-"));
  tempRoots.push(root);
  process.env.MAXMA_PROJECT_ROOT = root;
  expect(loadConfiguredMcp()).toBeUndefined();
  expect(await createConfiguredMcp(root, {})).toBeUndefined();
});

test("sidecar reload reports the explicit session-rebuild requirement", () => {
  expect(mcpReloadUnsupportedResponse()).toEqual({
    status: "unsupported",
    code: "mcp_reload_requires_session_rebuild",
    message: "MCP configuration reload is not exposed through the Maxma API; rebuild the session",
  });
});
