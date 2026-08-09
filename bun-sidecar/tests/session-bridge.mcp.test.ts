/**
 * MCP configuration parsing tests: loadConfiguredMcp reads a YAML file from
 * MAXMA_PROJECT_ROOT/api/data/mcp_servers.yaml and classifies each server as
 * config / allowBlock / unsupported. Pure file-parsing logic — no network.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfiguredMcp } from "../src/session-bridge";

let projectRoot: string;
let originalRoot: string | undefined;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-"));
  originalRoot = process.env.MAXMA_PROJECT_ROOT;
  process.env.MAXMA_PROJECT_ROOT = projectRoot;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
  else process.env.MAXMA_PROJECT_ROOT = originalRoot;
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeMcpYaml(content: string): void {
  const dir = path.join(projectRoot, "api", "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mcp_servers.yaml"), content, "utf8");
}

describe("loadConfiguredMcp", () => {
  test("returns undefined when no config file exists", () => {
    expect(loadConfiguredMcp()).toBeUndefined();
  });

  test("parses stdio / sse / streamable_http transports", () => {
    writeMcpYaml(`
mcp_servers:
  - server_id: local
    transport: stdio
    command: node
    args: ["server.js"]
    enabled: true
  - server_id: remote
    transport: sse
    url: https://example.com/sse
  - server_id: http-srv
    transport: streamable_http
    url: https://example.com/http
`);
    const result = loadConfiguredMcp();
    expect(result?.configs).toBeDefined();
    expect(result?.configs["local"]?.type).toBe("stdio");
    expect(result?.configs["remote"]?.type).toBe("sse");
    expect(result?.configs["http-srv"]?.type).toBe("http");
  });

  test("disabled servers are skipped", () => {
    writeMcpYaml(`
mcp_servers:
  - server_id: off
    transport: stdio
    command: node
    enabled: false
`);
    const result = loadConfiguredMcp();
    expect(result).toBeUndefined(); // no enabled configs at all
  });

  test("extracts allow/block tool lists per server", () => {
    writeMcpYaml(`
mcp_servers:
  - server_id: a
    transport: stdio
    command: node
    allowed_tools: ["fetch"]
  - server_id: b
    transport: stdio
    command: node
    blocked_tools: ["write"]
`);
    const result = loadConfiguredMcp();
    expect(result?.allowBlock["a"]?.allow).toEqual(["fetch"]);
    expect(result?.allowBlock["b"]?.block).toEqual(["write"]);
  });

  test("websocket transport is flagged unsupported, never connected", () => {
    writeMcpYaml(`
mcp_servers:
  - server_id: ws-srv
    transport: websocket
    url: ws://example.com
`);
    const result = loadConfiguredMcp();
    expect(result?.unsupported["ws-srv"]).toContain("websocket");
    expect(result?.configs["ws-srv"]).toBeUndefined();
  });

  test("unknown transport is flagged unsupported", () => {
    writeMcpYaml(`
mcp_servers:
  - server_id: weird
    transport: smoke-signal
`);
    const result = loadConfiguredMcp();
    expect(result?.unsupported["weird"]).toContain("Unsupported MCP transport");
  });

  test("invalid YAML is ignored without throwing", () => {
    writeMcpYaml("{{{ not yaml :::");
    expect(loadConfiguredMcp()).toBeUndefined();
  });

  test("non-object entries are skipped gracefully", () => {
    writeMcpYaml(`
mcp_servers:
  - "just-a-string"
  - server_id: ok
    transport: stdio
    command: node
`);
    const result = loadConfiguredMcp();
    expect(result?.configs["ok"]?.type).toBe("stdio");
  });
});
