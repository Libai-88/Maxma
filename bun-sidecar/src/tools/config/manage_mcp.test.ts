import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import manageMcpTool, { redactSensitive } from "./manage_mcp";

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
