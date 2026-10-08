/**
 * Jet Hub RPC 客户端（PLUGIN-001 / P2）。
 *
 * 锁的是**最容易把失败显示成成功**的那条语义：插件把错误包在
 * `result.ok === false` 里，而 HTTP 状态码仍是 200。只看状态码不看 `ok`，
 * 界面上就会「点了没反应」——或者更糟，把失败当成功继续走。
 *
 * 信封与 DSH 客户端 `connection.rpc.call('/api','jet-hub',{method,payload})` 完全同形，
 * 后端由 `plugins/dsh/http-bridge.ts` 转发到插件自己的分派器。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.mock('@/utils/env', () => ({
  ensurePortLoaded: vi.fn(async () => {}),
  // 真实实现返回的是**含 /api 前缀**的基址（真机验证：POST /api/jet-hub）。
  getApiBase: () => 'http://127.0.0.1:8000/api',
  tauriFetch: (...args: unknown[]) => fetchMock(...args),
}))

async function loadApi() {
  vi.resetModules()
  return await import('../src/api/index')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 每次调用都造**新的** Response —— Response 的 body 只能读一次。 */
function mockTransport(rpcResult: unknown, rpcOptions?: { status?: number }) {
  fetchMock.mockImplementation(async (url: unknown) => {
    // 运行时 Token 预检走同一通道，必须单独应答，否则会被当成 RPC 响应。
    if (String(url).includes('/auth/token')) return jsonResponse({ token: 'test-token' })
    return jsonResponse({ type: 'server-response', rpcId: 'r1', result: rpcResult }, rpcOptions?.status ?? 200)
  })
}

/** 取出真正打到 /api/jet-hub 的那次调用。 */
function jetHubCall() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/jet-hub'))
  expect(call, `expected a call to /api/jet-hub; saw: ${fetchMock.mock.calls.map((c) => String(c[0])).join(' | ')}`).toBeDefined()
  return call as [string, RequestInit]
}

describe('callJetHub', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('unwraps ok:true and returns the value', async () => {
    const { callJetHub } = await loadApi()
    mockTransport({ ok: true, value: { accounts: [] } })

    await expect(callJetHub('account.list', {})).resolves.toEqual({ accounts: [] })

    const sent = JSON.parse(String(jetHubCall()[1].body))
    expect(sent.type).toBe('client-request')
    expect(sent.method).toBe('jet-hub')
    expect(typeof sent.rpcId).toBe('string')
    expect(sent.payload).toEqual({ method: 'account.list', payload: {} })
  })

  it('throws JetHubError on ok:false even though HTTP is 200', async () => {
    const { callJetHub, JetHubError } = await loadApi()
    mockTransport({ ok: false, error: { code: 'bad-request', message: 'unknown method: nope', details: {} } })

    await expect(callJetHub('nope', {})).rejects.toThrow(JetHubError)
    await expect(callJetHub('nope', {})).rejects.toMatchObject({ code: 'bad-request', message: 'unknown method: nope' })
  })

  it('surfaces handler failures with their plugin error code', async () => {
    const { callJetHub } = await loadApi()
    mockTransport({ ok: false, error: { code: 'jet-hub/handler-failed', message: '未登录' } })

    await expect(callJetHub('credits.claimAll', { provider: 'trae' })).rejects.toMatchObject({
      code: 'jet-hub/handler-failed',
      message: '未登录',
    })
  })

  it('rejects a malformed envelope instead of pretending success', async () => {
    const { callJetHub } = await loadApi()
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes('/auth/token') ? jsonResponse({ token: 't' }) : jsonResponse({ unexpected: true }),
    )
    await expect(callJetHub('account.list')).rejects.toMatchObject({ code: 'gateway/bad-response' })
  })

  it('defaults a missing payload to an empty object (plugin requires the key to exist)', async () => {
    const { callJetHub } = await loadApi()
    mockTransport({ ok: true, value: { preference: 'auto' } })

    await expect(callJetHub('usage.badgePreference')).resolves.toEqual({ preference: 'auto' })

    const sent = JSON.parse(String(jetHubCall()[1].body))
    expect(sent.payload).toEqual({ method: 'usage.badgePreference', payload: {} })
  })

  it('passes the runtime token through the shared request pipeline', async () => {
    const { callJetHub } = await loadApi()
    mockTransport({ ok: true, value: 1 })

    await callJetHub('provider.status', { providers: ['codearts'] })

    const headers = jetHubCall()[1].headers as Record<string, string>
    expect(headers['X-Maxma-Token']).toBe('test-token')
    expect(headers['Content-Type']).toBe('application/json')
  })
})
