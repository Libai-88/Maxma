/**
 * Jet Hub 工具面板：Token 用量 / 本机网关 / 积分（PLUGIN-001 / P4d）。
 *
 * 三个面板各有各的坑，测试逐条锁住：
 *   1. **网关开关不是直接调 `gateway.setEnabled`** —— Maxma 宿主在装配时按插件配置注入
 *      `DSH_OPENAI_GATEWAY_ENABLED`，插件看到 env 停用后 `setEnabled` 也不会监听端口
 *      （它会在状态里回 `blockedByEnv: true`）。所以开关写的是**插件配置**，并如实告知需重启。
 *   2. **积分合计按单位分列**，不得跨单位求和（插件汇总里 `totalByUnit` 就是这个道理）。
 *   3. 用量/积分读失败要走 error，且不能把上一次的数据留在界面上当成功。
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

const ROUTES = [{ id: 'trae', name: 'TRAE (字节)' }]

const TOTALS = {
  requests: 12,
  reportedRequests: 12,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 40,
  cacheWriteTokens: 0,
  reasoningTokens: 30,
  errors: 1,
}

function transport(overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: true }
    if (String(url).endsWith('/config')) return { config: { providers: { trae: { maxMode: true } } } }
    return { providers: ROUTES }
  })
  callJetHubMock.mockImplementation(async (method: string) => {
    if (method === 'provider.status') return { statuses: {} }
    if (method === 'account.list') return { accounts: [] }
    if (method in overrides) return overrides[method]
    return {}
  })
}

describe('Jet Hub 用量 / 网关 / 积分面板', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('loadUsage 同时读账本快照与历史，并抽出台账合计', async () => {
    transport({
      'usage.tokenLedger': {
        snapshot: { channels: [{ provider: 'trae', totals: { requests: 12, inputTokens: 1000 } }], totals: TOTALS },
      },
      'usage.tokenLedgerHistory': { history: [{ at: 1 }, { at: 2 }], totals: TOTALS },
    })
    const store = await loadStore()

    await store.loadUsage()

    expect(store.usage?.requests).toBe(12)
    expect(store.usage?.inputTokens).toBe(1000)
    expect(store.usageChannels).toHaveLength(1)
    expect(store.usageHistory).toHaveLength(2)
    expect(store.usageLoading).toBe(false)
  })

  it('loadUsage 失败时清空数据并记 error（不残留旧读数）', async () => {
    transport({ 'usage.tokenLedger': { snapshot: { channels: [], totals: TOTALS } } })
    const store = await loadStore()
    await store.loadUsage()
    expect(store.usage?.requests).toBe(12)

    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      throw Object.assign(new Error('账本不可读'), { code: 'jet-hub/handler-failed' })
    })
    await store.loadUsage()

    expect(store.usage).toBeNull()
    expect(store.usageChannels).toEqual([])
    expect(store.error).toBe('账本不可读')
  })

  it('loadGateway 原样呈现插件给的状态（含 blockedByEnv）', async () => {
    transport({
      'gateway.getEnabled': {
        enabled: false,
        running: false,
        blockedByEnv: true,
        address: null,
        apiKey: null,
        models: [{ id: 'trae/x', provider: 'trae', model: 'x', name: 'x' }],
      },
    })
    const store = await loadStore()

    await store.loadGateway()

    expect(store.gateway?.blockedByEnv).toBe(true)
    expect(store.gateway?.models).toHaveLength(1)
  })

  it('setGatewayEnabled 写的是插件配置（合并既有配置），而不是直接调 gateway.setEnabled', async () => {
    transport({ 'gateway.getEnabled': { enabled: true, running: false, blockedByEnv: false, address: null, apiKey: null } })
    const store = await loadStore()

    await store.setGatewayEnabled(true)

    const put = requestMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(put).toBeDefined()
    const [url, init] = put as [string, RequestInit]
    expect(String(url)).toContain('/plugins/codearts-auth/config')
    // 既有配置必须被保留（providers 覆盖项不能被这次写清掉）
    expect(JSON.parse(String(init.body))).toEqual({
      config: { providers: { trae: { maxMode: true } }, gatewayEnabled: true },
    })
    // 直接调 setEnabled 会让用户以为生效了（实际被 env 挡住），这里必须没有
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'gateway.setEnabled')).toHaveLength(0)
    // 写完重读状态
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'gateway.getEnabled').length).toBeGreaterThan(0)
  })

  it('网关开关读的是 Maxma 设置，而不是插件自己的偏好', async () => {
    // 真机就是这个组合：插件偏好 enabled=true，但 Maxma 默认关、env 把它挡住。
    // 若按钮跟着插件偏好走，会显示「停用网关」，点下去写的却已经是 false。
    requestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true }
      if (String(url).endsWith('/config')) return { config: { gatewayEnabled: false } }
      return { providers: ROUTES }
    })
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'gateway.getEnabled') {
        return { enabled: true, running: false, blockedByEnv: true, address: null, apiKey: null }
      }
      return {}
    })
    const store = await loadStore()

    await store.loadGateway()

    expect(store.gateway?.enabled).toBe(true) // 插件偏好
    expect(store.gateway?.blockedByEnv).toBe(true)
    expect(store.gatewayConfigEnabled).toBe(false) // Maxma 设置 —— 界面按钮以此为准
  })

  it('loadCredits 按渠道缓存，claimCredits 领取后重读余额与列表', async () => {
    transport({
      'credits.balances': { accounts: [{ accountId: 'trae-1', nickname: '主号', balance: 120, unit: 'credit' }], windowDays: 15 },
      'credits.claimAll': {
        results: [],
        summary: { claimed: 2, totalCredit: 120, alreadyClaimed: 1, inactive: 0, failed: 0, coversToday: 2, totalByUnit: { credit: 100, token: 20 } },
      },
    })
    const store = await loadStore()

    await store.loadCredits('trae')
    expect(store.credits.trae?.windowDays).toBe(15)
    expect(store.credits.trae?.accounts[0]?.unit).toBe('credit')

    const res = (await store.claimCredits('trae')) as { summary: { claimed: number; totalByUnit: Record<string, number> } }
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'credits.claimAll')).toEqual([['credits.claimAll', { provider: 'trae' }]])
    // 汇总按单位分列 —— 跨单位求和是插件明确禁止的做法
    expect(res.summary.totalByUnit).toEqual({ credit: 100, token: 20 })
    // 领取后要重读余额
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'credits.balances').length).toBeGreaterThan(1)
  })

  it('claimCredits 失败时抛错并清掉 pending', async () => {
    transport()
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'credits.balances') return { accounts: [] }
      throw Object.assign(new Error('unsupported provider: trae'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.claimCredits('trae')).rejects.toThrow('unsupported provider: trae')
    expect(store.error).toBe('unsupported provider: trae')
    expect(store.pending).toBe('')
  })
})

describe('Jet Hub 备份与迁移', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    requestMock.mockReset()
    callJetHubMock.mockReset()
  })

  it('backup.status 给出「将被替换」的账号数（界面覆盖前提示的依据）', async () => {
    transport({ 'backup.status': { accounts: 7, withoutExpiry: 3 } })
    const store = await loadStore()

    await store.loadBackupStatus()

    expect(store.backupStatus).toEqual({ accounts: 7, withoutExpiry: 3 })
  })

  it('exportBackup 原样返回插件快照与警告（凭据由调用方负责保护）', async () => {
    const payload = { format: 'dsh-codearts-auth/backup', version: 1, accounts: [], credentials: { REF: '{"a":1}' } }
    transport({ 'backup.export': { payload, warnings: ['有 2 个账号缺有效期'] } })
    const store = await loadStore()

    await expect(store.exportBackup()).resolves.toEqual(payload)
    expect(store.backupWarnings).toEqual(['有 2 个账号缺有效期'])
    expect(store.backupBusy).toBe(false)
  })

  it('importBackup 传整个 payload（插件侧是整体替换，没有 mode 参数）', async () => {
    transport({
      'backup.import': { credentialsImported: 5, accountsImported: 4, skipped: [{ ref: 'X' }], expiredAccounts: 2, missingCredentials: 1 },
      'backup.status': { accounts: 4, withoutExpiry: 0 },
    })
    const store = await loadStore()
    const payload = { format: 'dsh-codearts-auth/backup', version: 1, accounts: [], credentials: {} }
    await store.loadBackupStatus()
    const statusCallsBefore = callJetHubMock.mock.calls.filter(([m]) => m === 'backup.status').length

    const res = await store.importBackup(payload)

    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'backup.import')).toEqual([['backup.import', { payload }]])
    // 不得伪造一个 mode —— 接口不接受它，多传只会误导后来的人以为支持合并
    expect(Object.keys((callJetHubMock.mock.calls.find(([m]) => m === 'backup.import')?.[1] ?? {}) as object)).toEqual(['payload'])
    expect(res).toMatchObject({ accountsImported: 4, missingCredentials: 1 })
    // skipped 是数组（真机确认 `skipped: []`），不是计数
    expect(Array.isArray(store.backupResult?.skipped)).toBe(true)
    expect(store.backupResult?.skipped).toHaveLength(1)
    expect(store.backupResult?.credentialsImported).toBe(5)
    // 导入后要重读状态与账号列表（账号池被整体换掉了）
    expect(callJetHubMock.mock.calls.filter(([m]) => m === 'backup.status').length).toBeGreaterThan(statusCallsBefore)
  })

  it('looksLikeBackup 挡住非备份 JSON（避免把任意文件喂进整体替换）', async () => {
    transport()
    const store = await loadStore()

    expect(store.looksLikeBackup({ format: 'dsh-codearts-auth/backup', version: 1 })).toBe(true)
    expect(store.looksLikeBackup({ accounts: [], credentials: {} })).toBe(true)
    expect(store.looksLikeBackup({ hello: 'world' })).toBe(false)
    expect(store.looksLikeBackup(null)).toBe(false)
    expect(store.looksLikeBackup('[]')).toBe(false)
  })

  it('importBackup 失败时抛错、清 pending、不留下假的成功回执', async () => {
    transport()
    callJetHubMock.mockImplementation(async (method: string) => {
      if (method === 'provider.status') return { statuses: {} }
      if (method === 'account.list') return { accounts: [] }
      if (method === 'backup.status') return { accounts: 0, withoutExpiry: 0 }
      throw Object.assign(new Error('备份 payload 校验失败'), { code: 'bad-request' })
    })
    const store = await loadStore()

    await expect(store.importBackup({ format: 'dsh-codearts-auth/backup' })).rejects.toThrow('备份 payload 校验失败')
    expect(store.backupResult).toBeNull()
    expect(store.backupBusy).toBe(false)
    expect(store.error).toBe('备份 payload 校验失败')
  })
})
