/**
 * routes/mcp-validation.ts — MCP 配置校验与敏感信息脱敏
 * （api/routes/mcp_validation.py 的 Bun 直译，阶段二 2.4b）。
 */

/** 子进程环境变量黑名单——禁止通过 API 设置的敏感系统变量。 */
const BLOCKED_ENV_KEYS = new Set([
  // Linux / macOS 动态库注入
  "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "LD_DEBUG",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  // Python 模块劫持
  "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONPYCACHEPREFIX",
  // 命令路径劫持
  "PATH", "IFS", "BASH_ENV", "ENV",
  // Shell 劫持 (Windows)
  "COMSPEC", "SHELL", "PATHEXT",
  // Node.js
  "NODE_PATH", "NODE_OPTIONS",
  // 通用危险变量
  "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP",
]);

/** 业务校验错误（对齐 Python HTTPException：status + detail 字符串）。 */
export class McpHttpError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

/** 校验环境变量字典，拒绝黑名单敏感 key。 */
export function validateEnvVars(env: Record<string, unknown>): void {
  const blocked = Object.keys(env).filter((k) => BLOCKED_ENV_KEYS.has(k.toUpperCase()));
  if (blocked.length > 0) {
    throw new McpHttpError(400, `环境变量包含禁止设置的敏感 key: ${blocked.join(", ")}`);
  }
}

/** stdio 允许的可执行命令白名单（仅命令名，不含路径）。 */
const ALLOWED_STDIO_COMMANDS = new Set([
  "npx", "node", "npm", "bun", "bunx", "deno",
  "python", "python3", "py", "uvx", "uv", "pipx",
  "go", "cargo", "ruby", "java",
  "docker", "podman",
]);

/**
 * 校验 stdio 命令名在白名单内。接受裸命令名或绝对/相对路径（取 basename），
 * Windows 下剥离 .exe/.cmd/.bat 后缀。
 */
export function validateStdioCommand(command: string): string {
  if (typeof command !== "string" || !command.trim()) {
    throw new McpHttpError(400, "stdio 模式必须指定 command");
  }
  const bare = command.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  let basename = bare.split("\\").pop()!.split("/").pop()!;
  const lower = basename.toLowerCase();
  for (const ext of [".exe", ".cmd", ".bat"]) {
    if (lower.endsWith(ext)) {
      basename = basename.slice(0, -ext.length);
      break;
    }
  }
  if (!ALLOWED_STDIO_COMMANDS.has(basename)) {
    throw new McpHttpError(
      400,
      `stdio 命令 '${basename}' 不在白名单中，允许的命令: ${[...ALLOWED_STDIO_COMMANDS].sort().join(", ")}`,
    );
  }
  return command;
}

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY_NAMES = new Set([
  "authorization", "token", "authtoken", "accesstoken", "refreshtoken",
  "apitoken", "apikey", "xapikey", "clientsecret", "password", "secret",
  "cookie", "setcookie",
]);
const SENSITIVE_CONTAINER_NAMES = new Set(["env", "headers"]);

/** 归一化 key 拼写（case/separator 无关）。 */
function normaliseSensitiveKey(key: unknown): string {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** 递归脱敏副本（不修改持久化配置）。 */
export function redactSensitive(value: unknown, maskAll = false): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normaliseSensitiveKey(key);
      if (maskAll) redacted[key] = redactSensitive(item, true);
      else if (SENSITIVE_CONTAINER_NAMES.has(normalized)) redacted[key] = redactSensitive(item, true);
      else if (SENSITIVE_KEY_NAMES.has(normalized)) redacted[key] = REDACTED;
      else redacted[key] = redactSensitive(item);
    }
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, maskAll));
  return maskAll ? REDACTED : value;
}

/** 合并配置映射，拒绝 [REDACTED] 占位符覆盖真实密钥。 */
export function mergeRedactedMapping(target: unknown, update: unknown): Record<string, unknown> {
  const merged: Record<string, unknown> =
    target && typeof target === "object" && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {};
  if (!update || typeof update !== "object" || Array.isArray(update)) return merged;
  for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
    if (value === REDACTED) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeRedactedMapping(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
