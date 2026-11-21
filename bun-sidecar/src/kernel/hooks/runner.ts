/**
 * kernel/hooks/runner.ts — 执行钩子处理器并归一化决策（M3 / A4）。
 *
 * 单源规则：
 *   - 命令处理器不经过 shell（`command` + `args` 直接 spawn），payload 走 stdin；
 *   - HTTP 只发 POST JSON，5s 默认超时，拒绝非 http(s) 与带凭据 URL；
 *   - prompt 处理器不调用模型：PreToolUse 当拒绝原因，其它事件当附加上下文；
 *   - 任何处理器失败**不阻断工具**（fail-open），但会写审计；配置未签名才是
 *     整份不加载（fail-closed）。
 *
 * 这样可以诚实地说：钩子能阻断/改写工具调用，但不能保证"坏钩子不让工作台瘫痪"。
 */

import * as path from "node:path";

import type {
  HookDecision,
  HookDefinition,
  HookHandler,
  HookPayload,
  HookRunRecord,
} from "./hook-types";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;

function clampTimeout(value: unknown, cap = MAX_TIMEOUT_MS): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(cap, Math.max(200, Math.floor(n)));
}

function handlerTimeout(handler: HookHandler): number {
  return clampTimeout("timeoutMs" in handler ? handler.timeoutMs : undefined);
}

function normalizeCommand(command: string, cwd: string): string {
  if (path.isAbsolute(command)) return command;
  // 带路径分隔符的相对命令按会话 cwd 解析；裸命令名交给 PATH。
  if (command.includes("/") || command.includes("\\")) return path.resolve(cwd, command);
  return command;
}

interface HandlerOutput {
  raw: unknown;
  text: string;
}

function parseText(raw: string): HandlerOutput {
  const text = raw.trim();
  if (!text) return { raw: null, text: "" };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return { raw: parsed, text };
  } catch {
    /* 纯文本 */
  }
  return { raw: null, text };
}

async function runCommandHandler(handler: Extract<HookHandler, { type: "command" }>, payload: HookPayload): Promise<HandlerOutput> {
  const command = normalizeCommand(handler.command, payload.cwd);
  const args = Array.isArray(handler.args) ? handler.args : [];
  const timeoutMs = handlerTimeout(handler);
  const child = Bun.spawn([command, ...args], {
    cwd: payload.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    env: {
      ...process.env,
      MAXMA_HOOK_EVENT: payload.event,
      MAXMA_HOOK_SESSION: payload.sessionId,
    },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill(); } catch { /* best effort */ }
  }, timeoutMs);
  try {
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  } catch (error) {
    try { child.kill(); } catch { /* best effort */ }
    clearTimeout(timer);
    throw new Error(`写入钩子 stdin 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  clearTimeout(timer);
  if (timedOut) throw new Error(`钩子命令超时（${timeoutMs}ms）`);
  if (code !== 0) throw new Error(`钩子命令退出码 ${code}：${stderr.trim().slice(0, 400)}`);
  return parseText(stdout);
}

async function runHttpHandler(handler: Extract<HookHandler, { type: "http" }>, payload: HookPayload): Promise<HandlerOutput> {
  const timeoutMs = handlerTimeout(handler);
  const parsed = new URL(handler.url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("钩子 HTTP URL 只允许 http/https");
  if (parsed.username || parsed.password) throw new Error("钩子 HTTP URL 不允许携带凭据");
  const response = await fetch(parsed.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`钩子 HTTP ${response.status}：${body.slice(0, 300)}`);
  return parseText(body);
}

/** 把 handler 的原始输出归一成该事件允许的决策。 */
function decisionFor(event: HookPayload["event"], output: HandlerOutput): HookDecision {
  const raw = (output.raw ?? {}) as Record<string, unknown>;
  const text = output.text;
  if (event === "PreToolUse") {
    if (raw.decision === "allow") {
      return {
        block: false,
        ...(raw.inputPatch && typeof raw.inputPatch === "object"
          ? { inputPatch: raw.inputPatch as Record<string, unknown> }
          : {}),
        raw,
      };
    }
    if (raw.decision === "block" || raw.block === true) {
      return { block: true, reason: typeof raw.reason === "string" ? raw.reason : "钩子拒绝该工具调用", raw };
    }
    if (raw.inputPatch && typeof raw.inputPatch === "object") {
      return { inputPatch: raw.inputPatch as Record<string, unknown>, raw };
    }
    // 纯文本输出按拒绝原因处理：PreToolUse 没有"悄悄说一句话"的语义。
    if (text) return { block: true, reason: text.slice(0, 1_000), raw };
    return { raw };
  }

  if (event === "PostToolUse") {
    const append = typeof raw.contentAppend === "string" ? raw.contentAppend : text;
    return {
      ...(append ? { contentAppend: append.slice(0, 20_000) } : {}),
      ...(raw.isError === true ? { contentAppend: `[钩子标记错误] ${append}` } : {}),
      raw,
    };
  }

  if (event === "SessionStart") {
    const context = typeof raw.additionalContext === "string" ? raw.additionalContext : text;
    return { ...(context ? { additionalContext: context.slice(0, 20_000) } : {}), raw };
  }

  if (event === "PreCompact") {
    return {
      ...(raw.cancel === true ? { cancel: true } : {}),
      ...(typeof raw.customInstructions === "string" && raw.customInstructions.trim()
        ? { customInstructions: raw.customInstructions.slice(0, 4_000) }
        : {}),
      ...(typeof raw.reason === "string" ? { reason: raw.reason.slice(0, 1_000) } : {}),
      ...(text && !raw.cancel && !raw.customInstructions ? { customInstructions: text.slice(0, 4_000) } : {}),
      raw,
    };
  }

  return { raw };
}

function matches(hook: HookDefinition, payload: HookPayload): boolean {
  if (!hook.events.includes(payload.event)) return false;
  if (payload.event !== "PreToolUse" && payload.event !== "PostToolUse") return true;
  if (!hook.matcher) return true;
  try {
    return new RegExp(hook.matcher).test(payload.toolName ?? "");
  } catch {
    return false;
  }
}

export interface RunHooksResult {
  records: HookRunRecord[];
  decision: HookDecision;
}

export async function runHooks(hooks: HookDefinition[], payload: HookPayload): Promise<RunHooksResult> {
  const records: HookRunRecord[] = [];
  const decision: HookDecision = {};
  const contextParts: string[] = [];

  for (const hook of hooks) {
    if (!matches(hook, payload)) continue;
    if (decision.block) break;
    const started = Date.now();
    try {
      const output = hook.handler.type === "prompt"
        ? { raw: { text: hook.handler.text }, text: hook.handler.text }
        : hook.handler.type === "http"
          ? await runHttpHandler(hook.handler, payload)
          : await runCommandHandler(hook.handler, payload);
      const hookDecision = decisionFor(payload.event, output);
      const record: HookRunRecord = {
        hookId: hook.id,
        event: payload.event,
        status: "ok",
        durationMs: Date.now() - started,
        decision: hookDecision,
      };
      records.push(record);

      if (hookDecision.block) {
        decision.block = true;
        decision.reason = hookDecision.reason;
      }
      if (hookDecision.inputPatch) {
        decision.inputPatch = { ...(decision.inputPatch ?? {}), ...hookDecision.inputPatch };
      }
      if (hookDecision.contentAppend) {
        decision.contentAppend = [decision.contentAppend, hookDecision.contentAppend].filter(Boolean).join("\n\n");
      }
      if (hookDecision.additionalContext) contextParts.push(hookDecision.additionalContext);
      if (hookDecision.cancel) decision.cancel = true;
      if (hookDecision.customInstructions) {
        decision.customInstructions = [decision.customInstructions, hookDecision.customInstructions].filter(Boolean).join("\n\n");
      }
      if (hookDecision.reason && payload.event === "PreCompact") decision.reason = hookDecision.reason;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.push({
        hookId: hook.id,
        event: payload.event,
        status: "error",
        durationMs: Date.now() - started,
        error: message.slice(0, 500),
      });
      // fail-open：单个钩子坏了，不阻断工具；由审计与状态接口暴露。
    }
  }

  if (contextParts.length > 0) decision.additionalContext = contextParts.join("\n\n");
  return { records, decision };
}

export { handlerTimeout, normalizeCommand };
