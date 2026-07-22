/**
 * Repro for BC-001 (B-010 challenge): show that Red's rewritten `parseYaml`
 * in bun-sidecar/src/tools/config/manage_mcp.ts mis-parses the project's
 * ACTUAL api/data/mcp_servers.yaml file.
 *
 * Run:  node patches/repro_b010_parseYaml.mjs
 *   or: bun  patches/repro_b010_parseYaml.mjs
 *
 * Expected (correct) parse of api/data/mcp_servers.yaml:
 *   { mcp_servers: [ {
 *       args: ["-y", "@modelcontextprotocol/server-filesystem", "D:/Maxma"],
 *       command: "npx",
 *       description: "...",
 *       enabled: true,
 *       server_id: "filesystem",
 *       transport: "stdio"
 *   } ] }
 *
 * Actual (buggy) output from the new parseYaml:
 *   { mcp_servers: [ {
 *       args: [ { D: "/Maxma" } ],          <-- WRONG: lost "-y" and "@...", D:/Maxma parsed as dict
 *       command: "npx",
 *       description: "...",
 *       enabled: true,
 *       server_id: "filesystem",
 *       transport: "stdio"
 *   } ] }
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Verbatim copy of Red's new parseYaml from manage_mcp.ts (BC-001 fix) ──
function parseYaml(text) {
  const lines = text.split("\n");
  const result = {};
  const stack = [{ indent: -1, node: result }];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    // BC-001: don't pop an array at the same indent when the new line is
    // also a list item — sibling list items append to the same array.
    const isListItem = trimmed.startsWith("- ");
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      const top = stack[stack.length - 1];
      if (isListItem && Array.isArray(top.node) && top.indent === indent) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    if (trimmed.startsWith("- ")) {
      const val = trimmed.slice(2);
      let arr;
      if (Array.isArray(parent)) {
        arr = parent;
      } else {
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        arr = [];
        parent[lastKey] = arr;
        stack.push({ indent, node: arr });
      }
      // BC-001: guard against false positives like `D:/Maxma` (path with
      // drive-letter colon). Require the key to be a YAML identifier and
      // the value (when non-empty) not to start with `/` or `\` (path).
      // Empty value (`- key:`) is allowed — used by `args:` in the schema.
      const colonIdx = val.indexOf(":");
      const keyCandidate = colonIdx > 0 ? val.slice(0, colonIdx).trim() : "";
      const valCandidate = colonIdx > 0 ? val.slice(colonIdx + 1).trim() : "";
      const isYamlKey = /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(keyCandidate);
      const isPathLike =
        valCandidate.startsWith("/") || valCandidate.startsWith("\\");
      if (colonIdx > 0 && isYamlKey && !isPathLike) {
        const obj = {};
        const k = keyCandidate;
        const v = coerceScalar(valCandidate);
        obj[k] = v;
        arr.push(obj);
        stack.push({ indent, node: obj });
      } else {
        arr.push(coerceScalar(val));
      }
    } else {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const rawVal = trimmed.slice(colonIdx + 1).trim();
        if (rawVal === "") {
          const child = {};
          parent[key] = child;
          stack.push({ indent, node: child });
        } else {
          parent[key] = coerceScalar(rawVal);
        }
      }
    }
  }
  return result;
}

function coerceScalar(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  const m = raw.match(/^["'](.*)["']$/);
  if (m) return m[1];
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

// ── Run against the actual config file ──
const configPath = path.resolve("api/data/mcp_servers.yaml");
const raw = fs.readFileSync(configPath, "utf-8");
console.log("=== Input (api/data/mcp_servers.yaml) ===");
console.log(raw);
const parsed = parseYaml(raw);
console.log("=== Parsed output ===");
console.log(JSON.stringify(parsed, null, 2));

const server = parsed?.mcp_servers?.[0];
console.log("\n=== Bug check ===");
console.log("mcp_servers is array?", Array.isArray(parsed?.mcp_servers));
console.log("server.args:", JSON.stringify(server?.args));
console.log("server.args is array of strings?",
  Array.isArray(server?.args) && server.args.every(x => typeof x === "string"));
console.log("server.args has 'D' key (BUG)?",
  Array.isArray(server?.args) && server.args.some(x => typeof x === "object" && x !== null && "D" in x));
console.log("server.args length (expected 3):", server?.args?.length);

const expectedArgs = ["-y", "@modelcontextprotocol/server-filesystem", "D:/Maxma"];
const argsMatch = JSON.stringify(server?.args) === JSON.stringify(expectedArgs);
console.log("args match expected?", argsMatch);
console.log("expected args:", JSON.stringify(expectedArgs));

if (!argsMatch) {
  console.log("\n*** BC-001 CONFIRMED: parseYaml mis-parses api/data/mcp_servers.yaml ***");
  console.log("*** The 'args' list is corrupted: items lost and 'D:/Maxma' parsed as {D:'/Maxma'} ***");
  process.exit(1);
} else {
  console.log("\n*** parseYaml produced correct output (challenge would be rejected) ***");
  process.exit(0);
}
