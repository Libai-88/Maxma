import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import manageMcpTool, { redactSensitive } from "./manage_mcp";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import {
  buildCreateSessionOptions,
  createConfiguredMcp,
  filterMcpTools,
  loadConfiguredMcp,
  mcpReloadUnsupportedResponse,
} from "../../session-bridge";

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
      "  allow: [list]",
      "  block: [delete]",
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
  expect(loaded?.configs["websocket-server"]).toBeUndefined();
  expect(loaded?.allowBlock["stdio-server"]).toEqual({ allow: ["read"], block: ["write"] });
  expect(loaded?.allowBlock["sse-server"]).toEqual({ allow: ["list"], block: ["delete"] });
  expect(loaded?.unsupported["websocket-server"]).toContain("does not support");
});

test("create path sends supported configs to OMP and excludes websocket", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-mixed-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "api", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api", "data", "mcp_servers.yaml"),
    [
      "mcp_servers:",
      "- server_id: short-lived",
      "  transport: stdio",
      "  command: node",
      "  args: [\"-e\", \"process.exit(0)\"]",
      "- server_id: websocket-server",
      "  transport: websocket",
      "  url: wss://example.test/mcp",
    ].join("\n"),
  );
  process.env.MAXMA_PROJECT_ROOT = root;

  const configured = await createConfiguredMcp(root, {});
  expect(configured?.configs["short-lived"]).toMatchObject({ type: "stdio", command: "node" });
  expect(configured?.configs["websocket-server"]).toBeUndefined();
  await configured?.manager.disconnectAll();
});

test("create options pass the real MCPManager and filtered MCP tools to the session factory", async () => {
  const manager = new MCPManager(process.cwd());
  const tools = filterMcpTools([
    { name: "read", mcpServerName: "docs", mcpToolName: "read" },
    { name: "write", mcpServerName: "docs", mcpToolName: "write" },
    { name: "search", mcpServerName: "docs", mcpToolName: "search" },
    { name: "read", mcpServerName: "other", mcpToolName: "read" },
  ], {
    docs: { allow: ["read", "write"], block: ["write"] },
  });

  const { options } = await buildCreateSessionOptions({
    model: {} as any,
    cwd: process.cwd(),
    authStorage: {},
    permissionMode: "operate",
  }, async () => ({
    manager,
    configs: { docs: { type: "stdio", command: "docs" } as any },
    tools,
  }));

  expect(options.mcpManager).toBe(manager);
  expect(options.mcpManager).toBeInstanceOf(MCPManager);
  expect((options.customTools as any[])
    .filter((tool) => tool.mcpServerName)
    .map((tool) => `${tool.mcpServerName}:${tool.mcpToolName}`)).toEqual([
    "docs:read",
    "other:read",
  ]);
});

test("sidecar keeps the old create path when no MCP config exists", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-empty-"));
  tempRoots.push(root);
  process.env.MAXMA_PROJECT_ROOT = root;
  expect(loadConfiguredMcp()).toBeUndefined();
  expect(await createConfiguredMcp(root, {})).toBeUndefined();
});

test("sidecar keeps the old create path when all configured transports are unsupported", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-websocket-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "api", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api", "data", "mcp_servers.yaml"),
    [
      "mcp_servers:",
      "- server_id: websocket-server",
      "  transport: websocket",
      "  url: wss://example.test/mcp",
    ].join("\n"),
  );
  process.env.MAXMA_PROJECT_ROOT = root;

  expect(await createConfiguredMcp(root, {})).toBeUndefined();
});

test("sidecar reload reports the explicit session-rebuild requirement", () => {
  expect(mcpReloadUnsupportedResponse()).toEqual({
    status: "unsupported",
    code: "mcp_reload_requires_session_rebuild",
    message: "MCP configuration reload is not exposed through the Maxma API; rebuild the session",
  });
});
