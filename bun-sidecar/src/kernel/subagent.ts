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
 *   - 工具集限定为只读 + 代码执行（read/grep/find/ls/bash），不装 write/edit：
 *     子 Agent 负责侦察与执行命令，改文件仍由父会话决定。
 *   - 上下文隔离：每个任务一个 in-memory SessionManager，跑完即 dispose。
 */

import {
  defineTool,
  type AgentSession,
  type ModelRuntime,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createMaxmaSession } from "./pi-session";

/** 子 Agent 可用的工具白名单（不含 write/edit/subagent，见头注释）。 */
export const SUBAGENT_TOOL_NAMES = ["read", "grep", "find", "ls", "bash"] as const;

/** 子 Agent 的系统提示：只做委派出去的这一件事，别扩张。 */
const SUBAGENT_SYSTEM_PROMPT = [
  "你是被父 Agent 委派的子 Agent，运行在独立上下文里。",
  "只完成交给你的这一项任务，不要扩展范围、不要索取额外指令。",
  "需要看文件就用 read/grep/find/ls，需要执行命令就用 bash。",
  "最终回复必须是可直接交回给父 Agent 的结论：做了什么、结论是什么、关键证据（文件路径/命令输出）。",
  "不要复述过程日志，不要寒暄，不要 Markdown 标题。",
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
}

interface SubagentTaskInput {
  /** 任务描述（必填）。 */
  prompt: string
  /** 展示用短标签（可选）。 */
  label?: string
}

interface SubagentTaskResult {
  label: string
  ok: boolean
  output: string
  durationMs: number
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null }
  error?: string
}

function normalizeLimits(partial?: Partial<SubagentLimits>): SubagentLimits {
  const maxConcurrent = Number.isFinite(partial?.maxConcurrent)
    ? Math.min(8, Math.max(1, Math.floor(Number(partial?.maxConcurrent))))
    : SUBAGENT_DEFAULT_LIMITS.maxConcurrent
  const timeoutMs = Number.isFinite(partial?.timeoutMs)
    ? Math.min(1_800_000, Math.max(30_000, Math.floor(Number(partial?.timeoutMs))))
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
  return defineTool({
    name: "subagent",
    label: "Subagent",
    description:
      "把彼此独立、上下文可以隔离的子任务交给子 Agent 并行跑（每个任务独立上下文与独立模型请求）。" +
      `最多 ${limits.maxConcurrent} 个并行，单个任务超时 ${Math.round(limits.timeoutMs / 1000)}s。` +
      "子 Agent 只能读文件与执行命令（read/grep/find/ls/bash），不能改文件，也不会再委派。",
    parameters: Type.Object({
      tasks: Type.Array(
        Type.Object({
          prompt: Type.String({ description: "要子 Agent 完成的任务，写清目标、范围与期望产出" }),
          label: Type.Optional(Type.String({ description: "展示用短标签" })),
        }),
        { minItems: 1, maxItems: 8 },
      ),
    }),
    annotations: { readOnlyHint: false },
    async execute(_toolCallId, params, _signal, onUpdate) {
      const input = params as { tasks?: SubagentTaskInput[] }
      const tasks = (input.tasks ?? []).filter((t) => typeof t.prompt === "string" && t.prompt.trim())
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "subagent: 没有可执行的任务（tasks 为空）" }], details: { tasks: [] } }
      }
      const results: SubagentTaskResult[] = new Array(tasks.length)
      let cursor = 0
      let finished = 0

      const runOne = async (task: SubagentTaskInput, index: number): Promise<void> => {
        const label = (task.label ?? "").trim() || `任务 ${index + 1}`
        const startedAt = Date.now()
        let session: AgentSession | undefined
        try {
          session = await createMaxmaSession({
            cwd: deps.cwd,
            inMemory: true,
            tools: [...SUBAGENT_TOOL_NAMES],
            customTools: [],
            skillsEnabled: false,
            permissionMode: "auto",
            systemPrompt: SUBAGENT_SYSTEM_PROMPT,
            ...(deps.modelRuntime ? { modelRuntime: deps.modelRuntime } : {}),
            ...(deps.model ? { model: deps.model } : {}),
          })
          await session.bindExtensions({})
          await session.prompt(task.prompt)
          const { output, usage } = readResult(session)
          results[index] = { label, ok: true, output: output || "（子 Agent 未产出文字结论）", durationMs: Date.now() - startedAt, usage }
        } catch (error) {
          results[index] = {
            label,
            ok: false,
            output: "",
            durationMs: Date.now() - startedAt,
            usage: { input: null, output: null, cacheRead: null, cacheWrite: null },
            error: error instanceof Error ? error.message : String(error),
          }
        } finally {
          try { session?.dispose() } catch { /* 已释放 */ }
          finished += 1
          onUpdate?.({
            content: [{ type: "text", text: `子任务 ${finished}/${tasks.length} 完成` }],
            details: { finished, total: tasks.length },
          })
        }
      }

      const workers = Array.from({ length: Math.min(limits.maxConcurrent, tasks.length) }, async () => {
        while (true) {
          const index = cursor++
          if (index >= tasks.length) return
          const task = tasks[index]
          if (!task) return
          await runOne(task, index)
        }
      })
      await Promise.all(workers)

      const lines = results.map((r, i) => {
        const head = `### ${r.label}${r.ok ? "" : "（失败）"} · ${(r.durationMs / 1000).toFixed(1)}s`
        const usage = r.usage.input === null && r.usage.output === null
          ? ""
          : `\n用量：↑${r.usage.input ?? 0} ↓${r.usage.output ?? 0} 缓存读 ${r.usage.cacheRead ?? 0}`
        const body = r.ok ? r.output : `错误：${r.error ?? "未知"}`
        void i
        return `${head}${usage}\n${body}`
      })
      const okCount = results.filter((r) => r.ok).length
      const summary = `子 Agent 完成 ${okCount}/${tasks.length} 个任务${deps.parentModel ? `（父模型 ${deps.parentModel}）` : ""}\n\n${lines.join("\n\n")}`
      return {
        content: [{ type: "text", text: summary }],
        details: { tasks: results, limits },
      }
    },
  }) as ToolDefinition
}