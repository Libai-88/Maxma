/**
 * routes/mcp.ts — MCP 服务器配置 CRUD + 热加载 + Registry + OAuth
 * （api/routes/mcp.py 的 Bun 直译，阶段二 2.4b）。
 *
 * 存储：api/data/mcp_servers.yaml（与 Python MCP_CONFIG_PATH 同文件）。
 * mcp_tools 状态源：从活跃 pi 会话的工具注册表读取真实工具。
 * discovered/reload：配置由 YAML 提供，工具状态从当前会话聚合；
 * pi 会话的 MCP 配置在创建时绑定，配置变更后需重建会话。
 *
 * 校验分工：Pydantic 422（字段类型）先行，transport 级 400（业务）在后——
 * 与 FastAPI 先校验 body 再进 handler 的顺序对齐。
 */

import { Hono, type Context } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getMcpConfigPath } from "../app-paths";
import { BunYamlSafeParse, writeYamlAtomic } from "../yaml-store";
import {
  McpHttpError,
  REDACTED,
  mergeRedactedMapping,
  redactSensitive,
  validateEnvVars,
  validateStdioCommand,
} from "./mcp-validation";
import {
  exchangeOauthCode,
  loadOauthTokens,
  newOauthState,
  oauthPendingStates,
} from "./mcp-oauth";
import type { PiSessionRecord } from "../../../bun-sidecar/src/kernel/bridge-pi";

const SMITHERY_REGISTRY_URL = "https://registry.smithery.ai/servers";
const TRANSPORTS = new Set(["stdio", "streamable_http"]);

type Entry = Record<string, unknown>;

// ── YAML 读写（MCP-CORRUPT-001 损坏拒绝）──

export function mcpYamlPath(): string {
  return getMcpConfigPath();
}

export function loadRaw(): Entry[] {
  const file = mcpYamlPath();
  if (!fs.existsSync(file)) return [];
  const raw = BunYamlSafeParse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const servers = (raw as Record<string, unknown>).mcp_servers;
  return Array.isArray(servers) ? (servers.filter((e) => e && typeof e === "object") as Entry[]) : [];
}

class McpYamlCorruptedError extends Error {}

function saveRaw(servers: Entry[]): void {
  const file = mcpYamlPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try {
      Bun.YAML.parse(fs.readFileSync(file, "utf8"));
    } catch (exc) {
      throw new McpYamlCorruptedError(`YAML 解析失败: ${file}: ${String(exc)}`);
    }
  }
  writeYamlAtomic(file, { mcp_servers: servers });
}

// ── 422 字段校验（Pydantic v2 lax 等价）──

type DetailEntry = Record<string, unknown>;
interface ValidationError {
  detail: DetailEntry[];
}

const missing = (field: string, body: unknown): DetailEntry => ({
  type: "missing", loc: ["body", field], msg: "Field required", input: body,
});
const stringType = (loc: (string | number)[], value: unknown): DetailEntry => ({
  type: "string_type", loc, msg: "Input should be a valid string", input: value,
});
const listType = (loc: (string | number)[], value: unknown): DetailEntry => ({
  type: "list_type", loc, msg: "Input should be a valid list", input: value,
});
const dictType = (loc: (string | number)[], value: unknown): DetailEntry => ({
  type: "dict_type", loc, msg: "Input should be a valid dictionary", input: value,
});
const boolParsing = (loc: (string | number)[], value: unknown): DetailEntry => ({
  type: "bool_parsing", loc, msg: "Input should be a valid boolean, unable to interpret input", input: value,
});
const floatError = (loc: (string | number)[], value: unknown): DetailEntry =>
  typeof value === "string"
    ? { type: "float_parsing", loc, msg: "Input should be a valid number, unable to parse string as a number", input: value }
    : { type: "float_type", loc, msg: "Input should be a valid number", input: value };

function coerceBoolLax(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "on", "yes", "y", "t"].includes(s)) return true;
    if (["false", "0", "off", "no", "n", "f"].includes(s)) return false;
    return null;
  }
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  return null;
}

function coerceFloatLax(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** list[str]：非数组→list_type；元素非字符串→string_type（loc 带下标）。 */
function checkStrList(field: string, value: unknown, errors: DetailEntry[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(listType(["body", field], value));
    return null;
  }
  const out: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== "string") errors.push(stringType(["body", field, i], item));
    else out.push(item);
  });
  return errors.length ? null : out;
}

function checkDict(field: string, value: unknown, errors: DetailEntry[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(dictType(["body", field], value));
    return null;
  }
  return value as Record<string, unknown>;
}

function checkStr(field: string, value: unknown, errors: DetailEntry[]): string | null {
  if (typeof value !== "string") {
    errors.push(stringType(["body", field], value));
    return null;
  }
  return value;
}

function checkBool(field: string, value: unknown, errors: DetailEntry[], def: boolean): boolean {
  const b = coerceBoolLax(value);
  if (b === null) {
    errors.push(boolParsing(["body", field], value));
    return def;
  }
  return b;
}

function checkFloat(field: string, value: unknown, errors: DetailEntry[]): number | null {
  const n = coerceFloatLax(value);
  if (n === null) {
    errors.push(floatError(["body", field], value));
    return null;
  }
  return n;
}

/**
 * MCPServerCreateBody 校验。返回归一化后的字段值（transport 级 400 由调用方
 * 在 Pydantic 通过后执行）。
 */
function validateCreateBody(body: Record<string, unknown>):
  | { ok: true; value: Entry }
  | { ok: false; error: ValidationError } {
  const errors: DetailEntry[] = [];
  const out: Entry = {};

  if (body.server_id === undefined) errors.push(missing("server_id", body));
  else checkStr("server_id", body.server_id, errors) !== null && (out.server_id = body.server_id);

  if (body.transport === undefined) errors.push(missing("transport", body));
  else checkStr("transport", body.transport, errors) !== null && (out.transport = body.transport);

  out.enabled = "enabled" in body ? checkBool("enabled", body.enabled, errors, true) : true;
  out.description = "description" in body ? (checkStr("description", body.description, errors) ?? "") : "";

  if ("allowed_tools" in body && body.allowed_tools !== null && body.allowed_tools !== undefined) {
    const v = checkStrList("allowed_tools", body.allowed_tools, errors);
    if (v) out.allowed_tools = v;
  }
  if ("blocked_tools" in body && body.blocked_tools !== null && body.blocked_tools !== undefined) {
    const v = checkStrList("blocked_tools", body.blocked_tools, errors);
    if (v) out.blocked_tools = v;
  }

  if ("command" in body && body.command !== null && body.command !== undefined) {
    checkStr("command", body.command, errors);
    out.command = body.command;
  }
  if ("args" in body && body.args !== null && body.args !== undefined) {
    const v = checkStrList("args", body.args, errors);
    if (v) out.args = v;
  }
  if ("env" in body && body.env !== null && body.env !== undefined) {
    const v = checkDict("env", body.env, errors);
    if (v) out.env = v;
  }
  if ("cwd" in body && body.cwd !== null && body.cwd !== undefined) {
    checkStr("cwd", body.cwd, errors);
    out.cwd = body.cwd;
  }
  if ("url" in body && body.url !== null && body.url !== undefined) {
    checkStr("url", body.url, errors);
    out.url = body.url;
  }
  if ("headers" in body && body.headers !== null && body.headers !== undefined) {
    const v = checkDict("headers", body.headers, errors);
    if (v) out.headers = v;
  }
  if ("timeout" in body && body.timeout !== null && body.timeout !== undefined) {
    const n = checkFloat("timeout", body.timeout, errors);
    if (n !== null) out.timeout = n;
  }
  out.tls_verify = "tls_verify" in body ? checkBool("tls_verify", body.tls_verify, errors, true) : true;

  if (errors.length > 0) return { ok: false, error: { detail: errors } };
  return { ok: true, value: out };
}

/** MCPServerUpdateBody：全字段可选；返回 exclude_unset 的更新集。 */
function validateUpdateBody(body: Record<string, unknown>):
  | { ok: true; fields: Entry }
  | { ok: false; error: ValidationError } {
  const errors: DetailEntry[] = [];
  const fields: Entry = {};

  for (const key of ["enabled", "description", "allowed_tools", "blocked_tools", "command", "args", "env", "cwd", "url", "headers", "timeout", "tls_verify"] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v === null) {
      fields[key] = null;
      continue;
    }
    if (key === "enabled" || key === "tls_verify") {
      const b = checkBool(key, v, errors, true);
      if (!errors.length) fields[key] = b;
    } else if (key === "description" || key === "command" || key === "cwd" || key === "url") {
      const s = checkStr(key, v, errors);
      if (s !== null) fields[key] = s;
    } else if (key === "allowed_tools" || key === "blocked_tools" || key === "args") {
      const l = checkStrList(key, v, errors);
      if (l) fields[key] = l;
    } else if (key === "env" || key === "headers") {
      const d = checkDict(key, v, errors);
      if (d) fields[key] = d;
    } else if (key === "timeout") {
      const n = checkFloat(key, v, errors);
      if (n !== null) fields[key] = n;
    }
  }
  if (errors.length > 0) return { ok: false, error: { detail: errors } };
  return { ok: true, fields };
}

// ── transport 级构建/校验（400）──

function buildServerDict(b: Entry): Entry {
  const d: Entry = {
    server_id: b.server_id,
    transport: b.transport,
    enabled: b.enabled,
    description: b.description,
  };
  if (b.allowed_tools !== undefined) d.allowed_tools = b.allowed_tools;
  if (b.blocked_tools !== undefined) d.blocked_tools = b.blocked_tools;

  const t = b.transport as string;
  if (t === "stdio") {
    d.command = validateStdioCommand(String(b.command ?? ""));
    // Python `if body.args:` 空列表为假——JS [] 为真，显式判空
    if (Array.isArray(b.args) && b.args.length > 0) d.args = b.args;
    if (b.env && typeof b.env === "object" && !Array.isArray(b.env) && Object.keys(b.env).length > 0) {
      validateEnvVars(b.env as Record<string, unknown>);
      d.env = b.env;
    }
    if (b.cwd) d.cwd = b.cwd;
  } else if (t === "streamable_http") {
    if (!b.url) throw new McpHttpError(400, `${t} 模式必须指定 url`);
    d.url = b.url;
    d.tls_verify = b.tls_verify;
    if (b.headers && typeof b.headers === "object" && !Array.isArray(b.headers) && Object.keys(b.headers).length > 0) {
      d.headers = b.headers;
    }
    if (b.timeout !== undefined) d.timeout = b.timeout;
  } else {
    throw new McpHttpError(400, `不支持的 transport: ${t}，仅支持 stdio/streamable_http`);
  }
  return d;
}

function validateUpdateAgainstTransport(target: Entry, updateFields: Entry): void {
  const transport = String(updateFields.transport ?? target.transport ?? "");
  if (transport === "streamable_http") {
    const url = updateFields.url ?? target.url ?? "";
    if (!url) throw new McpHttpError(400, `${transport} 模式必须指定 url`);
  } else if (transport === "stdio") {
    const cmd = updateFields.command ?? target.command ?? "";
    if (updateFields.command) validateStdioCommand(String(updateFields.command));
    else if (!cmd) throw new McpHttpError(400, "stdio 模式必须指定 command");
  }
}

// ── _do_reload 归一化视图 ──

function reloadView(entries: Entry[]) {
  const servers = entries
    .filter((e) => e && typeof e === "object")
    .map((entry) => ({
      id: String(entry.server_id ?? ""),
      name: String(entry.name ?? entry.server_id ?? ""),
      status: entry.enabled === false ? "disabled" : "unknown",
      transport: String(entry.transport ?? "unknown"),
      command: String(entry.command ?? ""),
    }));
  return {
    status: "configured",
    servers: redactSensitive(servers) as unknown[],
    tool_count: 0,
  };
}

function findEntry(entries: Entry[], serverId: string): Entry | null {
  return entries.find((e) => e.server_id === serverId) ?? null;
}

/** 从已绑定的 pi 会话读取真实 MCP 工具注册表。 */
function collectMcpTools(deps: McpDeps, serverId?: string) {
  const prefix = serverId ? `mcp__${serverId}__` : "mcp__";
  const tools = new Map<string, Record<string, unknown>>();
  for (const record of deps.sessions.values()) {
    try {
      for (const tool of record.session.getAllTools()) {
        if (!tool.name.startsWith(prefix)) continue;
        tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          exposure: tool.exposure,
          source: tool.sourceInfo,
        });
      }
    } catch {
      // 会话正在销毁时读取工具表可能失败，忽略该会话即可。
    }
  }
  return [...tools.values()];
}

// ── Registry 代理 ──

interface RegistryFetchError {
  status: number;
  detail: string;
}

async function fetchRegistry(url: string): Promise<{ data: unknown } | { error: RegistryFetchError }> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { error: { status: 504, detail: "Smithery Registry 请求超时" } };
    }
    return { error: { status: 502, detail: `无法连接 Smithery Registry: ${String(err)}` } };
  }
  if (resp.status >= 400) {
    return { error: { status: resp.status === 404 ? 404 : 502, detail: resp.status === 404 ? "" : `Smithery Registry 返回错误: ${resp.status}` } };
  }
  try {
    return { data: await resp.json() };
  } catch {
    return { error: { status: 502, detail: "无法连接 Smithery Registry: invalid JSON" } };
  }
}

// ── OAuth 授权端点辅助 ──

function buildAuthorizeUrl(authEndpoint: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${authEndpoint}?${qs}`;
}

// ── 路由装配 ──

export interface McpDeps {
  /** 活跃 kernel 会话（reload 遍历）。 */
  sessions: Map<string, PiSessionRecord>;
  callRpc: (method: string, params: Record<string, unknown>) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
}

export function createMcpRoutes(deps: McpDeps): Hono {
  const app = new Hono();

  /** 统一错误出口：McpHttpError → {detail:string}；ValidationError → {detail:[...]}。 */
  const fail = (c: Context, err: unknown) => {
    if (err instanceof McpHttpError) return c.json({ detail: err.detail }, err.status as 400);
    if (err instanceof McpYamlCorruptedError) {
      return c.json({ detail: "MCP 配置文件已损坏，为保护现有配置已拒绝写入，请检查 mcp_servers.yaml" }, 503);
    }
    if (err && typeof err === "object" && "detail" in err && Array.isArray((err as ValidationError).detail)) {
      return c.json(err as ValidationError, 422);
    }
    throw err;
  };

  const readBody = async (
    c: Context,
  ): Promise<{ kind: "object"; value: Record<string, unknown> } | { kind: "error"; error: ValidationError }> => {
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return {
        kind: "error",
        error: { detail: [{ type: "json_invalid", loc: ["body", 0], msg: "JSON decode error", input: {}, ctx: { error: "Expecting value" } }] },
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        kind: "error",
        error: { detail: [{ type: "model_attributes_type", loc: ["body"], msg: "Input should be a valid dictionary or object to extract fields from", input: parsed }] },
      };
    }
    return { kind: "object", value: parsed as Record<string, unknown> };
  };

  // GET /mcp/servers
  app.get("/api/mcp/servers", (c) => {
    const entries = loadRaw();
    const tools = collectMcpTools(deps);
    return c.json({ servers: entries.map((e) => redactSensitive(e)), tool_count: tools.length });
  });

  // GET /mcp/servers/{id}
  app.get("/api/mcp/servers/:serverId", (c) => {
    const target = findEntry(loadRaw(), c.req.param("serverId"));
    if (!target) return c.json({ detail: `MCP 服务器 '${c.req.param("serverId")}' 不存在` }, 404);
    return c.json(redactSensitive(target));
  });

  // GET /mcp/servers/{id}/tools
  app.get("/api/mcp/servers/:serverId/tools", (c) => {
    const serverId = c.req.param("serverId");
    const entry = findEntry(loadRaw(), serverId);
    if (!entry) return c.json({ detail: `MCP 服务器 '${serverId}' 不存在` }, 404);
    const serverName = String(entry.name ?? entry.server_id ?? serverId);
    return c.json({ server_id: serverId, tools: collectMcpTools(deps, serverName) });
  });

  // POST /mcp/servers
  app.post("/api/mcp/servers", async (c) => {
    const raw = await readBody(c);
    if (raw.kind !== "object") return c.json(raw.error, 422);
    const body = raw.value;
    try {
      const validated = validateCreateBody(body);
      if (!validated.ok) return c.json(validated.error, 422);
      const entries = loadRaw();
      if (findEntry(entries, String(validated.value.server_id))) {
        throw new McpHttpError(409, `server_id '${validated.value.server_id}' 已存在`);
      }
      const serverDict = buildServerDict(validated.value);
      entries.push(serverDict);
      saveRaw(entries);
      const result = reloadView(entries);
      return c.json({ ...result, status: "created", server: redactSensitive(serverDict) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // PUT /mcp/servers/{id}
  app.put("/api/mcp/servers/:serverId", async (c) => {
    const serverId = c.req.param("serverId");
    const raw = await readBody(c);
    if (raw.kind !== "object") return c.json(raw.error, 422);
    const body = raw.value;
    try {
      const validated = validateUpdateBody(body);
      if (!validated.ok) return c.json(validated.error, 422);
      const entries = loadRaw();
      const target = findEntry(entries, serverId);
      if (!target) throw new McpHttpError(404, `MCP 服务器 '${serverId}' 不存在`);
      const updateFields = validated.fields;
      validateUpdateAgainstTransport(target, updateFields);
      if ("env" in updateFields && updateFields.env !== null) {
        validateEnvVars(updateFields.env as Record<string, unknown>);
      }
      for (const [key, value] of Object.entries(updateFields)) {
        if ((key === "env" || key === "headers") && value && typeof value === "object" && !Array.isArray(value)) {
          target[key] = mergeRedactedMapping(target[key], value);
        } else {
          target[key] = value;
        }
      }
      saveRaw(entries);
      const result = reloadView(entries);
      return c.json({ ...result, status: "updated", server: redactSensitive(target) });
    } catch (err) {
      return fail(c, err);
    }
  });

  // DELETE /mcp/servers/{id}
  app.delete("/api/mcp/servers/:serverId", (c) => {
    const serverId = c.req.param("serverId");
    try {
      const entries = loadRaw();
      const newEntries = entries.filter((e) => e.server_id !== serverId);
      if (newEntries.length === entries.length) throw new McpHttpError(404, `MCP 服务器 '${serverId}' 不存在`);
      const removed = entries.find((e) => e.server_id === serverId)!;
      saveRaw(newEntries);
      const result = reloadView(newEntries);
      return c.json({ ...result, status: "deleted", removed: removed.server_id });
    } catch (err) {
      return fail(c, err);
    }
  });

  // GET /mcp/discovered：返回配置服务器与当前会话已发现的真实工具。
  app.get("/api/mcp/discovered", (c) => {
    const tools = collectMcpTools(deps);
    const entries = loadRaw();
    return c.json(entries.map((entry) => ({
      server_id: String(entry.server_id ?? ""),
      name: String(entry.name ?? entry.server_id ?? ""),
      transport: String(entry.transport ?? "unknown"),
      enabled: entry.enabled !== false,
      tool_count: tools.filter((tool) => String(tool.name).startsWith(`mcp__${String(entry.name ?? entry.server_id ?? "")}__`)).length,
    })));
  });

  // POST /mcp/reload
  app.post("/api/mcp/reload", async (c) => {
    const activeSessions = [...deps.sessions.keys()];
    if (activeSessions.length === 0) {
      return c.json({ status: "noop", detail: "没有活跃的会话需要刷新 MCP 配置", servers: [], tool_count: 0 });
    }
    let reloadedCount = 0;
    const errors: string[] = [];
    for (const sid of activeSessions) {
      try {
        const result = await deps.callRpc("reload_mcp_for_session", { session_id: sid });
        if (result.ok && (result.result as { status?: string }).status === "reloaded") reloadedCount += 1;
      } catch (err) {
        errors.push(`${sid.slice(0, 8)}: ${String(err)}`);
      }
    }
    const status = reloadedCount > 0 ? "reloaded" : "noop";
    return c.json({
      status,
      reloaded_sessions: reloadedCount,
      total_sessions: activeSessions.length,
      errors,
      servers: loadRaw().map((entry) => redactSensitive(entry)),
      tool_count: collectMcpTools(deps).length,
      ...(reloadedCount === 0 && errors.length === 0
        ? { detail: "pi 会话需要重建后才能应用 MCP 配置" }
        : {}),
    });
  });

  // ModelScope MCP marketplace (search/detail/import of published local server configs).
  app.get("/api/mcp/modelscope", async (c) => {
    const q = (c.req.query("q") ?? "").trim().slice(0, 160);
    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    try {
      const response = await fetch("https://www.modelscope.cn/openapi/v1/mcp/servers", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ search: q, page_number: page, page_size: 20 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return c.json({ detail: "魔搭 MCP 市场暂不可用（HTTP " + response.status + "）" }, 502);
      const payload = await response.json() as { success?: boolean; data?: { mcp_server_list?: Array<Record<string, unknown>>; total_count?: number } };
      if (!payload.success || !payload.data) return c.json({ detail: "魔搭 MCP 市场响应异常" }, 502);
      const servers = (payload.data.mcp_server_list ?? []).map((item) => {
        const locales = item.locales as Record<string, Record<string, unknown>> | undefined;
        const zh = locales?.zh ?? {};
        return {
          id: String(item.id ?? ""), name: String(item.chinese_name || zh.name || item.name || item.id || ""),
          description: String(zh.description || item.description || ""), author: String(item.publisher ?? item.author ?? ""),
          logo_url: String(item.logo_url ?? ""), view_count: Number(item.view_count ?? 0), categories: item.categories ?? [],
        };
      });
      return c.json({ servers, total: payload.data.total_count ?? servers.length, page, page_size: 20 });
    } catch (error) {
      return c.json({ detail: "魔搭 MCP 市场连接失败: " + (error instanceof Error ? error.message : String(error)) }, 502);
    }
  });

  app.get("/api/mcp/modelscope/*", async (c) => {
    let serverId = "";
    try { serverId = decodeURIComponent(c.req.path.split("/api/mcp/modelscope/")[1] ?? ""); } catch { return c.json({ detail: "无效的服务标识" }, 400); }
    if (!/^[A-Za-z0-9@][A-Za-z0-9._/@-]{0,239}$/.test(serverId) || serverId.includes("..")) return c.json({ detail: "无效的服务标识" }, 400);
    try {
      const response = await fetch("https://www.modelscope.cn/openapi/v1/mcp/servers/" + encodeURIComponent(serverId), { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return c.json({ detail: "魔搭 MCP 服务详情不可用（HTTP " + response.status + "）" }, response.status === 404 ? 404 : 502);
      const payload = await response.json() as { success?: boolean; data?: Record<string, unknown> };
      if (!payload.success || !payload.data) return c.json({ detail: "魔搭 MCP 服务详情响应异常" }, 502);
      const item = payload.data;
      const locales = item.locales as Record<string, Record<string, unknown>> | undefined;
      const zh = locales?.zh ?? {};
      return c.json({ id: String(item.id ?? serverId), name: String(item.chinese_name || zh.name || item.name || serverId), description: String(zh.description || item.description || ""), author: String(item.author ?? ""), source_url: String(item.source_url ?? ""), server_config: item.server_config ?? [], operational_urls: item.operational_urls ?? [], readme: String(item.readme ?? "") });
    } catch (error) {
      return c.json({ detail: "魔搭 MCP 服务详情获取失败: " + (error instanceof Error ? error.message : String(error)) }, 502);
    }
  });

  app.post("/api/mcp/modelscope/install", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const serverId = String(body.server_id ?? "").trim();
    if (!/^[A-Za-z0-9@][A-Za-z0-9._/@-]{0,239}$/.test(serverId) || serverId.includes("..")) return c.json({ detail: "无效的 server_id" }, 400);
    try {
      const response = await fetch("https://www.modelscope.cn/openapi/v1/mcp/servers/" + encodeURIComponent(serverId), { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new McpHttpError(response.status === 404 ? 404 : 502, "无法获取魔搭 MCP 服务配置");
      const payload = await response.json() as { success?: boolean; data?: Record<string, unknown> };
      const data = payload.data;
      if (!payload.success || !data) throw new McpHttpError(502, "魔搭 MCP 服务配置响应异常");
      const configs = Array.isArray(data.server_config) ? data.server_config as Array<Record<string, unknown>> : [];
      const configRoot = configs.find((config) => config.mcpServers && typeof config.mcpServers === "object")?.mcpServers as Record<string, Record<string, unknown>> | undefined;
      const first = configRoot ? Object.entries(configRoot)[0] : undefined;
      if (!first) throw new McpHttpError(422, "该服务没有可导入的本地 MCP 启动配置");
      const [publishedName, rawConfig] = first;
      const config = rawConfig as Record<string, unknown>;
      if (typeof config.command !== "string") throw new McpHttpError(422, "该服务提供的是托管连接，暂不支持直接导入本地启动配置");
      const serverName = serverId.replace(/^@/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
      if (!serverName) throw new McpHttpError(400, "无法从 server_id 生成本地服务名称");
      const command = validateStdioCommand(config.command);
      if (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every((arg) => typeof arg === "string"))) throw new McpHttpError(422, "该服务的 args 配置格式无效");
      const args = config.args === undefined ? [] : config.args as string[];
      const sourceEnv = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? config.env as Record<string, unknown> : {};
      const suppliedEnv = body.env && typeof body.env === "object" && !Array.isArray(body.env) ? body.env as Record<string, unknown> : {};
      if (Object.keys(suppliedEnv).some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof suppliedEnv[key] !== "string")) throw new McpHttpError(400, "环境变量格式无效");
      const unresolved = Object.entries(sourceEnv).filter(([key, value]) => typeof value === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value) && typeof suppliedEnv[key] !== "string");
      if (unresolved.length) throw new McpHttpError(422, "请先填写必需的环境变量: " + unresolved.map(([key]) => key).join(", "));
      const env = { ...Object.fromEntries(Object.entries(sourceEnv).map(([key, value]) => [key, typeof value === "string" ? value : String(value)])), ...suppliedEnv };
      if (Object.keys(env).length > 0) validateEnvVars(env);
      const entries = loadRaw();
      if (findEntry(entries, serverName)) throw new McpHttpError(409, "server_id 已存在：" + serverName);
      const server: Entry = { server_id: serverName, transport: "stdio", enabled: true, description: String(data.description ?? data.chinese_name ?? data.name ?? publishedName), command, args, ...(Object.keys(env).length ? { env } : {}) };
      entries.push(server);
      saveRaw(entries);
      const result = reloadView(entries);
      return c.json({ ...result, status: "installed", server: redactSensitive(server), marketplace_id: serverId });
    } catch (error) {
      return fail(c, error);
    }
  });

  // GET /mcp/registry
  app.get("/api/mcp/registry", async (c) => {
    const q = c.req.query("q") ?? "";
    const page = Number(c.req.query("page") ?? 1) || 1;
    const pageSize = Number(c.req.query("page_size") ?? 20) || 20;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) params.set("q", q);
    const r = await fetchRegistry(`${SMITHERY_REGISTRY_URL}?${params.toString()}`);
    if ("error" in r) return c.json({ detail: r.error.detail || `Smithery Registry 返回错误` }, r.error.status as 502);
    const data = r.data as Record<string, unknown>;
    const servers: unknown[] = [];
    const raw = (data.servers ?? data.results ?? []) as unknown[];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        servers.push({
          name: String(it.qualifiedName ?? it.name ?? ""),
          display_name: String(it.displayName ?? it.name ?? ""),
          description: String(it.description ?? ""),
          author: String(it.owner ?? it.author ?? ""),
          downloads: it.downloads ?? it.useCount ?? 0,
          icon_url: String(it.iconUrl ?? it.icon ?? ""),
          verified: Boolean(it.verified ?? false),
        });
      }
    }
    return c.json({
      servers,
      total: data.totalCount ?? data.total ?? servers.length,
      page,
      page_size: pageSize,
    });
  });

  // GET /mcp/registry/{name}（detail）——先于 install 注册无冲突（install 是 POST）
  app.get("/api/mcp/registry/*", async (c) => {
    const name = decodeURIComponent(c.req.path.split("/api/mcp/registry/")[1] ?? "");
    const r = await fetchRegistry(`${SMITHERY_REGISTRY_URL}/${name}`);
    if ("error" in r) {
      if (r.error.status === 404) return c.json({ detail: `Registry 中未找到 '${name}'` }, 404);
      return c.json({ detail: r.error.detail }, r.error.status as 502);
    }
    const data = r.data as Record<string, unknown>;
    return c.json({
      name: String(data.qualifiedName ?? data.name ?? name),
      display_name: String(data.displayName ?? data.name ?? name),
      description: String(data.description ?? ""),
      author: String(data.owner ?? data.author ?? ""),
      downloads: data.downloads ?? data.useCount ?? 0,
      icon_url: String(data.iconUrl ?? data.icon ?? ""),
      verified: Boolean(data.verified ?? false),
      readme: String(data.readme ?? ""),
      config: data.config ?? {},
      connection: data.connection ?? {},
    });
  });

  // POST /mcp/registry/install
  app.post("/api/mcp/registry/install", async (c) => {
    const raw = await readBody(c);
    if (raw.kind !== "object") return c.json(raw.error, 422);
    const body = raw.value;
    const name = String(body.name ?? "");
    if (!name) return c.json({ detail: "name 不能为空" }, 400);
    try {
      const r = await fetchRegistry(`${SMITHERY_REGISTRY_URL}/${name}`);
      if ("error" in r) {
        if (r.error.status === 404) throw new McpHttpError(404, `Registry 中未找到 '${name}'`);
        throw new McpHttpError(r.error.status, r.error.detail);
      }
      const data = r.data as Record<string, unknown>;
      const serverId = String(
        body.server_id ?? String(data.qualifiedName ?? name).replace(/\//g, "-").replace(/@/g, ""),
      );
      const connection = (data.connection ?? {}) as Record<string, unknown>;
      const configOverride = (body.config ?? {}) as Record<string, unknown>;

      let serverDict: Entry;
      let transport: string;
      if (connection.type === "http" || connection.url) {
        transport = "streamable_http";
        serverDict = {
          server_id: serverId,
          transport,
          enabled: true,
          description: String(data.description ?? `Installed from Smithery: ${name}`),
          url: String(configOverride.url ?? connection.url ?? ""),
          tls_verify: true,
        };
        if (connection.headers) serverDict.headers = connection.headers;
      } else {
        transport = "stdio";
        let args = (configOverride.args ?? connection.args ?? []) as unknown;
        if (Array.isArray(args) && args.length === 0 && name) args = ["-y", `@smithery/${name}`];
        serverDict = {
          server_id: serverId,
          transport,
          enabled: true,
          description: String(data.description ?? `Installed from Smithery: ${name}`),
          command: String(configOverride.command ?? connection.command ?? "npx"),
          args: Array.isArray(args) ? args.map(String) : [],
        };
        const env = configOverride.env ?? connection.env;
        if (env && typeof env === "object" && !Array.isArray(env) && Object.keys(env).length > 0) serverDict.env = env;
      }

      // REGISTRY-VALIDATE-001：与 create/update 等价校验
      if (transport === "stdio") {
        try {
          serverDict.command = validateStdioCommand(String(serverDict.command ?? ""));
        } catch (e) {
          if (e instanceof McpHttpError) throw new McpHttpError(400, `Registry 命令校验失败: ${e.detail}`);
          throw e;
        }
      }
      if (serverDict.env && typeof serverDict.env === "object") {
        try {
          validateEnvVars(serverDict.env as Record<string, unknown>);
        } catch (e) {
          if (e instanceof McpHttpError) throw new McpHttpError(400, `Registry env 校验失败: ${e.detail}`);
          throw e;
        }
      }

      const entries = loadRaw();
      if (findEntry(entries, serverId)) {
        throw new McpHttpError(409, `server_id '${serverId}' 已存在，请使用其他名称或先删除已有配置`);
      }
      entries.push(serverDict);
      saveRaw(entries);
      const result = reloadView(entries);
      return c.json({ ...result, status: "installed", server: redactSensitive(serverDict), registry_name: name });
    } catch (err) {
      return fail(c, err);
    }
  });

  // POST /mcp/oauth/authorize
  app.post("/api/mcp/oauth/authorize", async (c) => {
    const raw = await readBody(c);
    if (raw.kind !== "object") return c.json(raw.error, 422);
    const body = raw.value;
    const serverName = String(body.server_name ?? "");
    if (!serverName) return c.json({ detail: "server_name 不能为空" }, 400);

    const state = newOauthState();
    const defaultRedirect = `${new URL(c.req.url).origin}/api/mcp/oauth/callback`;
    const redirectUri = String(body.redirect_uri ?? "") || defaultRedirect;
    let authEndpoint = String(body.auth_endpoint ?? "");
    if (!authEndpoint) {
      try {
        const r = await fetchRegistry(`${SMITHERY_REGISTRY_URL}/${serverName}`);
        if (!("error" in r)) {
          const data = r.data as Record<string, unknown>;
          const oauthConfig = (data.oauth ?? data.auth ?? {}) as Record<string, unknown>;
          authEndpoint = String(oauthConfig.authorization_url ?? oauthConfig.authorize_url ?? "");
        }
      } catch {
        /* 静默降级 */
      }
    }
    if (!authEndpoint) authEndpoint = "https://auth.smithery.ai/authorize";

    const clientId = String(body.client_id ?? "") || "maxma-desktop";
    oauthPendingStates.set(state, {
      server_name: serverName,
      redirect_uri: redirectUri,
      client_id: clientId,
      created_at: Date.now() / 1000,
    });
    // 清理过期 state（>10 分钟）
    const now = Date.now() / 1000;
    for (const [k, v] of oauthPendingStates) {
      if (now - v.created_at > 600) oauthPendingStates.delete(k);
    }

    const params: Record<string, string> = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      server: serverName,
    };
    if (body.scope) params.scope = String(body.scope);

    return c.json({ auth_url: buildAuthorizeUrl(authEndpoint, params), state, server_name: serverName });
  });

  // POST /mcp/oauth/callback
  app.post("/api/mcp/oauth/callback", async (c) => {
    const raw = await readBody(c);
    if (raw.kind !== "object") return c.json(raw.error, 422);
    const body = raw.value;
    try {
      const result = await exchangeOauthCode(
        String(body.code ?? ""),
        String(body.state ?? ""),
        body.server_name ? String(body.server_name) : null,
      );
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  // GET /mcp/oauth/callback（浏览器重定向，白名单免鉴权）
  app.get("/api/mcp/oauth/callback", async (c) => {
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "";
    const serverName = c.req.query("server_name") ?? null;
    let message: string;
    let ok: boolean;
    try {
      await exchangeOauthCode(code, state, serverName);
      message = "授权成功，请关闭此窗口返回应用。";
      ok = true;
    } catch (err) {
      if (err instanceof McpHttpError) {
        message = `授权失败：${err.detail}`;
        ok = false;
      } else {
        message = `授权失败：${String(err)}`;
        ok = false;
      }
    }
    const color = ok ? "#22c55e" : "#ef4444";
    const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>MCP OAuth</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f0f0f;color:#e5e5e5">
<div style="text-align:center">
<div style="font-size:48px;color:${color}">${ok ? "✓" : "✕"}</div>
<p style="font-size:16px">${message}</p>
</div>
<script>setTimeout(function(){window.close()},2500)</script>
</body></html>`;
    return new Response(html, {
      status: ok ? 200 : 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  // GET /mcp/oauth/status/{server_name}
  app.get("/api/mcp/oauth/status/*", (c) => {
    const serverName = decodeURIComponent(c.req.path.split("/api/mcp/oauth/status/")[1] ?? "");
    const tokens = loadOauthTokens();
    const tokenInfo = tokens[serverName];
    if (!tokenInfo) {
      return c.json({ server_name: serverName, authorized: false, status: "not_authorized" });
    }
    const expiresAt = Number(tokenInfo.expires_at ?? 0);
    const isExpired = Date.now() / 1000 > expiresAt;
    const hasRefresh = Boolean(tokenInfo.refresh_token);
    if (isExpired && !hasRefresh) {
      return c.json({
        server_name: serverName,
        authorized: false,
        status: "expired",
        authorized_at: tokenInfo.authorized_at ?? null,
      });
    }
    return c.json({
      server_name: serverName,
      authorized: true,
      status: isExpired ? "expired" : "active",
      token_type: tokenInfo.token_type ?? "Bearer",
      scope: tokenInfo.scope ?? "",
      authorized_at: tokenInfo.authorized_at ?? null,
      expires_at: expiresAt,
      has_refresh_token: hasRefresh,
    });
  });

  return app;
}
