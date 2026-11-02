/**
 * Jet Hub 浏览器授权登录（PLUGIN-001 / P4c）。
 *
 * 流程（真机 + 源码确认，13 个渠道同形）：
 *   `account.create { provider }` → `{ accountId, loginUrl }`（插件同时在账号池放一条
 *   **无凭据的占位条目**并在后台跑登录）→ 用户在浏览器授权 → 轮询 `login.poll { accountId }`
 *   直到 `{ done: true, success: true }`。
 *
 * 这里锁的是**终态与取消语义**：轮询必须能收敛（不能永远转）、取消后必须真的停、
 * 单次轮询失败不能把整个会话判死（插件侧登录还在后台跑）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const requestMock = vi.fn()
const callJetHubMock = vi.fn()

vi.mock('@/api', () => ({
  request: (...args: unknown[]) => requestMock(...args),
  callJetHub: (...args: unknown[]) => callJetHubMock(...args),
}))

async function loadStore() {
  vi.resetModules()
  const mod = await import('../src/stores/jetHub')
  return mod.useJetHubStore()
}

const ROUTES = [
  { id: 'trae', name: 'TRAE (字节)' },
  { id: 'opencode', name: 'OpenCode' },
]

function baseTransport(pollImpl: () => unknown) {
  requestMock.mockImplementation(async () => ({ providers: ROUTES }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method === 'account.create') return { accountId: 'trae-abc123', loginUrl: 'https://example.com/auth?state=xyz' }
    if (method === 'login.poll') return pollImpl()
    return {}
  })
}

function pollCount() {
  return callJetHubMock.mock.calls.filter(([m]) => m === 'login.poll').length
}

describe('Jet Hub 登录会话', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('能力边界：opencode / 聚合路由不支持浏览器登录，且不发起调用', async () => {
    baseTransport(() => ({ done: false }))
    const store = await loadStore()

    expect(store.canLogin('trae')).toBe(true)
    expect(store.canLogin('codearts')).toBe(true)
    expect(store.canLogin('qodercn')).toBe(true)
    expect(store.canLogin('opencode')).toBe(false)
    expect(store.canLogin('jet-hub-auto')).toBe(false)

    const session = await store.beginLogin('opencode')
    expect(session.status).toBe('error')
    expect(session.message).toContain('不支持浏览器授权登录')
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'account.create')).toHaveLength(0)
  })

  it('拿到授权地址后立即返回，并在轮询到 done 时收敛为成功', async () => {
    let polls = 0
    baseTransport(() => {
      polls += 1
      return polls >= 2 ? { done: true } : { done: false }
    })
    const store = await loadStore()

    const session = await store.beginLogin('trae', { intervalMs: 1, timeoutMs: 2000 })
    // 立即可见：界面马上能显示链接，不必等授权完成
    expect(session.accountId).toBe('trae-abc123')
    expect(session.loginUrl).toContain('example.com/auth')
    expect(session.status).toBe('waiting')

    await store.whenLoginSettled()

    expect(store.login?.status).toBe('done')
    expect(store.login?.polls).toBeGreaterThanOrEqual(2)
    // 成功后要重读列表，账号才会出现在界面上
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'provider.status').length).toBeGreaterThan(0)
  })

  it('超时收敛为 timeout，而不是永远轮询', async () => {
    baseTransport(() => ({ done: false }))
    const store = await loadStore()

    await store.beginLogin('trae', { intervalMs: 1, timeoutMs: 25 })
    await store.whenLoginSettled()

    expect(store.login?.status).toBe('timeout')
    expect(store.login?.message).toContain('超时')
  })

  it('取消后停止轮询，状态为 cancelled', async () => {
    baseTransport(() => ({ done: false }))
    const store = await loadStore()

    await store.beginLogin('trae', { intervalMs: 5, timeoutMs: 5000 })
    const before = pollCount()
    store.cancelLogin()
    await store.whenLoginSettled()
    const after = pollCount()

    expect(store.login?.status).toBe('cancelled')
    // 取消后最多再多一次在途轮询，不应继续增长
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(pollCount()).toBeLessThanOrEqual(after + 1)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('单次轮询失败不判死会话（插件侧登录仍在后台跑）', async () => {
    let polls = 0
    baseTransport(() => {
      polls += 1
      if (polls === 1) throw Object.assign(new Error('网关抖动'), { code: 'jet-hub/handler-failed' })
      return { done: true }
    })
    const store = await loadStore()

    await store.beginLogin('trae', { intervalMs: 1, timeoutMs: 2000 })
    await store.whenLoginSettled()

    expect(store.login?.status).toBe('done')
  })

  it('连续失败达到阈值才判 error，并带上插件文案', async () => {
    baseTransport(() => {
      throw Object.assign(new Error('未登录'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await store.beginLogin('trae', { intervalMs: 1, timeoutMs: 5000 })
    await store.whenLoginSettled()

    expect(store.login?.status).toBe('error')
    expect(store.login?.message).toContain('未登录')
  })
})
