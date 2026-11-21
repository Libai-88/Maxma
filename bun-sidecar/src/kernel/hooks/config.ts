/**
 * kernel/hooks/config.ts — 钩子配置的加载、校验与签名（M3 / A4）。
 *
 * 安全模型（诚实说明，不假装是插件市场）：
 *   - 配置文件默认 `<data>/config/hooks.json`，可用 `MAXMA_HOOKS_FILE` 覆盖；
 *   - 签名是 HMAC-SHA256，密钥在同目录 `hooks.secret`（首次签名时生成，0600）；
 *   - 配置存在但签名缺失/不匹配 → **整份不加载**（unsigned hooks never run）；
 *   - 签名只证明"这份配置来自本机持有密钥的人"，不证明脚本内容安全。
 *     命令处理器仍然是用户自己的代码，运行前请自己审阅。
 *
 * 为什么不做"每个 hook 单独签名"：签名覆盖 `{version, hooks}` 整份列表，
 * 任何增删改都会让签名失效，避免"新插一个 hook 到已签名文件里"。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { maxmaDataRoot } from "../project-paths";
import {
  HOOK_EVENTS,
  HOOK_HANDLER_TYPES,
  type HookDefinition,
  type HookEventName,
  type HooksConfigFile,
  type HooksLoadResult,
} from "./hook-types";

export function hooksConfigPath(dataDir = maxmaDataRoot()): string {
  return process.env.MAXMA_HOOKS_FILE
    ? path.resolve(process.env.MAXMA_HOOKS_FILE)
    : path.join(dataDir, "config", "hooks.json");
}

export function hooksSecretPath(dataDir = maxmaDataRoot()): string {
  return path.join(path.dirname(hooksConfigPath(dataDir)), "hooks.secret");
}

/** 稳定 JSON：对象键递归排序、数组保持顺序；签名双方必须复刻同一算法。 */
export function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) out[key] = normalize(record[key]);
      return out;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function hooksPayload(config: Pick<HooksConfigFile, "version" | "hooks">): string {
  return canonicalJson({ version: config.version, hooks: config.hooks });
}

export function computeHooksSignature(config: Pick<HooksConfigFile, "version" | "hooks">, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(hooksPayload(config)).digest("hex")}`;
}

/** 读密钥；不存在时生成一个 32 字节随机密钥（仅签名 CLI 调用）。 */
export function ensureHooksSecret(dataDir = maxmaDataRoot()): string {
  const file = hooksSecretPath(dataDir);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  return secret;
}

function readSecret(dataDir: string): string | null {
  try {
    return fs.readFileSync(hooksSecretPath(dataDir), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function validateHook(raw: unknown, index: number, errors: string[]): HookDefinition | null {
  if (!raw || typeof raw !== "object") {
    errors.push(`hooks[${index}] 不是对象`);
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    errors.push(`hooks[${index}] 缺少 id`);
    return null;
  }
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) {
    errors.push(`钩子 ${id}: id 只允许字母数字 . _ -（最多 64 字符）`);
    return null;
  }
  const events = Array.isArray(record.events)
    ? [...new Set(record.events.filter((value): value is HookEventName => HOOK_EVENTS.includes(value as HookEventName)))]
    : [];
  if (events.length === 0) {
    errors.push(`钩子 ${id}: events 必须包含 ${HOOK_EVENTS.join(" / ")} 之一`);
    return null;
  }
  if (typeof record.matcher === "string" && record.matcher.trim()) {
    try {
      new RegExp(record.matcher);
    } catch {
      errors.push(`钩子 ${id}: matcher 不是合法正则`);
      return null;
    }
  }
  const handler = record.handler as Record<string, unknown> | undefined;
  if (!handler || typeof handler !== "object" || !HOOK_HANDLER_TYPES.includes(handler.type as never)) {
    errors.push(`钩子 ${id}: handler.type 必须是 command / http / prompt`);
    return null;
  }
  if (handler.type === "command") {
    const command = typeof handler.command === "string" ? handler.command.trim() : "";
    if (!command) {
      errors.push(`钩子 ${id}: command handler 缺少 command`);
      return null;
    }
    if (Array.isArray(handler.args) && handler.args.some((arg) => typeof arg !== "string")) {
      errors.push(`钩子 ${id}: args 必须是字符串数组`);
      return null;
    }
  }
  if (handler.type === "http") {
    const url = typeof handler.url === "string" ? handler.url : "";
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
      if (parsed.username || parsed.password) throw new Error("credentials");
    } catch {
      errors.push(`钩子 ${id}: http handler 需要合法的 http(s) URL（不允许凭据）`);
      return null;
    }
  }
  if (handler.type === "prompt" && (typeof handler.text !== "string" || !handler.text.trim())) {
    errors.push(`钩子 ${id}: prompt handler 缺少 text`);
    return null;
  }
  return {
    id,
    events,
    ...(typeof record.matcher === "string" && record.matcher.trim() ? { matcher: record.matcher } : {}),
    handler: handler as unknown as HookDefinition["handler"],
    ...(typeof record.description === "string" ? { description: record.description } : {}),
  };
}

/**
 * 读取并校验钩子配置。
 * - 文件不存在 → `absent`（不产生错误，不阻断任何东西）；
 * - 签名不匹配 → `invalid`，hooks 为空；
 * - 某条 hook 结构非法 → 跳过该条并记录 skipped，其余合法钩子仍可运行。
 */
export function loadHooksConfig(dataDir = maxmaDataRoot()): HooksLoadResult {
  const configPath = hooksConfigPath(dataDir);
  const errors: string[] = [];
  const skipped: string[] = [];
  if (!fs.existsSync(configPath)) {
    return { hooks: [], configPath, status: "absent", errors, skipped };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    errors.push(`hooks.json 无法解析：${error instanceof Error ? error.message : String(error)}`);
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }
  if (!parsed || typeof parsed !== "object") {
    errors.push("hooks.json 顶层必须是对象");
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }
  const config = parsed as Partial<HooksConfigFile>;
  if (config.version !== 1) {
    errors.push("hooks.json 的 version 必须是 1");
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }
  if (!Array.isArray(config.hooks)) {
    errors.push("hooks.json 的 hooks 必须是数组");
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }

  const secret = readSecret(dataDir);
  const signature = typeof config.signature === "string" ? config.signature : "";
  if (!secret) {
    errors.push(`缺少签名密钥（${hooksSecretPath(dataDir)}），整份钩子不加载`);
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }
  if (!signature) {
    errors.push("hooks.json 没有签名，整份钩子不加载；请运行 bun bun-sidecar/src/hooks-sign.ts");
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }
  const expected = computeHooksSignature({ version: 1, hooks: config.hooks as HookDefinition[] }, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    errors.push("hooks.json 签名不匹配（配置被修改或密钥不对），整份钩子不加载");
    return { hooks: [], configPath, status: "invalid", errors, skipped };
  }

  const hooks: HookDefinition[] = [];
  const ids = new Set<string>();
  config.hooks.forEach((raw, index) => {
    const hook = validateHook(raw, index, errors);
    if (!hook) return;
    if (ids.has(hook.id)) {
      errors.push(`钩子 id 重复：${hook.id}`);
      skipped.push(hook.id);
      return;
    }
    ids.add(hook.id);
    hooks.push(hook);
  });
  return { hooks, configPath, status: "ready", errors, skipped };
}
