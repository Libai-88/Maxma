/**
 * tests/subagent-orchestration.test.ts — 子 Agent 编排的回归锁（SUBAGENT-TIMEOUT-001）。
 *
 * 此前 `kernel/subagent.ts` 覆盖率 0：并发上限、超时、取消三条都是用户可感知的
 * 行为，却没有任何东西拦着它们退化。更糟的是**超时只写在工具描述里**——
 * 描述告诉模型"单个任务超时 300s"，代码却从不计时，任务卡住就永远卡住。
 *
 * 这里注入假的建会话工厂（deploy 里唯一的测试缝），验证：
 *   1. 并发上限真的生效（max=2 时同时在跑的不会超过 2）；
 *   2. 超时会 abort 子会话并标记失败原因（而不是静默等着）；
 *   3. 父会话取消会把在跑的子任务一起中止；
 *   4. 空 tasks 直接返回提示，不建会话；
 *   5. 结果结构（details.tasks）与文案形状稳定。
 */

import { describe, expect, test } from "bun:test";

import {
  SUBAGENT_CANCEL_MESSAGE,
  SUBAGENT_TIMEOUT_PREFIX,
  createSubagentTool,
} from "../src/kernel/subagent";

type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
  onUpdate?: (update: unknown) => void,
) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;

interface FakeSession {
  messages: Array<{ role: string; content: string; usage?: Record<string, number> }>;
  promptStarted: number;
  aborted: number;
  disposed: number;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

/**
 * 假子会话：prompt 挂起直到 abort（与真实 pi 的"abort 让 prompt 结束"一致）。
 * `finishAfterMs` 为 0 表示永不自行结束——正好用来逼出超时/取消路径。
 * 旧实现没有计时器，这个用例会一直挂到 bun 的用例超时，从而失败。
 */
function makeFakeSession(finishAfterMs = 0): FakeSession {
  let release: (() => void) | null = null
  const session: FakeSession = {
    messages: [{ role: "assistant", content: "子任务完成", usage: { input: 10, output: 4 } }],
    promptStarted: 0,
    aborted: 0,
    disposed: 0,
    prompt(_text: string) {
      session.promptStarted += 1
      return new Promise<void>((resolve) => {
        release = resolve
        if (finishAfterMs > 0) setTimeout(resolve, finishAfterMs)
      })
    },
    async abort() {
      session.aborted += 1
      release?.()
    },
    dispose() {
      session.disposed += 1
    },
  }
  return session
}

function executeOf(tool: unknown): ToolExecute {
  return (tool as { execute: ToolExecute }).execute.bind(tool)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("并发上限", () => {
  test("maxConcurrent=2 时任意时刻最多 2 个子会话在跑，5 个任务全部执行", async () => {
    let active = 0
    let peak = 0
    const started: number[] = []
    const sessions: FakeSession[] = []
    const gate = deferred()

    const tool = createSubagentTool({
      cwd: process.cwd(),
      limits: { maxConcurrent: 2, timeoutMs: 1_000 },
      createSession: async () => {
        active += 1
        peak = Math.max(peak, active)
        started.push(Date.now())
        const session = makeFakeSession(0)
        const dispose = session.dispose.bind(session)
        session.dispose = () => {
          active -= 1
          dispose()
        }
        sessions.push(session)
        // prompt 挂起到手动放行：这样并发窗口能被稳定观察到
        session.prompt = async () => {
          await gate.promise
        }
        return session as never
      },
    })

    const run = executeOf(tool)("call-1", {
      tasks: Array.from({ length: 5 }).map((_, i) => ({ prompt: `任务 ${i}`, label: `L${i}` })),
    })

    // 让前两个 worker 起来
    await new Promise((r) => setTimeout(r, 60))
    expect(active).toBe(2)
    expect(started.length).toBe(2)

    gate.resolve()
    // 放行后剩下的任务继续，但仍是串行补位，峰值不会超过 2
    const result = await run
    expect(peak).toBeLessThanOrEqual(2)
    expect(sessions.length).toBe(5)
    const tasks = (result.details as { tasks: Array<{ ok: boolean }> }).tasks
    expect(tasks).toHaveLength(5)
    expect(tasks.every((t) => t.ok)).toBe(true)
  })
})

describe("超时", () => {
  test("子任务卡住不动 → 到时限 abort，并标记为超时失败", async () => {
    const session = makeFakeSession(0)
    const tool = createSubagentTool({
      cwd: process.cwd(),
      limits: { maxConcurrent: 1, timeoutMs: 1_000 },
      createSession: async () => session as never,
    })

    const startedAt = Date.now()
    const result = await executeOf(tool)("call-2", { tasks: [{ prompt: "永不结束的任务", label: "slow" }] })
    const elapsed = Date.now() - startedAt

    // 不能无限挂着：旧实现没有计时器，这里会直接超时失败
    expect(elapsed).toBeGreaterThanOrEqual(900)
    expect(elapsed).toBeLessThan(5_000)
    expect(session.aborted).toBeGreaterThan(0)
    expect(session.disposed).toBe(1)

    const tasks = (result.details as { tasks: Array<{ ok: boolean; error?: string; label: string }> }).tasks
    expect(tasks[0]!.ok).toBe(false)
    expect(tasks[0]!.label).toBe("slow")
    expect(tasks[0]!.error).toContain(SUBAGENT_TIMEOUT_PREFIX)
    expect(result.content[0]!.text).toContain("失败")
  })
})

describe("取消", () => {
  test("父会话 abort → 在跑的子任务全部中止并给出取消原因", async () => {
    const sessions: FakeSession[] = []
    const tool = createSubagentTool({
      cwd: process.cwd(),
      limits: { maxConcurrent: 2, timeoutMs: 10_000 },
      createSession: async () => {
        const s = makeFakeSession(0)
        sessions.push(s)
        return s as never
      },
    })

    const controller = new AbortController()
    const run = executeOf(tool)("call-3", {
      tasks: [{ prompt: "a" }, { prompt: "b" }, { prompt: "c" }],
    }, controller.signal)

    await new Promise((r) => setTimeout(r, 80))
    controller.abort()
    const result = await run

    expect(sessions.length).toBe(2)
    expect(sessions.every((s) => s.aborted > 0)).toBe(true)
    expect(sessions.every((s) => s.disposed === 1)).toBe(true)

    const tasks = (result.details as { tasks: Array<{ ok: boolean; error?: string }> }).tasks
    expect(tasks).toHaveLength(3)
    for (const t of tasks) {
      expect(t.ok).toBe(false)
      expect(t.error).toBe(SUBAGENT_CANCEL_MESSAGE)
    }
  })

  test("进来之前就已经 abort：一个子会话都不建", async () => {
    let created = 0
    const tool = createSubagentTool({
      cwd: process.cwd(),
      createSession: async () => {
        created += 1
        return makeFakeSession(10) as never
      },
    })
    const controller = new AbortController()
    controller.abort()
    const result = await executeOf(tool)("call-4", { tasks: [{ prompt: "x" }] }, controller.signal)
    expect(created).toBe(0)
    const tasks = (result.details as { tasks: Array<{ ok: boolean; error?: string }> }).tasks
    expect(tasks[0]!.error).toBe(SUBAGENT_CANCEL_MESSAGE)
  })
})

describe("输入边界与结果结构", () => {
    test("空 tasks → 提示文案，不建会话", async () => {
        let created = 0
        const tool = createSubagentTool({
            cwd: process.cwd(),
            createSession: async () => {
                created += 1
                return makeFakeSession(10) as never
            },
        })
        const result = await executeOf(tool)("call-5", { tasks: [] })
        expect(created).toBe(0)
        expect(result.content[0]!.text).toContain("没有可执行的任务")
    })

    test("正常完成 → 汇总包含成功计数与用量，details 带 limits", async () => {
        const tool = createSubagentTool({
            cwd: process.cwd(),
            limits: { maxConcurrent: 4, timeoutMs: 60_000 },
            parentModel: "claude-test",
            createSession: async () => makeFakeSession(5) as never,
        })
        const result = await executeOf(tool)("call-6", { tasks: [{ prompt: "x" }, { prompt: "y", label: "Y" }] })
        const text = result.content[0]!.text
        expect(text).toContain("完成 2/2 个任务")
        expect(text).toContain("父模型 claude-test")
        expect(text).toContain("用量：↑10 ↓4")
        const details = result.details as { limits: { maxConcurrent: number; timeoutMs: number }; tasks: unknown[] }
        expect(details.limits).toEqual({ maxConcurrent: 4, timeoutMs: 60_000 })
        expect(details.tasks).toHaveLength(2)
    })

    test("参数归一：越界的并发/超时会被夹到合法区间", () => {
        const tool = createSubagentTool({
            cwd: process.cwd(),
            limits: { maxConcurrent: 0, timeoutMs: 1 },
        })
        const description = (tool as { description: string }).description
        expect(description).toContain("最多 1 个并行")
        expect(description).toContain("超时 1s")
    })
})
