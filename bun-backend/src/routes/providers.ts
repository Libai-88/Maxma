/**
 * routes/providers.ts — Provider 管理（api/routes/providers.py 的 Bun 直译，
 * 阶段二 2.4）。
 *
 * 存储：providers.yaml（`providers: [...]`，与 Python 同文件同格式）。
 * api_key 加密：Fernet 兼容信封（src/security/credential-envelope.ts，
 * 向量测试锁定互操作）——Python 侧旧凭据可直接解密使用。
 *
 * 契约对齐：
 * - URL 校验（scheme/凭据/query/fragment/端口/IDNA/元数据地址黑名单）
 *   逐分支直译 _validate_provider_base_url
 * - 校验失败 422 {detail:[{loc,msg,type}]}（Pydantic 错误形状）
 * - 3s TTL 列表缓存 + 写失效（PERF-PROVIDERS-CACHE-001）
 * - PROVIDERS-CORRUPT-001：损坏文件拒绝覆盖写（503）
 * - 11 端点：list/create/get/update/delete/test/discover-models/
 *   {id}/test/{id}/discover-models/encrypt-keys/opencode-zen/sync-models
 */

import { Hono } from "hono";
import * as fs from "node:fs";

import { getProvidersYamlPath, getCredentialKeyPath } from "../app-paths";
import {
  decryptApiKey,
  encryptApiKey,
  isCredentialEnvelope,
  isLegacyEncrypted,
} from "../security/credential-envelope";
import { BunYamlSafeParse, writeYamlAtomic } from "../yaml-store";
import { ensureOpencodeZenProvider, syncOpencodeZenModels } from "../services/opencode-zen";

export type ProviderEntry = Record<string, unknown>;

// ── YAML 读写（含 TTL 缓存与损坏保护）──

type CacheEntry = { path: string; at: number; data: ProviderEntry[] };
let providersCache: CacheEntry | null = null;
const PROVIDERS_CACHE_TTL = 3; // 秒

export function providersYamlPath(): string {
  return getProvidersYamlPath();
}

/** 读取 providers 列表；文件不存在/为空/解析失败 → []（load_yaml 同语义）。 */
export function loadProviders(): ProviderEntry[] {
  const now = Date.now() / 1000;
  const cacheKey = providersYamlPath();
  if (providersCache && providersCache.path === cacheKey && now - providersCache.at < PROVIDERS_CACHE_TTL) {
    return providersCache.data;
  }
  const file = cacheKey;
  let result: ProviderEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      const raw = BunYamlSafeParse(fs.readFileSync(file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const items = (raw as Record<string, unknown>).providers;
        if (Array.isArray(items)) result = items.filter((e): e is ProviderEntry => !!e && typeof e === "object" && !Array.isArray(e));
      }
    } catch {
      result = [];
    }
  }
  providersCache = { path: cacheKey, at: now, data: result };
  return result;
}

/** 原子写；文件存在但解析失败 → 抛 CorruptedError（PROVIDERS-CORRUPT-001）。 */
export class YamlCorruptedError extends Error {}

export function saveProviders(items: ProviderEntry[]): void {
  const file = providersYamlPath();
  if (fs.existsSync(file)) {
    try {
      const parsed = Bun.YAML.parse(fs.readFileSync(file, "utf8"));
      if (parsed === null || parsed === undefined || typeof parsed !== "object") {
        // 空文档/标量按 Python load_yaml_strict 语义可继续（default=None 不抛）
      }
    } catch (exc) {
      throw new YamlCorruptedError(`YAML 解析失败: ${file}: ${String(exc)}`);
    }
  }
  writeYamlAtomic(file, { providers: items });
  providersCache = null;
}

export function findProvider(items: ProviderEntry[], providerId: string): ProviderEntry | null {
  for (const entry of items) {
    if (entry.id === providerId) return entry;
  }
  return null;
}

/** 加密明文 key（已加密/空值跳过；create/update 路径共用）。 */
export function encryptApiKeyIfNeeded(value: string): string {
  if (value && !isCredentialEnvelope(value) && !isLegacyEncrypted(value)) {
    return encryptApiKey(value, getCredentialKeyPath());
  }
  return value;
}

export function decryptProviderKey(value: unknown): string {
  return decryptApiKey(value, getCredentialKeyPath());
}

// ── URL 校验（_validate_provider_base_url 直译）──

const ALLOWED_SCHEMES = new Set(["http", "https"]);
const BLOCKED_METADATA_HOSTS = new Set([
  "100.100.100.200",
  "169.254.169.254",
  "169.254.170.2",
  "fd00:ec2::254",
  "instance-data.ec2.internal",
  "metadata",
  "metadata.azure.com",
  "metadata.google.com",
  "metadata.google.internal",
]);

class InvalidProviderUrl extends Error {
  constructor() {
    super("base_url must be an absolute HTTP(S) URL");
  }
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

function parseIp(host: string): { kind: "v4" | "v6"; octets?: number[] } | null {
  const v4 = IPV4_RE.exec(host);
  if (v4) {
    const octets = v4.slice(1, 5).map(Number);
    if (octets.every((n) => n <= 255)) return { kind: "v4", octets };
    return null;
  }
  if (host.includes(":") && IPV6_RE.test(host) && !host.includes("%")) {
    return { kind: "v6" };
  }
  return null;
}

function isMetadataHost(hostname: string): boolean {
  const host = hostname.replace(/\.+$/, "").toLowerCase();
  if (BLOCKED_METADATA_HOSTS.has(host)) return true;
  if (host.endsWith(".metadata.google.internal") || host.endsWith(".instance-data.ec2.internal")) return true;
  const ip = parseIp(host);
  if (ip === null) {
    // 十进制 IPv4 整数形式（部分 URL 客户端接受）
    if (/^\d+$/.test(host)) {
      try {
        const n = Number(host);
        if (Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) {
          const dotted = `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
          return BLOCKED_METADATA_HOSTS.has(dotted);
        }
      } catch {
        return false;
      }
      return false;
    }
    return false;
  }
  return BLOCKED_METADATA_HOSTS.has(host);
}

export function validateProviderBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== "string" || !baseUrl) throw new InvalidProviderUrl();
  for (const ch of baseUrl) {
    const code = ch.codePointAt(0)!;
    if (/\s/.test(ch) || code < 0x20 || code === 0x7f) throw new InvalidProviderUrl();
  }
  if (baseUrl.includes("\\")) throw new InvalidProviderUrl();

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new InvalidProviderUrl();
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  const hostname = parsed.hostname; // 已小写、去方括号
  if (!ALLOWED_SCHEMES.has(scheme) || !hostname) throw new InvalidProviderUrl();
  if (parsed.username !== "" || parsed.password !== "") throw new InvalidProviderUrl();
  if (parsed.search !== "" || parsed.hash !== "") throw new InvalidProviderUrl();
  if (parsed.port !== "") {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InvalidProviderUrl();
  }
  // IDNA 校验（WHATWG URL 已做 punycode；非法域 new URL 已抛）
  if (isMetadataHost(hostname)) throw new InvalidProviderUrl();
  const ip = parseIp(hostname);
  if (ip?.kind === "v4" && ip.octets) {
    const [a, b, c, d] = ip.octets;
    const unspecified = a === 0 && b === 0 && c === 0 && d === 0;
    const multicast = a >= 224 && a <= 239;
    if (unspecified || multicast) throw new InvalidProviderUrl();
  } else if (ip?.kind === "v6") {
    const h = hostname.toLowerCase();
    if (h === "::" || h === "0:0:0:0:0:0:0:0") throw new InvalidProviderUrl();
    if (h.startsWith("ff")) throw new InvalidProviderUrl(); // 组播 ff00::/12
  }
  return baseUrl;
}

// ── Pydantic 等价校验（422 形状逐字段对齐 FastAPI RequestValidationError：
// key 顺序 type/loc/msg/input/ctx，input 为整 body（missing）或字段值）──

type DetailEntry = Record<string, unknown>;

interface ValidationError {
  detail: DetailEntry[];
}

function missingFieldError(field: string, body: unknown): ValidationError {
  return { detail: [{ type: "missing", loc: ["body", field], msg: "Field required", input: body }] };
}

function stringTooShortError(field: string, value: unknown): ValidationError {
  return {
    detail: [
      {
        type: "string_too_short",
        loc: ["body", field],
        msg: "String should have at least 1 character",
        input: value,
        ctx: { min_length: 1 },
      },
    ],
  };
}

function stringTypeError(field: string, value: unknown): ValidationError {
  return {
    detail: [{ type: "string_type", loc: ["body", field], msg: "Input should be a valid string", input: value }],
  };
}

function urlValidationError(field: string, value: unknown): ValidationError {
  return {
    detail: [
      {
        type: "value_error",
        loc: ["body", field],
        msg: "Value error, base_url must be an absolute HTTP(S) URL",
        input: value,
        ctx: { error: {} },
      },
    ],
  };
}

function nonDictBodyError(value: unknown): ValidationError {
  return {
    detail: [
      {
        type: "model_attributes_type",
        loc: ["body"],
        msg: "Input should be a valid dictionary or object to extract fields from",
        input: value,
      },
    ],
  };
}

interface CreateBody {
  id: string;
  provider_type: string;
  label: string;
  api_key: string;
  base_url: string;
  models: string[];
  enabled: boolean;
  context_window: number | null;
  max_tokens: number | null;
  temperature: number | null;
  top_p: number | null;
  timeout: number | null;
  extra_headers: Record<string, unknown> | null;
}

// Pydantic v2 lax 模式标量强转（对齐 Python 可观测行为：前端发正确类型，
// 但直连 API 的边缘 payload 需同语义，保证双跑零差异）
function coerceBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "on", "yes", "y", "t"].includes(s)) return true;
    if (["false", "0", "off", "no", "n", "f"].includes(s)) return false;
    return null;
  }
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  return null;
}

function coerceInt(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null; // float 带小数 → 拒绝
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

function coerceFloat(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function intTypeError(field: string, value: unknown): ValidationError {
  return {
    detail: [{ type: "int_type", loc: ["body", field], msg: "Input should be a valid integer", input: value }],
  };
}

function floatTypeError(field: string, value: unknown): ValidationError {
  return {
    detail: [{ type: "float_type", loc: ["body", field], msg: "Input should be a valid number", input: value }],
  };
}

function boolTypeError(field: string, value: unknown): ValidationError {
  return {
    detail: [{ type: "bool_parsing", loc: ["body", field], msg: "Input should be a valid boolean, unable to interpret input", input: value }],
  };
}

function listTypeError(field: string, value: unknown): ValidationError {
  return {
    detail: [{ type: "list_type", loc: ["body", field], msg: "Input should be a valid list", input: value }],
  };
}

/** 可选 int 字段：未提供/None → null；否则 lax 强转（非法 → 错误）。 */
function optInt(
  body: Record<string, unknown>,
  field: string,
  errors: DetailEntry[],
): number | null {
  if (!(field in body) || body[field] === null) return null;
  const n = coerceInt(body[field]);
  if (n === null) {
    errors.push(intTypeError(field, body[field]).detail[0]!);
    return null;
  }
  return n;
}

function optFloat(
  body: Record<string, unknown>,
  field: string,
  errors: DetailEntry[],
): number | null {
  if (!(field in body) || body[field] === null) return null;
  const n = coerceFloat(body[field]);
  if (n === null) {
    errors.push(floatTypeError(field, body[field]).detail[0]!);
    return null;
  }
  return n;
}

/** ProviderCreateBody 校验（必填 id/label(min1)/base_url；其余默认）。 */
function validateCreate(body: Record<string, unknown>): { ok: true; value: CreateBody } | { ok: false; error: ValidationError } {
  const detail: DetailEntry[] = [];
  // id: str 必填 min_length=1
  if (body.id === undefined) detail.push(missingFieldError("id", body).detail[0]!);
  else if (typeof body.id !== "string") detail.push(stringTypeError("id", body.id).detail[0]!);
  else if (body.id.length < 1) detail.push(stringTooShortError("id", body.id).detail[0]!);
  // label: str 必填 min_length=1
  if (body.label === undefined) detail.push(missingFieldError("label", body).detail[0]!);
  else if (typeof body.label !== "string") detail.push(stringTypeError("label", body.label).detail[0]!);
  else if (body.label.length < 1) detail.push(stringTooShortError("label", body.label).detail[0]!);
  // base_url: str 必填 min_length=1 + field_validator
  if (body.base_url === undefined) detail.push(missingFieldError("base_url", body).detail[0]!);
  else if (typeof body.base_url !== "string") detail.push(stringTypeError("base_url", body.base_url).detail[0]!);
  else if (body.base_url.length < 1) detail.push(stringTooShortError("base_url", body.base_url).detail[0]!);
  else {
    try {
      validateProviderBaseUrl(body.base_url);
    } catch {
      detail.push(urlValidationError("base_url", body.base_url).detail[0]!);
    }
  }
  // models: list[str] 默认 []
  if ("models" in body && body.models !== null && body.models !== undefined && !Array.isArray(body.models)) {
    detail.push(listTypeError("models", body.models).detail[0]!);
  }
  // provider_type / api_key: str（默认值补齐）
  for (const key of ["provider_type", "api_key"] as const) {
    if (key in body && body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") {
      detail.push(stringTypeError(key, body[key]).detail[0]!);
    }
  }
  // extra_headers: dict | None
  if (
    "extra_headers" in body &&
    body.extra_headers !== null &&
    body.extra_headers !== undefined &&
    (typeof body.extra_headers !== "object" || Array.isArray(body.extra_headers))
  ) {
    detail.push({
      type: "dict_type",
      loc: ["body", "extra_headers"],
      msg: "Input should be a valid dictionary",
      input: body.extra_headers,
    });
  }
  // enabled: bool 默认 True（lax 强转）
  let enabled = true;
  if ("enabled" in body && body.enabled !== undefined && body.enabled !== null) {
    const b = coerceBool(body.enabled);
    if (b === null) detail.push(boolTypeError("enabled", body.enabled).detail[0]!);
    else enabled = b;
  }
  // 可选数值字段（context_window/max_tokens/timeout int；temperature/top_p float）
  const contextWindow = optInt(body, "context_window", detail);
  const maxTokens = optInt(body, "max_tokens", detail);
  const timeout = optInt(body, "timeout", detail);
  const temperature = optFloat(body, "temperature", detail);
  const topP = optFloat(body, "top_p", detail);

  if (detail.length > 0) return { ok: false, error: { detail } };

  const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
  const models = Array.isArray(body.models) ? body.models.map((m) => String(m)) : [];
  return {
    ok: true,
    value: {
      id: body.id as string,
      provider_type: str(body.provider_type, "openai"),
      label: body.label as string,
      api_key: str(body.api_key, ""),
      base_url: body.base_url as string,
      models,
      enabled,
      context_window: contextWindow,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      timeout,
      extra_headers:
        body.extra_headers && typeof body.extra_headers === "object" && !Array.isArray(body.extra_headers)
          ? (body.extra_headers as Record<string, unknown>)
          : null,
    },
  };
}

/** ProviderUpdateBody：全部可选；返回 exclude_unset 语义的更新字段集（含 lax 强转）。 */
function validateUpdate(body: Record<string, unknown>): { ok: true; fields: Record<string, unknown> } | { ok: false; error: ValidationError } {
  const fields: Record<string, unknown> = {};
  const detail: DetailEntry[] = [];
  const strOrNull = (v: unknown): boolean => v === null || typeof v === "string";
  const dictOrNull = (v: unknown): boolean =>
    v === null || (typeof v === "object" && !Array.isArray(v));

  for (const key of ["provider_type", "label", "api_key"] as const) {
    if (key in body) {
      if (!strOrNull(body[key])) detail.push(stringTypeError(key, body[key]).detail[0]!);
      else fields[key] = body[key];
    }
  }
  if ("base_url" in body) {
    const v = body.base_url;
    if (v === null || v === undefined) {
      // str | None：null 合法（validator 返回 None）
      fields.base_url = v;
    } else if (typeof v !== "string") {
      detail.push(stringTypeError("base_url", v).detail[0]!);
    } else {
      try {
        validateProviderBaseUrl(v);
        fields.base_url = v;
      } catch {
        detail.push(urlValidationError("base_url", v).detail[0]!);
      }
    }
  }
  if ("models" in body) {
    const v = body.models;
    if (v === null || Array.isArray(v)) fields.models = Array.isArray(v) ? v.map((m) => String(m)) : null;
    else detail.push(listTypeError("models", v).detail[0]!);
  }
  if ("enabled" in body) {
    const v = body.enabled;
    if (v === null) fields.enabled = null;
    else {
      const b = coerceBool(v);
      if (b === null) detail.push(boolTypeError("enabled", v).detail[0]!);
      else fields.enabled = b;
    }
  }
  for (const key of ["context_window", "max_tokens", "timeout"] as const) {
    if (key in body) {
      const v = body[key];
      if (v === null) fields[key] = null;
      else {
        const n = coerceInt(v);
        if (n === null) detail.push(intTypeError(key, v).detail[0]!);
        else fields[key] = n;
      }
    }
  }
  for (const key of ["temperature", "top_p"] as const) {
    if (key in body) {
      const v = body[key];
      if (v === null) fields[key] = null;
      else {
        const n = coerceFloat(v);
        if (n === null) detail.push(floatTypeError(key, v).detail[0]!);
        else fields[key] = n;
      }
    }
  }
  if ("extra_headers" in body) {
    const v = body.extra_headers;
    if (dictOrNull(v)) fields.extra_headers = v;
    else
      detail.push({
        type: "dict_type",
        loc: ["body", "extra_headers"],
        msg: "Input should be a valid dictionary",
        input: v,
      });
  }
  if (detail.length > 0) return { ok: false, error: { detail } };
  return { ok: true, fields };
}

// ── HTTP 连接测试 / 模型发现（_http_get_models 直译，httpx→fetch）──

const HTTP_TIMEOUT = 10_000;

export interface ModelsProbeResult {
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
  models: string[];
}

export async function httpGetModels(baseUrl: string, apiKey: string): Promise<ModelsProbeResult> {
  let validated: string;
  try {
    validated = validateProviderBaseUrl(baseUrl);
  } catch {
    return { ok: false, latencyMs: null, detail: "提供商地址无效", models: [] };
  }
  const url = validated.replace(/\/+$/, "") + "/models";
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const start = performance.now();
  let resp: Response;
  try {
    resp = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(HTTP_TIMEOUT) });
  } catch (e) {
    return { ok: false, latencyMs: null, detail: `网络请求失败：${String(e)}`, models: [] };
  }
  const latencyMs = Math.floor((performance.now() - start) * 1000); // int() 截断，同 Python
  if (resp.status >= 300) {
    return { ok: false, latencyMs, detail: `服务器返回 HTTP ${resp.status}`, models: [] };
  }
  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return { ok: true, latencyMs, detail: null, models: [] };
  }
  const models: string[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const items = (data as Record<string, unknown>).data;
    if (Array.isArray(items)) {
      for (const m of items) {
        if (m && typeof m === "object" && !Array.isArray(m) && (m as Record<string, unknown>).id !== undefined) {
          models.push(String((m as Record<string, unknown>).id));
        }
      }
    }
  }
  return { ok: true, latencyMs, detail: null, models };
}

// ── 加密迁移（migrate_plaintext_keys_to_encrypted，幂等）──

export function migratePlaintextKeysToEncrypted(): number {
  const items = loadProviders();
  let encryptedCount = 0;
  for (const entry of items) {
    const value = entry.api_key;
    if (typeof value !== "string" || !value) continue;
    if (isCredentialEnvelope(value) || isLegacyEncrypted(value)) continue;
    entry.api_key = encryptApiKey(value, getCredentialKeyPath());
    encryptedCount += 1;
  }
  if (encryptedCount > 0) saveProviders(items);
  return encryptedCount;
}

/** 损坏文件 → 503 响应（PROVIDERS-CORRUPT-001）。 */
function corruptResponse(c: import("hono").Context) {
  return c.json(
    { detail: "Provider 配置文件已损坏，为保护现有配置已拒绝写入，请检查 providers.yaml" },
    503,
  );
}

// ── JSON body 读取（对齐 FastAPI RequestValidationError 的 body 层错误）──

type BodyResult =
  | { kind: "object"; value: Record<string, unknown> }
  | { kind: "error"; error: ValidationError };

/** 解析请求体：非法 JSON / 非对象（数组/标量/null）→ 422 形状错误。 */
async function readJsonBody(c: import("hono").Context): Promise<BodyResult> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return {
      kind: "error",
      error: {
        detail: [
          {
            type: "json_invalid",
            loc: ["body", 0],
            msg: "JSON decode error",
            input: {},
            ctx: { error: "Expecting value" },
          },
        ],
      },
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "error", error: nonDictBodyError(parsed) };
  }
  return { kind: "object", value: parsed as Record<string, unknown> };
}

function jsonError(c: import("hono").Context, result: Extract<BodyResult, { kind: "error" }>) {
  return c.json(result.error, 422);
}

/** TestConnectionBody/DiscoverModelsBody 的 base_url 校验（必填 min1 + validator）。 */
function validateTestBody(body: Record<string, unknown>): ValidationError | null {
  if (body.base_url === undefined) return missingFieldError("base_url", body);
  if (typeof body.base_url !== "string") return stringTypeError("base_url", body.base_url);
  if (body.base_url.length < 1) return stringTooShortError("base_url", body.base_url);
  try {
    validateProviderBaseUrl(body.base_url);
  } catch {
    return urlValidationError("base_url", body.base_url);
  }
  return null;
}

// ── 路由装配 ──

export function createProvidersRoutes(): Hono {
  const app = new Hono();

  // 端点 1: GET /providers
  app.get("/api/providers", async (c) => {
    try {
      ensureOpencodeZenProvider();
    } catch (err) {
      console.warn(`[providers] builtin opencode-zen injection failed (non-fatal): ${String(err)}`);
    }
    return c.json({ providers: loadProviders() });
  });

  // 端点 2: POST /providers
  app.post("/api/providers", async (c) => {
    const raw = await readJsonBody(c);
    if (raw.kind !== "object") return jsonError(c, raw);
    const validated = validateCreate(raw.value);
    if (!validated.ok) return c.json(validated.error, 422);
    const b = validated.value;
    const items = loadProviders();
    if (findProvider(items, b.id) !== null) {
      return c.json({ detail: `provider id '${b.id}' 已存在` }, 409);
    }
    const provider: ProviderEntry = {
      id: b.id,
      provider_type: b.provider_type,
      label: b.label,
      api_key: encryptApiKeyIfNeeded(b.api_key),
      base_url: b.base_url,
      models: [...b.models],
      enabled: b.enabled,
    };
    if (b.context_window !== null) provider.context_window = b.context_window;
    items.push(provider);
    try {
      saveProviders(items);
    } catch (err) {
      if (err instanceof YamlCorruptedError) return corruptResponse(c);
      throw err;
    }
    return c.json(provider);
  });

  // 端点 6: POST /providers/test（先于 /:id 注册，避免参数路由抢匹配）
  app.post("/api/providers/test", async (c) => {
    const raw = await readJsonBody(c);
    if (raw.kind !== "object") return jsonError(c, raw);
    const urlErr = validateTestBody(raw.value);
    if (urlErr) return c.json(urlErr, 422);
    const body = raw.value;
    const apiKey = typeof body.api_key === "string" ? body.api_key : "";
    const r = await httpGetModels(String(body.base_url), apiKey);
    return c.json({ status: r.ok ? "ok" : "error", latency_ms: r.latencyMs, detail: r.detail });
  });

  // 端点 7: POST /providers/discover-models
  app.post("/api/providers/discover-models", async (c) => {
    const raw = await readJsonBody(c);
    if (raw.kind !== "object") return jsonError(c, raw);
    const urlErr = validateTestBody(raw.value);
    if (urlErr) return c.json(urlErr, 422);
    const body = raw.value;
    const apiKey = typeof body.api_key === "string" ? body.api_key : "";
    const r = await httpGetModels(String(body.base_url), apiKey);
    return c.json({ models: r.models });
  });

  // 端点 10: POST /providers/encrypt-keys
  app.post("/api/providers/encrypt-keys", (c) => {
    const n = migratePlaintextKeysToEncrypted();
    return c.json({ status: "ok", encrypted: n });
  });

  // 端点 11: POST /providers/opencode-zen/sync-models
  app.post("/api/providers/opencode-zen/sync-models", async (c) => {
    try {
      const result = await syncOpencodeZenModels();
      return c.json({
        status: result.synced ? "ok" : "error",
        synced: result.synced,
        models: result.models,
      });
    } catch (err) {
      return c.json({ status: "error", synced: false, detail: String(err) });
    }
  });

  // 端点 3: GET /providers/{id}
  app.get("/api/providers/:providerId", (c) => {
    const target = findProvider(loadProviders(), c.req.param("providerId"));
    if (!target) return c.json({ detail: `provider '${c.req.param("providerId")}' 不存在` }, 404);
    return c.json(target);
  });

  // 端点 4: PUT /providers/{id}
  app.put("/api/providers/:providerId", async (c) => {
    const providerId = c.req.param("providerId");
    const raw = await readJsonBody(c);
    if (raw.kind !== "object") return jsonError(c, raw);
    // FastAPI 先校验 body（422）再进 handler（404）——顺序对齐
    const validated = validateUpdate(raw.value);
    if (!validated.ok) return c.json(validated.error, 422);
    const items = loadProviders();
    const target = findProvider(items, providerId);
    if (!target) return c.json({ detail: `provider '${providerId}' 不存在` }, 404);
    const updateFields = validated.fields;
    if ("api_key" in updateFields) {
      const val = updateFields.api_key;
      if (typeof val === "string") updateFields.api_key = encryptApiKeyIfNeeded(val);
    }
    for (const [key, value] of Object.entries(updateFields)) target[key] = value;
    try {
      saveProviders(items);
    } catch (err) {
      if (err instanceof YamlCorruptedError) return corruptResponse(c);
      throw err;
    }
    return c.json(target);
  });

  // 端点 5: DELETE /providers/{id}
  app.delete("/api/providers/:providerId", (c) => {
    const providerId = c.req.param("providerId");
    const items = loadProviders();
    if (findProvider(items, providerId) === null) {
      return c.json({ detail: `provider '${providerId}' 不存在` }, 404);
    }
    const newItems = items.filter((e) => e.id !== providerId);
    try {
      saveProviders(newItems);
    } catch (err) {
      if (err instanceof YamlCorruptedError) return corruptResponse(c);
      throw err;
    }
    return c.json({ status: "ok" });
  });

  // 端点 8: POST /providers/{id}/test
  app.post("/api/providers/:providerId/test", async (c) => {
    const providerId = c.req.param("providerId");
    const target = findProvider(loadProviders(), providerId);
    if (!target) return c.json({ detail: `provider '${providerId}' 不存在` }, 404);
    const r = await httpGetModels(String(target.base_url ?? ""), decryptProviderKey(target.api_key));
    return c.json({ status: r.ok ? "ok" : "error", latency_ms: r.latencyMs, detail: r.detail });
  });

  // 端点 9: POST /providers/{id}/discover-models
  app.post("/api/providers/:providerId/discover-models", async (c) => {
    const providerId = c.req.param("providerId");
    const target = findProvider(loadProviders(), providerId);
    if (!target) return c.json({ detail: `provider '${providerId}' 不存在` }, 404);
    const r = await httpGetModels(String(target.base_url ?? ""), decryptProviderKey(target.api_key));
    return c.json({ models: r.models });
  });

  // 端点补充: POST /providers/{id}/health（Python 端点 12）
  app.post("/api/providers/:providerId/health", async (c) => {
    const providerId = c.req.param("providerId");
    const target = findProvider(loadProviders(), providerId);
    if (!target) return c.json({ detail: `provider '${providerId}' 不存在` }, 404);
    const r = await httpGetModels(String(target.base_url ?? ""), decryptProviderKey(target.api_key));
    const now = Date.now() / 1000;
    return c.json({
      status: r.ok ? "ok" : "error",
      latency_ms: r.latencyMs,
      detail: r.detail,
      last_check_time: now,
      consecutive_failures: r.ok ? 0 : 1,
    });
  });

  return app;
}
