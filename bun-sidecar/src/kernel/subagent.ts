/**
 * kernel/subagent.ts — 子 Agent 工具（pi 官方 SDK 的进程内会话）。
 *
 * ## 为什么这样实现
 *
 * pi 的官方口径有两份材料：
 *   1. `examples/extensions/subagent/`：子 Agent = **独立上下文的另一个 `pi`
 *      进程**（README: "Each subagent runs in a separate `pi` process"），
 *      通过 CLI 的 `--print --mode json` 读事件流，支持 single/parallel/chain。
 *   2. `docs/sdk.md`：`createAgentSession()` + `SessionManager.inMemory()`
 *      可以在**同一进程**里创建互不影响的会话；`docs/environment-variables.md`
 *      的 `PI_CODEMODE_MAX_WORKERS` 注释直接以 "in-process subagents" 举例。
 *
 * Maxma 选 2（SDK 进程内）而不是 1（CLI 子进程），原因不是口味：
 * 实测本机 pi 的 CLI bundle 在 Bun 1.3.14 下起不来（undici 的
 * `webidl.util.markAsUncloneable` 缺失），而便携包只带 bun.exe、不带 Node；
 * 子进程路线在打包形态里根本跑不响。SDK 路线复用的是 Maxma 已经建好的
 * ModelRuntime（含用户自定义 provider 与凭据），不依赖任何外部可执行文件。
 *
 * ## 边界（写死在这，不给 UI 留幻想）
 *
 *   - 子会话**不加载** Maxma 的 subagent 工具本身（禁止递归），也不加载审批扩展
 *     （父会话的权限模式已经决定了这次委派是否被批准；子会话没有交互面）。
 *   - 默认只读（read/grep/find/ls/bash）；只有 `writable=true` 时才装 write/edit，
 *     且写入发生在 **git worktree** 隔离目录里，父会话保留合并权（只回 patch，不自动落盘）。
 *   - 上下文隔离：每个任务一个 in-memory SessionManager，跑完即 dispose；worktree 也清理。
 */

import {
  defineTool,
  type AgentSession,
  type ModelRuntime,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createMaxmaSession } from "./pi-session";
import { TaskGraphError, buildTaskGraph, type TaskGraphNode } from "./task-graph";

/** 子 Agent 只读侦察工具（不含 write/edit/subagent，见头注释）。 */
export const SUBAGENT_TOOL_NAMES = ["read", "grep", "find", "ls", "bash"] as const;

/** 明确请求 writable=true 时，子 Agent 才拿到写工具；写入发生在隔离 worktree。 */
export const SUBAGENT_WRITABLE_TOOL_NAMES = ["read", "write", "edit", "grep", "find", "ls", "bash"] as const;

/** 子 Agent 的系统提示：只做委派出去的这一件事，别扩张。 */
const SUBAGENT_SYSTEM_PROMPT = [
  "你是被父 Agent 委派的子 Agent，运行在独立上下文里。",
  "只完成交给你的这一项任务，不要扩展范围、不要索取额外指令。",
  "需要看文件就用 read/grep/find/ls，需要执行命令就用 bash。",
  "最终回复必须是可直接交回给父 Agent 的结论：做了什么、结论是什么、关键证据（文件路径/命令输出）。",
  "不要复述过程日志，不要寒暄，不要 Markdown 标题。",
].join("\n");

const SUBAGENT_WRITABLE_SYSTEM_PROMPT = [
  SUBAGENT_SYSTEM_PROMPT,
  "你这次被明确允许改文件，但运行在隔离的 git worktree 中；只改这个 worktree，不要尝试访问父工作区。",
  "修改要小步、可审阅；最终说明改了哪些文件以及为什么。",
].join("\n");

export interface SubagentLimits {
  /** 并行任务上限（官方示例 MAX_CONCURRENCY=4）。 */
  maxConcurrent: number
  /** 单个子任务超时（毫秒）。 */
  timeoutMs: number
}

export const SUBAGENT_DEFAULT_LIMITS: SubagentLimits = { maxConcurrent: 4, timeoutMs: 300_000 };

export interface CreateSubagentToolDeps {
  cwd: string
  modelRuntime?: ModelRuntime
  model?: Parameters<typeof createMaxmaSession>[0]["model"]
  limits?: Partial<SubagentLimits>
  /** 父会话模型名（结果里回给模型看，便于判断是谁干的活）。 */
  parentModel?: string
  /**
   * 建子会话的工厂（默认 `createMaxmaSession`）。测试注入点：
   * 只有可替换工厂，才能在没有真实模型的情况下验证并发上限、超时与取消。
   */
  createSession?: (options: Parameters<typeof createMaxmaSession>[0]) => Promise<AgentSession>
}

/** 超时/取消的失败文案（测试与 UI 都按这两个前缀判定）。 */
export const SUBAGENT_TIMEOUT_PREFIX = "子任务超时"
export const SUBAGENT_CANCEL_MESSAGE = "父会话已取消，子任务中止"

interface SubagentTaskInput {
  /** 任务描述（必填）。 */
  prompt: string
  /** 展示用短标签（可选）。 */
  label?: string
  /** 任务 id（可选，默认按序号生成）；被其它任务依赖时需要。 */
  id?: string
  /** 依赖的任务 id：只有这些任务全部成功后才开跑。 */
  dependsOn?: string[]
  /** 失败后的额外尝试次数（0–3，默认 0）。 */
  retries?: number
}

interface SubagentTaskResult {
  id?: string
  label: string
  ok: boolean
  output: string
  durationMs: number
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null }
  error?: string
  /** 依赖的上游任务失败，本任务没有执行。 */
  blockedBy?: string
  /** writable 子任务产出的 patch；父会话据此决定是否合并。 */
  patch?: string
  patchTruncated?: boolean
  isolatedWorktree?: boolean
}

interface Worktree {
  repoRoot: string
  dir: string
}

async function runGit(args: string[], cwd: string, timeoutMs = 20_000): Promise<{ ok: boolean; output: string }> {
  const child = Bun.spawn(["git", "-c", "core.quotepath=false", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* best effort */ }
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  clearTimeout(timer);
  return { ok: code === 0, output: `${stdout}${stderr}`.trim() };
}

async function createIsolatedWorktree(cwd: string): Promise<Worktree> {
  const repo = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!repo.ok) throw new Error("writable 子 Agent 需要 git 仓库（当前 cwd 不是仓库）");
  const repoRoot = repo.output.split(/\r?\n/).pop()?.trim() ?? "";
  if (!repoRoot || !fs.existsSync(repoRoot)) throw new Error("无法定位 git 仓库根目录");
  const base = process.env.MAXMA_SUBAGENT_WORKTREES
    ? path.resolve(process.env.MAXMA_SUBAGENT_WORKTREES)
    : path.join(os.tmpdir(), "maxma-subagent-worktrees");
  fs.mkdirSync(base, { recursive: true });
  const dir = path.join(base, `wt-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`);
  const added = await runGit(["worktree", "add", "--detach", "--quiet", dir, "HEAD"], repoRoot);
  if (!added.ok) throw new Error(`创建隔离 worktree 失败：${added.output.slice(0, 500)}`);
  return { repoRoot, dir };
}

/** 取 worktree 相对 HEAD 的完整 patch（含未跟踪文件）；200 KiB 截断。 */
async function worktreePatch(worktree: Worktree): Promise<{ patch: string; truncated: boolean }> {
  const add = await runGit(["add", "-A", "-N"], worktree.dir);
  if (!add.ok) throw new Error(`收集 worktree 变更失败：${add.output.slice(0, 300)}`);
  const diff = await runGit(["diff", "--binary", "--no-color", "--unified=3"], worktree.dir);
  if (!diff.ok) throw new Error(`读取 worktree patch 失败：${diff.output.slice(0, 300)}`);
  const limit = 200 * 1024;
  if (diff.output.length <= limit) return { patch: diff.output, truncated: false };
  return { patch: diff.output.slice(0, limit), truncated: true };
}

async function cleanupWorktree(worktree: Worktree): Promise<void> {
  try {
    const removed = await runGit(["worktree", "remove", "--force", worktree.dir], worktree.repoRoot, 15_000);
    if (!removed.ok && fs.existsSync(worktree.dir)) fs.rmSync(worktree.dir, { recursive: true, force: true });
    await runGit(["worktree", "prune"], worktree.repoRoot, 15_000);
  } catch (error) {
    console.warn("[subagent] worktree cleanup failed:", worktree.dir, error);
  }
}

function normalizeLimits(partial?: Partial<SubagentLimits>): SubagentLimits {
  const maxConcurrent = Number.isFinite(partial?.maxConcurrent)
    ? Math.min(8, Math.max(1, Math.floor(Number(partial?.maxConcurrent))))
    : SUBAGENT_DEFAULT_LIMITS.maxConcurrent
  // 下限 1s：面板正常值在数百秒量级，但测试与调试需要能压到秒级验证超时路径。
  const timeoutMs = Number.isFinite(partial?.timeoutMs)
    ? Math.min(1_800_000, Math.max(1_000, Math.floor(Number(partial?.timeoutMs))))
    : SUBAGENT_DEFAULT_LIMITS.timeoutMs
  return { maxConcurrent, timeoutMs }
}

/** 从一个已完成的子会话里取结论与用量。 */
function readResult(session: AgentSession): {
  output: string
  usage: SubagentTaskResult["usage"]
} {
  const messages = session.messages as Array<{
    role?: string
    content?: unknown
    usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  }>
  const assistant = [...messages].reverse().find((m) => m.role === "assistant")
  let text = ""
  if (typeof assistant?.content === "string") text = assistant.content
  else if (Array.isArray(assistant?.content)) {
    text = (assistant.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b?.type === "text")
      .map((b) => b.text ?? "")
      .join("")
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return {
    output: text.trim(),
    usage: {
      input: num(assistant?.usage?.input),
      output: num(assistant?.usage?.output),
      cacheRead: num(assistant?.usage?.cacheRead),
      cacheWrite: num(assistant?.usage?.cacheWrite),
    },
  }
}

/**
 * 子 Agent 工具：`subagent({ tasks: [{ prompt, label? }] })`。
 *
 * 并行上限与超时由宿主传入（后端把面板配置经 create_session 下发），
 * 不在工具内部读文件——内核不碰 `panel_configs.json`。
 */
export function createSubagentTool(deps: CreateSubagentToolDeps): ToolDefinition {
  const limits = normalizeLimits(deps.limits)
  const factory = deps.createSession ?? createMaxmaSession
  return defineTool({
    name: "subagent",
    label: "Subagent",
    description:
      "把彼此独立、上下文可以隔离的子任务交给子 Agent 并行跑（每个任务独立上下文与独立模型请求）。" +
      `最多 ${limits.maxConcurrent} 个并行，单个任务超时 ${Math.round(limits.timeoutMs / 1000)}s。` +
      "默认只读（read/grep/find/ls/bash）；只有 writable=true 时才允许 write/edit，且写入发生在 git worktree 隔离目录，返回 patch 由父会话审阅合并。" +
      "任务可用 depends_on 声明依赖：依赖全部成功后才开跑；上游失败只阻塞它的下游，独立任务继续。" +
      "单个任务可用 retries（0–3）在失败后自动重试。子 Agent 不会再委派。",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String({ description: "任务 id（可选，默认 task-1…）；被依赖时需要稳定 id" })),
          prompt: Type.String({ description: "要子 Agent 完成的任务，写清目标、范围与期望产出" }),
          label: Type.Optional(Type.String({ description: "展示用短标签" })),
          depends_on: Type.Optional(Type.Array(Type.String(), { description: "依赖的任务 id 列表；这些任务全部成功后才开跑" })),
          retries: Type.Optional(Type.Integer({ minimum: 0, maximum: 3, description: "失败后的额外尝试次数（默认 0）" })),
        }),
        { minItems: 1, maxItems: 16 },
      ),
      writable: Type.Optional(Type.Boolean({ description: "是否允许子 Agent 改文件；默认 false，开启后每个任务在独立 git worktree 中运行" })),
    }),
    annotations: { readOnlyHint: false },
    async execute(_toolCallId, params, signal, onUpdate) {
      const input = params as { tasks?: Array<SubagentTaskInput & { depends_on?: string[] }>; writable?: boolean }
      const tasks = (input.tasks ?? []).filter((t) => typeof t.prompt === "string" && t.prompt.trim())
      const writable = input.writable === true
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "subagent: 没有可执行的任务（tasks 为空）" }], details: { tasks: [] } }
      }

      let graph
      try {
        graph = buildTaskGraph(tasks.map((task, index) => ({
          id: task.id ?? `task-${index + 1}`,
          prompt: task.prompt,
          label: task.label,
          dependsOn: task.depends_on ?? task.dependsOn,
          retries: task.retries,
        })))
      } catch (error) {
        const message = error instanceof TaskGraphError ? error.message : String(error)
        return {
          content: [{ type: "text", text: `subagent: 任务计划无效——${message}` }],
          details: { tasks: [], limits, graphError: message },
        }
      }

      const results: SubagentTaskResult[] = []
      const indexById = new Map<string, number>()
      graph.nodesInInputOrder().forEach((node, index) => indexById.set(node.id, index))
      let finished = 0
      const emitProgress = () => {
        onUpdate?.({
          content: [{ type: "text", text: `子任务进度 ${finished}/${tasks.length}（${graph.counts().running} 个在跑）` }],
          details: { finished, total: tasks.length, graph: graph.snapshot() },
        })
      }

      /**
       * 单个子任务。SUBAGENT-TIMEOUT-001：描述里写了"单个任务超时 X 秒"，
       * 但旧实现只把 limits 塞进文案，从不真的计时——任务卡住就永远卡住。
       * 现在超时与父会话取消都转成 `session.abort()`，并标记失败的**原因**，
       * 让父 Agent 看到"是超时/被取消"，而不是笼统的 aborted。
       */
      const runOne = async (
        node: TaskGraphNode,
        index: number,
        abortSignal: AbortSignal | undefined,
      ): Promise<void> => {
        const label = node.label
        const startedAt = Date.now()
        let session: AgentSession | undefined
        let worktree: Worktree | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let timedOut = false
        let cancelled = false
        const abortChild = () => {
          try {
            void session?.abort().catch(() => {})
          } catch {
            /* 已释放 */
          }
        }
        const onParentAbort = () => {
          cancelled = true
          abortChild()
        }
        try {
          if (abortSignal?.aborted) throw new Error(SUBAGENT_CANCEL_MESSAGE)
          if (writable) worktree = await createIsolatedWorktree(deps.cwd)
          const childCwd = worktree?.dir ?? deps.cwd
          session = await factory({
            cwd: childCwd,
            inMemory: true,
            tools: writable ? [...SUBAGENT_WRITABLE_TOOL_NAMES] : [...SUBAGENT_TOOL_NAMES],
            customTools: [],
            skillsEnabled: false,
            permissionMode: "auto",
            systemPrompt: writable ? SUBAGENT_WRITABLE_SYSTEM_PROMPT : SUBAGENT_SYSTEM_PROMPT,
            ...(deps.modelRuntime ? { modelRuntime: deps.modelRuntime } : {}),
            ...(deps.model ? { model: deps.model } : {}),
          })
          if (abortSignal?.aborted) throw new Error(SUBAGENT_CANCEL_MESSAGE)
          timer = setTimeout(() => {
            timedOut = true
            abortChild()
          }, limits.timeoutMs)
          abortSignal?.addEventListener("abort", onParentAbort, { once: true })
          await session.prompt(node.prompt)
          if (timedOut) throw new Error(`${SUBAGENT_TIMEOUT_PREFIX}（${Math.round(limits.timeoutMs / 1000)}s）`)
          if (cancelled) throw new Error(SUBAGENT_CANCEL_MESSAGE)
          const { output, usage } = readResult(session)
          const patchInfo = worktree ? await worktreePatch(worktree) : undefined
          graph.succeed(node.id)
          results[index] = {
            id: node.id,
            label,
            ok: true,
            output: output || "（子 Agent 未产出文字结论）",
            durationMs: Date.now() - startedAt,
            usage,
            ...(patchInfo
              ? { patch: patchInfo.patch, patchTruncated: patchInfo.truncated, isolatedWorktree: true }
              : {}),
          }
        } catch (error) {
          const reason = timedOut
            ? `${SUBAGENT_TIMEOUT_PREFIX}（${Math.round(limits.timeoutMs / 1000)}s）`
            : cancelled
              ? SUBAGENT_CANCEL_MESSAGE
              : error instanceof Error
                ? error.message
                : String(error)
          if (cancelled || abortSignal?.aborted) {
            graph.markCancelled(node.id, reason)
          } else {
            const state = graph.fail(node.id, reason)
            if (state === "pending") {
              // 还有重试额度：不落最终结果，调度器会再捞起这个节点。
              onUpdate?.({
                content: [{ type: "text", text: `${label} 失败，准备重试（${node.attempts}/${node.retries + 1}）` }],
                details: { retrying: node.id, graph: graph.snapshot() },
              })
              return
            }
          }
          results[index] = {
            id: node.id,
            label,
            ok: false,
            output: "",
            durationMs: Date.now() - startedAt,
            usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
            error: reason,
          }
        } finally {
          if (timer !== undefined) clearTimeout(timer)
          abortSignal?.removeEventListener("abort", onParentAbort)
          try { session?.dispose() } catch { /* 已释放 */ }
          if (worktree) await cleanupWorktree(worktree)
          if (results[index]) {
            finished += 1
            emitProgress()
          }
        }
      }

      const running = new Set<Promise<void>>()
      while (true) {
        if (signal?.aborted) graph.cancelAll(SUBAGENT_CANCEL_MESSAGE)
        while (running.size < limits.maxConcurrent) {
          const ready = graph.ready(1)
          const node = ready[0]
          if (!node) break
          const index = indexById.get(node.id)!
          graph.start(node.id)
          const promise = runOne(node, index, signal).finally(() => running.delete(promise))
          running.add(promise)
        }
        if (running.size === 0) break
        await Promise.race(running)
      }

      // 取消/阻塞/依赖失败导致没跑的任务也要有结果行：父 Agent 需要看到"为什么没跑"。
      graph.nodesInInputOrder().forEach((node, index) => {
        if (results[index]) return
        const snapshot = graph.snapshot().find((n) => n.id === node.id)
        results[index] = {
          id: node.id,
          label: node.label,
          ok: false,
          output: "",
          durationMs: 0,
          usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
          error: snapshot?.error ?? (snapshot?.status === "cancelled" ? SUBAGENT_CANCEL_MESSAGE : `任务未执行（${snapshot?.status ?? "unknown"}）`),
          ...(snapshot?.blockedBy ? { blockedBy: snapshot.blockedBy } : {}),
        }
      })

      const lines = results.map((r) => {
        const blocked = r.blockedBy ? `（被 ${r.blockedBy} 阻塞）` : ""
        const head = `### ${r.label}${r.ok ? "" : `（失败${blocked}）`} · ${(r.durationMs / 1000).toFixed(1)}s`
        const usage = r.usage.input === null && r.usage.output === null
          ? ""
          : `\n用量：↑${r.usage.input ?? 0} ↓${r.usage.output ?? 0} 缓存读 ${r.usage.cacheRead ?? 0}`
        const body = r.ok ? r.output : `错误：${r.error ?? "未知"}`
        const patch = r.patch
          ? `\n\n隔离 worktree 补丁（未自动合并，父会话审阅后再应用${r.patchTruncated ? "；已截断" : ""}）：\n\`\`\`diff\n${r.patch}\n\`\`\``
          : ""
        return `${head}${usage}\n${body}${patch}`
      })
      const okCount = results.filter((r) => r.ok).length
      const finalCounts = graph.counts()
      const summary = `子 Agent 完成 ${okCount}/${tasks.length} 个任务${finalCounts.failed ? `（失败 ${finalCounts.failed}）` : ""}${finalCounts.blocked ? `（阻塞 ${finalCounts.blocked}）` : ""}${deps.parentModel ? `（父模型 ${deps.parentModel}）` : ""}\n\n${lines.join("\n\n")}`
      return {
        content: [{ type: "text", text: summary }],
        details: { tasks: results, limits, graph: graph.snapshot(), counts: finalCounts },
      }
    },
  }) as ToolDefinition
}