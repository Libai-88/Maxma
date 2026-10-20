/**
 * useAgentTasks —— 后台子任务真实数据源的契约测试。
 *
 * ## 为什么有这份测试
 *
 * 上一版「Agent 前端重构」把 /agent-demo 做成了纯 mock 演示页：数据写死在
 * 组件里，与后端 deferred-runs 接口毫无关系，还凭空造了后端并不存在的
 * 「暂停全部 / 恢复全部」按钮。文档却宣称「与 pi 后端高度集成」。
 *
 * 这份测试锁住真正要紧的性质：
 *   1. 读的是真接口（listDeferredRuns），不是本地假数据；
 *   2. 时间戳单位换算正确（后端存**秒**，UI 用毫秒）；
 *   3. 取消真的打 cancelDeferredRun，且只影响目标任务；
 *   4. 取消后不再轮询（终态任务不产生无谓请求）；
 *   5. 端点 404 → 判定「能力不可用」，而不是抛错给用户看。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'

const { listDeferredRuns, cancelDeferredRun } = vi.hoisted(() => ({
  listDeferredRuns: vi.fn(),
  cancelDeferredRun: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { listDeferredRuns, cancelDeferredRun },
}))

import { useAgentTasks } from '@/composables/useAgentTasks'

/** 后端 Browser-safe 投影（`DeferredRun`）。注意时间戳是**秒**。 */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'run-1',
    parent_turn_id: 'turn-1',
    status: 'running' as const,
    result_ref: null,
    result: null,
    cancel_reason: null,
    deadline_at: null,
    attempts: 1,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_005,
    ...overrides,
  }
}

/** 把 composable 挂到一个宿主组件上，以便在测试里驱动响应式更新。 */
function mountComposable(sessionId: () => string, autoRefresh?: boolean) {
  let api!: ReturnType<typeof useAgentTasks>
  const Host = defineComponent({
    setup() {
      api = useAgentTasks({
        sessionId,
        ...(autoRefresh === undefined ? {} : { autoRefresh }),
      })
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { api, wrapper }
}

describe('useAgentTasks', () => {
  beforeEach(() => {
    listDeferredRuns.mockReset()
    cancelDeferredRun.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('读取真实接口而不是本地假数据', async () => {
    listDeferredRuns.mockResolvedValue({ runs: [makeRun()] })

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.tasks.value).toHaveLength(1))

    expect(listDeferredRuns).toHaveBeenCalledWith('session-1')
    expect(api.tasks.value[0].run_id).toBe('run-1')
  })

  it('把后端的秒级时间戳换算成毫秒', async () => {
    listDeferredRuns.mockResolvedValue({ runs: [makeRun()] })

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.tasks.value).toHaveLength(1))

    const task = api.tasks.value[0]
    expect(task.created_at).toBe(1_700_000_000_000)
    expect(task.updated_at).toBe(1_700_000_005_000)
    // 持续时间 = updated - created = 5 秒
    expect(task.duration).toBe(5_000)
  })

  it('运行中的任务可取消，终态任务不可取消', async () => {
    listDeferredRuns.mockResolvedValue({
      runs: [
        makeRun({ run_id: 'run-active', status: 'running' }),
        makeRun({ run_id: 'run-done', status: 'succeeded' }),
        makeRun({ run_id: 'run-queued', status: 'queued' }),
        makeRun({ run_id: 'run-failed', status: 'failed' }),
      ],
    })

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.tasks.value).toHaveLength(4))

    const byId = Object.fromEntries(api.tasks.value.map(t => [t.run_id, t]))
    expect(byId['run-active'].cancellable).toBe(true)
    expect(byId['run-queued'].cancellable).toBe(true)
    expect(byId['run-done'].cancellable).toBe(false)
    expect(byId['run-failed'].cancellable).toBe(false)
    expect(api.activeCount.value).toBe(2)
  })

  it('取消只影响目标任务，并写入后端返回的新状态', async () => {
    listDeferredRuns.mockResolvedValue({ runs: [makeRun({ run_id: 'run-1' })] })
    cancelDeferredRun.mockResolvedValue(
      makeRun({ run_id: 'run-1', status: 'cancelled', cancel_reason: 'cancelled_by_user' })
    )

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.tasks.value).toHaveLength(1))

    await api.cancel('run-1')

    expect(cancelDeferredRun).toHaveBeenCalledWith('session-1', 'run-1')
    expect(api.tasks.value[0].status).toBe('cancelled')
    expect(api.tasks.value[0].cancel_reason).toBe('cancelled_by_user')
    expect(api.tasks.value[0].cancellable).toBe(false)
  })

  it('取消全部时逐个调用取消端点', async () => {
    listDeferredRuns.mockResolvedValue({
      runs: [
        makeRun({ run_id: 'run-1', status: 'running' }),
        makeRun({ run_id: 'run-2', status: 'queued' }),
        makeRun({ run_id: 'run-3', status: 'succeeded' }),
      ],
    })
    cancelDeferredRun.mockImplementation(async (_s: string, runId: string) =>
      makeRun({ run_id: runId, status: 'cancelled' })
    )

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.tasks.value).toHaveLength(3))

    await api.cancelAll()

    // 只取消两个活跃任务，已完成的不动。
    expect(cancelDeferredRun).toHaveBeenCalledTimes(2)
    const cancelled = cancelDeferredRun.mock.calls.map(c => c[1]).sort()
    expect(cancelled).toEqual(['run-1', 'run-2'])
  })

  it('全部任务终态后不再轮询', async () => {
    listDeferredRuns.mockResolvedValue({
      runs: [makeRun({ run_id: 'run-1', status: 'succeeded' })],
    })

    mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledTimes(1))

    vi.advanceTimersByTime(20_000)
    await nextTick()

    // 无活跃任务 → 不该有第二次请求
    expect(listDeferredRuns).toHaveBeenCalledTimes(1)
  })

  it('存在活跃任务时按间隔轮询', async () => {
    listDeferredRuns.mockResolvedValue({
      runs: [makeRun({ run_id: 'run-1', status: 'running' })],
    })

    mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledTimes(1))

    vi.advanceTimersByTime(4_100)
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledTimes(2))
  })

  it('端点 404 时判定为能力不可用，而不是抛错', async () => {
    listDeferredRuns.mockRejectedValue(new Error('API 请求失败 (404)'))

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.unavailable.value).toBe(true))

    expect(api.error.value).toBeNull()
    expect(api.tasks.value).toEqual([])
  })

  it('其它错误记入 error 供界面提示', async () => {
    listDeferredRuns.mockRejectedValue(new Error('network down'))

    const { api } = mountComposable(() => 'session-1')
    await nextTick()
    await vi.waitFor(() => expect(api.error.value).toBe('network down'))

    expect(api.unavailable.value).toBe(false)
  })

  it('切换会话后重新拉取该会话的任务', async () => {
    listDeferredRuns.mockResolvedValue({ runs: [] })

    // 用 ref 模拟真实场景：sessionId 来自 session store，是响应式的。
    const sessionId = ref('session-1')
    const { api } = mountComposable(() => sessionId.value)
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledWith('session-1'))

    sessionId.value = 'session-2'
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledWith('session-2'))
  })

  it('会话切换后，切换前的慢响应不会污染新会话的任务列表', async () => {
    // 竞态：session-1 的请求在途时用户切到 session-2。
    // session-1 的响应后到，若不校验就会把 session-2 的任务列表覆盖成 session-1 的。
    const sessionId = ref('session-1')

    let resolveFirst: (v: unknown) => void = () => {}
    listDeferredRuns.mockImplementationOnce(
      () => new Promise(resolve => { resolveFirst = resolve })
    )
    listDeferredRuns.mockResolvedValue({
      runs: [makeRun({ run_id: 'session-2-run' })],
    })

    const { api } = mountComposable(() => sessionId.value)
    await nextTick()
    expect(listDeferredRuns).toHaveBeenCalledWith('session-1')

    // 切到 session-2，并让它的请求先返回
    sessionId.value = 'session-2'
    await nextTick()
    await vi.waitFor(() => expect(listDeferredRuns).toHaveBeenCalledWith('session-2'))
    await vi.waitFor(() => expect(api.tasks.value[0]?.run_id).toBe('session-2-run'))

    // 现在 session-1 的慢响应才回来——必须被丢弃
    resolveFirst({ runs: [makeRun({ run_id: 'session-1-run' })] })
    await nextTick()
    await nextTick()

    expect(api.tasks.value[0]?.run_id).toBe('session-2-run')
  })
})
