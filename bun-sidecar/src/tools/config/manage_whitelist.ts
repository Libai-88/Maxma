/**
 * tools/config/manage_whitelist.ts — Manage path whitelist
 *
 * B-001: real config lives at <project_root>/api/data/path_whitelist.yaml
 * (see app_paths.PATH_WHITELIST_YAML_PATH). The file uses the YAML schema
 * { whitelist: [ { path, description, recursive } ] } — same as the Python
 * /api/path-whitelist endpoint. Previously this tool read/wrote a plain-text
 * file at config/.whitelist under the sidecar's cwd, which silently created
 * phantom paths.
 */
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import * as fs from "node:fs";
import * as path from "node:path";

const WHITELIST_PATH = "api/data/path_whitelist.yaml";

// B-001: resolve against MAXMA_PROJECT_ROOT (forwarded by sidecar_manager.py).
function projectRoot(): string {
  return process.env.MAXMA_PROJECT_ROOT ?? process.cwd();
}

interface WhitelistEntry {
  path: string;
  description?: string;
  recursive?: boolean;
}

function parseWhitelistYaml(text: string): WhitelistEntry[] {
  // Minimal parser for the fixed schema { whitelist: [ ... ] }.
  // Tolerates missing file / empty content.
  const lines = text.split("\n");
  const entries: WhitelistEntry[] = [];
  let inWhitelist = false;
  let current: WhitelistEntry | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    if (indent === 0 && trimmed === "whitelist:") {
      inWhitelist = true;
      continue;
    }
    if (indent === 0) {
      inWhitelist = false;
      continue;
    }
    if (!inWhitelist) continue;
    if (trimmed.startsWith("- ")) {
      if (current) entries.push(current);
      current = {};
      const inline = trimmed.slice(2);
      const colonIdx = inline.indexOf(":");
      if (colonIdx > 0) {
        const k = inline.slice(0, colonIdx).trim();
        const v = inline.slice(colonIdx + 1).trim();
        applyField(current, k, v);
      }
    } else if (current) {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const k = trimmed.slice(0, colonIdx).trim();
        const v = trimmed.slice(colonIdx + 1).trim();
        applyField(current, k, v);
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

function applyField(entry: WhitelistEntry, key: string, rawVal: string): void {
  const v = rawVal.replace(/^["']|["']$/g, "");
  if (key === "path") entry.path = v;
  else if (key === "description") entry.description = v;
  else if (key === "recursive") entry.recursive = v === "true";
}

function serializeWhitelistYaml(entries: WhitelistEntry[]): string {
  const lines: string[] = ["# AI 路径白名单", ""];
  if (entries.length === 0) {
    lines.push("whitelist: []");
  } else {
    lines.push("whitelist:");
    for (const e of entries) {
      const desc = e.description ?? "";
      const recursive = e.recursive ?? true;
      lines.push(`  - path: ${JSON.stringify(e.path)}`);
      lines.push(`    description: ${JSON.stringify(desc)}`);
      lines.push(`    recursive: ${recursive}`);
    }
  }
  return lines.join("\n") + "\n";
}

const params = z.object({
  action: z.enum(["list", "add", "remove"]).describe("操作类型"),
  path_str: z.string().optional().describe("文件路径"),
});

const tool: ToolDefinition<typeof params> = {
  name: "manage_whitelist",
  label: "Manage Path Whitelist",
  description: "管理 AI 可访问的文件路径白名单。白名单之外的路径 AI 无法读写。",
  parameters: params,
  execute: async (_toolCallId, params) => {
    const wlPath = path.resolve(projectRoot(), WHITELIST_PATH);
    const readList = (): WhitelistEntry[] => {
      if (!fs.existsSync(wlPath)) return [];
      return parseWhitelistYaml(fs.readFileSync(wlPath, "utf-8"));
    };
    const writeList = (items: WhitelistEntry[]) => {
      fs.mkdirSync(path.dirname(wlPath), { recursive: true });
      fs.writeFileSync(wlPath, serializeWhitelistYaml(items), "utf-8");
    };
    if (params.action === "list") {
      const items = readList();
      if (items.length === 0) return { content: [{ type: "text", text: "白名单为空" }] };
      return { content: [{ type: "text", text: `## 路径白名单 (${items.length} 项)\n\n${items.map((p, i) => `${i + 1}. ${p.path}${p.description ? ` — ${p.description}` : ""}`).join("\n")}` }] };
    }
    if (params.action === "add") {
      if (!params.path_str) return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      const items = readList();
      const resolved = path.resolve(params.path_str);
      if (items.some((it) => it.path === resolved)) return { content: [{ type: "text", text: `路径 "${resolved}" 已在白名单中` }] };
      items.push({ path: resolved, description: "", recursive: true });
      writeList(items);
      return { content: [{ type: "text", text: `已添加 "${resolved}"` }] };
    }
    if (params.action === "remove") {
      if (!params.path_str) return { content: [{ type: "text", text: "请指定 path_str" }], isError: true };
      const items = readList();
      const resolved = path.resolve(params.path_str);
      const idx = items.findIndex((it) => it.path === resolved);
      if (idx === -1) return { content: [{ type: "text", text: `路径 "${resolved}" 不在白名单中` }], isError: true };
      items.splice(idx, 1);
      writeList(items);
      return { content: [{ type: "text", text: `已移除 "${resolved}"` }] };
    }
    return { content: [{ type: "text", text: "未知操作" }], isError: true };
  },
};

export default tool;
