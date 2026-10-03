/**
 * routes/mcp-test.ts — POST /api/mcp/test-connection
 * （api/routes/mcp_test.py 的 Bun 直译，阶段二 2.4b）。
 *
 * stdio：命令白名单 + 拒绝 shell 元字符 → 启动子进程，5 秒内未崩溃视为成功。
 * streamable_http：HTTP(S) 可达性探测（GET，5s 超时，
 * 任何 HTTP 响应都视为可达）。
 */

import { Hono, type Context } from "hono";

// 子进程环境变量白名单——仅透传系统必需变量
const ALLOWED_ENV_KEYS = new Set([
  "PATH", "TEMP", "TMP", "COMSPEC", "PATHEXT", "SYSTEMROOT", "WINDIR",
]);

// 用户显式传入 env 的黑名单
const FORBIDDEN_ENV_KEYS = new Set([
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
  "NODE_OPTIONS", "PYTHONPATH", "PYTHONSTARTUP", "BUN_OPTIONS",
]);

// 命令白名单（大小写不敏感）
const ALLOWED_COMMANDS = new Set([
  "npx", "node", "npm", "uvx", "uv", "python", "python3", "py", "bun", "deno", "docker",
]);

const COMMAND_NAME_RE = /^[A-Za-z0-9_.\-]+$/;

interface TestResponse {
  success: boolean;
  error: string | null;
  resolved_command: string;
}

/** Python repr 风格字符串（'rm'；含单引号时用双引号）。 */
function pyRepr(s: string): string {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s}'`;
}

/** Python list repr 风格（['a', 'b']）。 */
function pyListRepr(items: string[]): string {
  return `[${items.map(pyRepr).join(", ")}]`;
}

/** 校验命令并返回 basename（拒绝空/非法字符/白名单外）。 */
function resolveCommand(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  if (!raw || !raw.trim()) return { ok: false, error: "command 不能为空" };
  const name = raw.trim().split(/[\\/]/).pop()!;
  if (!COMMAND_NAME_RE.test(name)) {
    return { ok: false, error: `命令名含非法字符: ${pyRepr(name)}（仅允许字母数字、下划线、短横线、点）` };
  }
  if (!ALLOWED_COMMANDS.has(name.toLowerCase())) {
    return { ok: false, error: `命令 ${pyRepr(name)} 不在白名单中，允许: ${pyListRepr([...ALLOWED_COMMANDS].sort())}` };
  }
  return { ok: true, name };
}

/** 校验 args——拒绝控制字符与 shell 元字符。 */
function validateArgs(args: unknown[]): { ok: true; cleaned: string[] } | { ok: false; error: string } {
  const forbidden = ["\n", "\r", "\x00"];
  const shellMeta = /[`$|;&<>]/;
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== "string") return { ok: false, error: `args[${i}] 必须是字符串` };
    if (forbidden.some((ch) => a.includes(ch))) return { ok: false, error: `args[${i}] 含控制字符（换行/NUL）` };
    if (shellMeta.test(a)) return { ok: false, error: `args[${i}] 含 shell 元字符 (\`$|;&<>)` };
    cleaned.push(a);
  }
  return { ok: true, cleaned };
}

/** 构造子进程 env：系统白名单变量 + 用户 env（过滤黑名单）。 */
function buildEnv(userEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && ALLOWED_ENV_KEYS.has(k.toUpperCase())) env[k] = v;
  }
  for (const [k, v] of Object.entries(userEnv ?? {})) {
    if (!FORBIDDEN_ENV_KEYS.has(k.toUpperCase())) env[k] = v;
  }
  return env;
}

export function createMcpTestRoutes(): Hono {
  const app = new Hono();

  app.post("/api/mcp/test-connection", async (c: Context) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const transport = typeof body.transport === "string" ? body.transport : "stdio";
    const command = typeof body.command === "string" ? body.command : "";
    const args = Array.isArray(body.args) ? body.args : [];
    const env = body.env && typeof body.env === "object" && !Array.isArray(body.env)
      ? (body.env as Record<string, string>)
      : {};
    const url = typeof body.url === "string" ? body.url : "";

    // Pi 当前仅支持 stdio 与 streamable_http。
    if (transport !== "stdio" && transport !== "streamable_http") {
      return c.json({ success: false, error: "不支持的 transport：仅支持 stdio 或 streamable_http", resolved_command: "" } satisfies TestResponse, 400);
    }

    // URL 类传输
    if (transport === "streamable_http") {
      const trimmed = url.trim();
      if (!trimmed) {
        return c.json({ success: false, error: "缺少服务器 URL", resolved_command: "" } satisfies TestResponse);
      }
      if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
        return c.json({ success: false, error: "URL 必须以 http:// 或 https:// 开头", resolved_command: "" } satisfies TestResponse);
      }
      try {
        await fetch(trimmed, { redirect: "follow", signal: AbortSignal.timeout(5_000) });
        return c.json({ success: true, error: null, resolved_command: trimmed } satisfies TestResponse);
      } catch (err) {
        return c.json({
          success: false,
          error: `连接失败: ${String(err).slice(0, 200)}`,
          resolved_command: trimmed,
        } satisfies TestResponse);
      }
    }

    // stdio
    const resolved = resolveCommand(command);
    if (!resolved.ok) return c.json({ detail: resolved.error }, 400);
    const safeArgs = validateArgs(args);
    if (!safeArgs.ok) return c.json({ detail: safeArgs.error }, 400);

    let proc: ReturnType<typeof Bun.spawn> | null = null;
    try {
      proc = Bun.spawn([resolved.name, ...safeArgs.cleaned], {
        env: buildEnv(env),
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      const msg = err instanceof Error && /not found|ENOENT/i.test(err.message)
        ? `命令不存在: ${String(err)}`
        : `启动失败: ${String(err)}`;
      return c.json({ success: false, error: msg, resolved_command: resolved.name } satisfies TestResponse);
    }

    // 5 秒内未退出 = 进程在运行 = 成功
    const exited = await Promise.race([
      proc.exited.then((code) => ({ exited: true, code })),
      Bun.sleep(5_000).then(() => ({ exited: false as const, code: null })),
    ]);

    if (!exited.exited) {
      try {
        proc.kill();
      } catch {
        /* noop */
      }
      return c.json({ success: true, error: null, resolved_command: resolved.name } satisfies TestResponse);
    }

    if (exited.code === 0) {
      return c.json({ success: true, error: null, resolved_command: resolved.name } satisfies TestResponse);
    }

    let stderrText = "";
    try {
      stderrText = await new Response(proc.stderr).text();
    } catch {
      /* noop */
    }
    return c.json({
      success: false,
      error: `进程退出码 ${exited.code}: ${stderrText.trim().slice(0, 500)}`,
      resolved_command: resolved.name,
    } satisfies TestResponse);
  });

  return app;
}
