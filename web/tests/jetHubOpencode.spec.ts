/**
 * OpenCode 专属动作（PLUGIN-001 / P6）。
 *
 * OpenCode 是本插件里形态最特殊的一个渠道：
 *   - **唯一不跳浏览器**的登录（手动粘贴 API key，`sk-` + 20 位以上）；
 *   - 有「匿名通道」概念（池里一条 api_key 为 `public` 的普通条目）；
 *   - 支持**按账号**设出口代理，以及指纹轮换。
 *
 * 测试锁两件事：入参逐字对齐插件的校验口径；以及**两个容易讲错的领域事实**
 * （重复 key 复用同一账号、指纹不增加配额）在返回值里被如实透传，
 * 界面才有机会按插件要求的口径提示用户。
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

function transport(overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async () => ({ providers: [{ id: 'opencode', name: 'OpenCode' }] }))
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method in overrides) return overrides[method]
    return {}
  })
}

function callsTo(method: string) {
  return callJetHubMock.mock.calls.filter(([m]) => m === method).map(([, payload]) => payload)
}

describe('OpenCode 专属动作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('addAccount 传 { apiKey }，并如实透传「重复 key 复用同一账号」', async () => {
    transport({ 'opencode.addAccount': { accountId: 'opencode-aaaaaaaa', existed: false } })
    const store = await loadStore()

    const fresh = await store.addOpencodeAccount('  sk-abcdefghijklmnopqrstuvwx  ')
    // 前后空白必须去掉（插件按 `key.slice(-8)` 派生账号 id，带空白会派生出不同 id）
    expect(callsTo('opencode.addAccount')).toEqual([{ apiKey: 'sk-abcdefghijklmnopqrstuvwx' }])
    expect(fresh).toEqual({ accountId: 'opencode-aaaaaaaa', existed: false })
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'provider.status').length).toBeGreaterThan(0)

    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'opencode.addAccount') return { accountId: 'opencode-aaaaaaaa', existed: true }
      return {}
    })
    const again = await store.addOpencodeAccount('sk-abcdefghijklmnopqrstuvwx')
    expect((again as { existed: boolean }).existed).toBe(true)
  })

  it('addAccount 带备注名时原样下发，空备注不下发', async () => {
    transport({ 'opencode.addAccount': { accountId: 'opencode-x', existed: false } })
    const store = await loadStore()

    await store.addOpencodeAccount('sk-abcdefghijklmnopqrstuvwx', '  主号  ')
    expect(callsTo('opencode.addAccount')).toEqual([
      { apiKey: 'sk-abcdefghijklmnopqrstuvwx', nickname: '主号' },
    ])

    await store.addOpencodeAccount('sk-abcdefghijklmnopqrstuvwx', '   ')
    expect(callsTo('opencode.addAccount')[1]).toEqual({ apiKey: 'sk-abcdefghijklmnopqrstuvwx' })
  })

  it('addAnonymous 无参调用也能建通道（插件自己起名）', async () => {
    transport({ 'opencode.addAnonymous': { accountId: 'opencode-anon-ca8ce6', existed: false } })
    const store = await loadStore()

    const res = await store.addOpencodeAnonymous()
    expect(callsTo('opencode.addAnonymous')).toEqual([{}])
    expect(res).toEqual({ accountId: 'opencode-anon-ca8ce6', existed: false })
  })

  it('setProxy 传 { accountId, proxy }，空串表示清除（回直连）', async () => {
    transport({ 'opencode.setProxy': { proxy: 'socks5://127.0.0.1:1080', label: 'SOCKS5 127.0.0.1:1080' } })
    const store = await loadStore()

    const res = await store.setOpencodeProxy('opencode-aaaaaaaa', 'socks5://127.0.0.1:1080')
    expect(callsTo('opencode.setProxy')).toEqual([{ accountId: 'opencode-aaaaaaaa', proxy: 'socks5://127.0.0.1:1080' }])
    expect((res as { label: string }).label).toContain('SOCKS5')

    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'opencode.setProxy') return { proxy: '', label: '直连（本机出口）' }
      return {}
    })
    await store.setOpencodeProxy('opencode-aaaaaaaa', '')
    expect(callsTo('opencode.setProxy')[1]).toEqual({ accountId: 'opencode-aaaaaaaa', proxy: '' })
  })

  it('testProxy 只传代理串，回执带出口 IP 与延迟', async () => {
    transport({ 'opencode.testProxy': { exitIp: '203.0.113.9', country: 'Japan', latencyMs: 412 } })
    const store = await loadStore()

    const res = await store.testOpencodeProxy('http://user:pass@host:8080')
    expect(callsTo('opencode.testProxy')).toEqual([{ proxy: 'http://user:pass@host:8080' }])
    expect(res).toMatchObject({ exitIp: '203.0.113.9', country: 'Japan', latencyMs: 412 })
    // 测试代理不改任何账号状态，不该触发列表重读
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'account.list')).toHaveLength(0)
  })

  it('rotateFingerprint 传 { accountId }，回执带新代次', async () => {
    transport({ 'opencode.rotateFingerprint': { generation: 3, projectId: 'proj-3' } })
    const store = await loadStore()

    const res = await store.rotateOpencodeFingerprint('opencode-aaaaaaaa')
    expect(callsTo('opencode.rotateFingerprint')).toEqual([{ accountId: 'opencode-aaaaaaaa' }])
    expect(res).toEqual({ generation: 3, projectId: 'proj-3' })
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'provider.status').length).toBeGreaterThan(0)
  })

  it('插件校验失败时把原文放进 error 并清掉 pending', async () => {
    transport()
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      throw Object.assign(new Error('API key 形状不对（应以 sk- 开头、至少 20 位）'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.addOpencodeAccount('nope')).rejects.toThrow('API key 形状不对')
    expect(store.error).toContain('API key 形状不对')
    expect(store.pending).toBe('')
  })
})
