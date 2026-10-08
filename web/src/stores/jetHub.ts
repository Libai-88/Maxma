/**
 * Jet Hub 管理面 store（PLUGIN-001 / P4）。
 *
 * 数据全部来自插件自己的 RPC（经 `callJetHub` → `POST /api/jet-hub`）：
 *   - 渠道清单：`GET /api/plugins/:name/providers`（真源是插件注册进 ctx.llm 的路由，
 *     **不在前端硬编码** —— 上游增删渠道时硬编码那份会静默过期）；
 *   - 渠道状态：`provider.status { providers }` → 每个渠道的模型数/账号数/开关态；
 *   - 账号明细：`account.list {}`。
 *
 * ⚠️ 读操作一律 `refresh()` 而不是增量 patch：插件侧的状态会被**后台任务**改
 * （30 分钟一轮的凭据续期、启动首轮的目录预热、自动签到），本地增量维护必然与它分叉。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { callJetHub } from '@/api'
import { request } from '@/api'
import { toErrorMessage } from '@/utils/error'
import { supportsPermanentLock } from '@/utils/jetHub/credits-capabilities.js'

export interface JetHubProviderRoute {
  id: string
  name: string
}

export interface JetHubProviderStatus {
  models: { total: number; disabled: number }
  accounts: { total: number; enabled: number }
  closed: boolean
}

export interface JetHubAccount {
  id: string
  provider: string
  nickname?: string
  enabled?: boolean
  expiresAt?: number | null
  refreshable?: boolean
  [key: string]: unknown
}

interface ProviderStatusResponse {
  statuses: Record<string, JetHubProviderStatus>
}

interface AccountListResponse {
  accounts: JetHubAccount[]
}

export interface JetHubModel {
  id: string
  name: string
  disabled: boolean
  dead: boolean
}

/**
 * 支持「浏览器授权登录」（`account.create`）的渠道。
 *
 * 真机探测的边界：`opencode` 与 `jet-hub-auto` 回 `bad-request: unknown provider`
 * —— 前者有自己的 `opencode.addAccount` 入口，后者是聚合伪路由、没有实体账号。
 * 其余 13 个渠道统一走「拿 loginUrl → 用户在浏览器授权 → 轮询 login.poll」。
 */
export const LOGIN_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set([
  'codearts',
  'buddy',
  'workbuddy',
  'lobsterai',
  'qoder',
  'qodercn',
  'trae',
  'cline',
  'loomy',
  'raccoon',
  'minimax',
  'zcode',
  'gemini',
])

export type JetHubLoginStatus = 'waiting' | 'done' | 'timeout' | 'cancelled' | 'error'

/** Token 用量合计（插件 `usage.tokenLedger` 的 totals 形状）。 */
export interface JetHubUsageTotals {
  requests: number
  reportedRequests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  errors: number
}

export interface JetHubUsageChannel {
  provider?: string
  channel?: string
  totals?: Partial<JetHubUsageTotals>
  [key: string]: unknown
}

/** 本机 OpenAI 网关状态（**全部由插件给出，前端只读不判**）。 */
export interface JetHubGatewayStatus {
  enabled: boolean
  running: boolean
  /** 被 `DSH_OPENAI_GATEWAY_ENABLED` 停用 —— 界面上改开关也不会让它监听端口。 */
  blockedByEnv: boolean
  address: string | null
  apiKey: string | null
  models?: Array<{ id: string; provider: string; model: string; name: string }>
}

export interface JetHubCreditsAccount {
  accountId?: string
  nickname?: string
  balance?: number
  unit?: string
  [key: string]: unknown
}

export interface JetHubCredits {
  accounts: JetHubCreditsAccount[]
  /** 余额统计窗口（天），插件给出（默认 15）。 */
  windowDays?: number
}

/** `credits.claimAll` 的汇总（按单位分列，不得跨单位求和）。 */
export interface JetHubClaimSummary {
  claimed: number
  totalCredit: number
  alreadyClaimed: number
  inactive: number
  failed: number
  coversToday: number
  totalByUnit: Record<string, number>
}

/** 徽标显示偏好（与插件 `BADGE_PREFERENCES` 逐字一致）。 */
export type JetHubBadgePreference = 'auto' | 'subscription' | 'credits'

/**
 * `usage.badge` 的读数。
 *
 * ⚠️ `accounts` 只含**启用**账号（停用账号不计入合计），`disabledCount` 单列 ——
 * 这是插件端点的既定语义，界面不要自己再去过滤。
 */
export interface JetHubBadgeReading {
  provider: string
  generatedAt: number
  /** 由宿主侧 TTL 缓存直接给出的读数（插件会标出来）。 */
  cached?: boolean
  accounts: Array<Record<string, unknown>>
  disabledCount?: number
  windowDays?: number
  /** 仅订阅型渠道（如 Cline）才有。 */
  subscription?: { kind?: string; accounts?: Array<Record<string, unknown>> }
  preference?: string
  autoCheckin?: Record<string, unknown>
}

/** `backup.import` 的回执（插件逐项给出的落库统计）。 */export interface JetHubImportResult {
  credentialsImported: number
  accountsImported: number
  /** ⚠️ 是**数组**（被跳过的条目明细），不是计数 —— 真机确认 `skipped: []`。 */
  skipped: unknown[]
  expiredAccounts: number
  missingCredentials: number
}

export interface JetHubLoginSession {
  provider: string
  accountId: string
  /** 交给用户在浏览器打开的授权地址（插件对 buddy 系不再自己开浏览器）。 */
  loginUrl: string
  status: JetHubLoginStatus
  message?: string
  startedAt: number
  /** 轮询次数（诊断用）。 */
  polls: number
}

const EMPTY_STATUS: JetHubProviderStatus = {
  models: { total: 0, disabled: 0 },
  accounts: { total: 0, enabled: 0 },
  closed: false,
}

export const useJetHubStore = defineStore('jetHub', () => {
  /** 插件标识（`dsh-codearts-auth` 在 Maxma 里的 id）。 */
  const pluginName = ref('codearts-auth')

  const routes = ref<JetHubProviderRoute[]>([])
  const statuses = ref<Record<string, JetHubProviderStatus>>({})
  const accounts = ref<JetHubAccount[]>([])

  const loading = ref(false)
  const error = ref('')
  /** 插件未启用/宿主未就绪时的说明（不是错误，界面据此提示「先去启用插件」）。 */
  const notReady = ref('')
  /** 正在执行的动作标识（按钮据此禁用，避免重复提交）。 */
  const pending = ref('')

  function statusOf(provider: string): JetHubProviderStatus {
    return statuses.value[provider] ?? EMPTY_STATUS
  }

  async function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    pending.value = key
    error.value = ''
    try {
      return await task()
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      pending.value = ''
    }
  }

  /** 已打开的渠道（rail 上半区），顺序即插件的自动选号优先级。 */
  const openProviders = computed(() => routes.value.filter((route) => !(statuses.value[route.id]?.closed ?? false)))
  /** 已关闭的渠道（rail 下半区）。 */
  const closedProviders = computed(() => routes.value.filter((route) => statuses.value[route.id]?.closed ?? false))

  /** 全部账号数（页头概览用）。 */
  const accountTotal = computed(() => routes.value.reduce((sum, route) => sum + (statuses.value[route.id]?.accounts.total ?? 0), 0))
  /** 已启用账号数。 */
  const accountEnabled = computed(() => routes.value.reduce((sum, route) => sum + (statuses.value[route.id]?.accounts.enabled ?? 0), 0))

  function accountsOf(provider: string): JetHubAccount[] {
    return accounts.value.filter((account) => account.provider === provider)
  }

  /** 拉取渠道清单（Maxma 后端转出插件注册的路由）。 */
  async function loadProviders() {
    const res = await request<{ providers: JetHubProviderRoute[]; detail?: string }>(
      `/plugins/${encodeURIComponent(pluginName.value)}/providers`,
    )
    routes.value = Array.isArray(res?.providers) ? res.providers : []
    notReady.value = routes.value.length === 0 ? (res?.detail || '插件尚未启用或正在启动，请稍后重试。') : ''
  }

  /** 拉取全部渠道状态 + 账号明细。 */
  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      await loadProviders()
      if (routes.value.length === 0) {
        statuses.value = {}
        accounts.value = []
        return
      }
      const ids = routes.value.map((route) => route.id)
      const [statusRes, accountRes] = await Promise.all([
        callJetHub<ProviderStatusResponse>('provider.status', { providers: ids }),
        callJetHub<AccountListResponse>('account.list', {}),
      ])
      statuses.value = statusRes?.statuses ?? {}
      accounts.value = Array.isArray(accountRes?.accounts) ? accountRes.accounts : []
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function setPluginName(name: string) {
    pluginName.value = name
  }

  // ── 模型列表（按渠道懒加载）──

  const models = ref<JetHubModel[]>([])
  const modelsLoading = ref(false)

  async function loadModels(provider: string) {
    modelsLoading.value = true
    error.value = ''
    try {
      const res = await callJetHub<{ models: JetHubModel[] }>('model.list', { provider })
      models.value = Array.isArray(res?.models) ? res.models : []
    } catch (e) {
      error.value = toErrorMessage(e)
      models.value = []
    } finally {
      modelsLoading.value = false
    }
  }

  function clearModels() {
    models.value = []
  }

  // ── 写操作 ──
  //
  // 入参形状全部来自插件自身的校验文案（真机探测：把 {} 喂进去读它的 bad-request），
  // 不是猜的：
  //   provider.setEnabled  → { provider, enabled }        「provider 与非空布尔 enabled 必填」
  //   model.setDisabled    → { provider, modelId, disabled } 「provider 与 modelId 必填」
  //   account.test/refresh → { accountId }                  「缺少 accountId」
  //   account.delete       → { accountId }
  //   account.reset        → {}                             （清限流冷却，全局）
  //
  // ⚠️ 写完全走整轮 `refresh()` / `loadModels()` 重新读，不做本地乐观更新 ——
  // 插件侧会被后台任务改（续期调度、目录预热、自动签到），乐观状态必然与它分叉。

  /** 打开/关闭一个渠道（对应插件 rail 的「已打开/已关闭」分组）。 */
  async function setProviderEnabled(provider: string, enabled: boolean) {
    await run(`provider:${provider}`, async () => {
      await callJetHub('provider.setEnabled', { provider, enabled })
      await refresh()
    })
  }

  /** 停用/启用单个模型。 */
  async function setModelDisabled(provider: string, modelId: string, disabled: boolean) {
    await run(`model:${modelId}`, async () => {
      await callJetHub('model.setDisabled', { provider, modelId, disabled })
      await loadModels(provider)
      await refresh()
    })
  }

  /** 测试单个账号（连通性 + 凭据有效性）。 */
  async function testAccount(accountId: string) {
    return await run(`test:${accountId}`, () => callJetHub('account.test', { accountId }))
  }

  /** 续期单个账号的凭据。 */
  async function refreshAccount(accountId: string) {
    return await run(`refresh:${accountId}`, async () => {
      const result = await callJetHub('account.refresh', { accountId })
      await refresh()
      return result
    })
  }

  /** 删除账号（不可逆）。 */
  async function deleteAccount(accountId: string) {
    await run(`delete:${accountId}`, async () => {
      await callJetHub('account.delete', { accountId })
      await refresh()
    })
  }

  /** 清空全部限流冷却（插件侧 account.reset）。 */
  async function resetRateLimits() {
    return await run('reset-all', async () => {
      const result = await callJetHub<{ clearedCount: number; accountCount: number }>('account.reset', {})
      await refresh()
      return result
    })
  }

  // ── 浏览器授权登录（account.create + login.poll）──
  //
  // 流程（真机 + 源码确认，13 个渠道同形）：
  //   1. `account.create { provider }` → `{ accountId, loginUrl }`，插件同时在账号池里
  //      放一条**无凭据的占位条目**，并在后台跑完整登录；
  //   2. 用户在浏览器完成授权；
  //   3. 客户端轮询 `login.poll { accountId }`，插件靠「凭据是否已写入（zcode 还查形状）」
  //      判定完成 → `{ done: true, success: true }`；
  //   4. 失败/放弃时占位条目会被插件移除，或由界面调 `account.delete` 清掉。
  //
  // ⚠️ 这条链路有**可见副作用**（插件可能拉起系统浏览器、开回环回调端口），
  // 所以刻意不放进批量动作，而是独立的一次会话 + 明确的取消入口。

  const login = ref<JetHubLoginSession | null>(null)
  let loginSeq = 0
  let settleResolve: (() => void) | null = null
  let settlePromise: Promise<void> = Promise.resolve()

  function armSettle() {
    settlePromise = new Promise<void>((resolve) => {
      settleResolve = resolve
    })
  }

  function finishSettle() {
    settleResolve?.()
    settleResolve = null
  }

  /** 等待当前登录会话走到终态（界面用于「完成后刷新」，测试用于确定性等待）。 */
  function whenLoginSettled(): Promise<void> {
    return settlePromise
  }

  function canLogin(provider: string): boolean {
    return LOGIN_CAPABLE_PROVIDERS.has(provider)
  }

  function cancelLogin() {
    if (login.value && (login.value.status === 'waiting')) {
      login.value = { ...login.value, status: 'cancelled', message: '已取消' }
      loginSeq += 1
      finishSettle()
    }
  }

  /**
   * 开始一次登录会话：拿授权地址后**立即返回**（界面马上能显示链接），
   * 轮询在后台跑，状态变化反映到 `login`。
   */
  async function beginLogin(
    provider: string,
    options?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<JetHubLoginSession> {
    const intervalMs = options?.intervalMs ?? 2000
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000

    if (!canLogin(provider)) {
      const session: JetHubLoginSession = {
        provider,
        accountId: '',
        loginUrl: '',
        status: 'error',
        message: `该渠道不支持浏览器授权登录（${provider}）`,
        startedAt: Date.now(),
        polls: 0,
      }
      login.value = session
      return session
    }

    armSettle()
    const started = await run(`login:${provider}`, () =>
      callJetHub<{ accountId: string; loginUrl: string }>('account.create', { provider }),
    )

    const session: JetHubLoginSession = {
      provider,
      accountId: started?.accountId ?? '',
      loginUrl: started?.loginUrl ?? '',
      status: 'waiting',
      startedAt: Date.now(),
      polls: 0,
    }
    login.value = session
    const seq = (loginSeq += 1)

    void pollLoginUntilDone(session.accountId, intervalMs, timeoutMs, seq)
    return session
  }

  async function pollLoginUntilDone(accountId: string, intervalMs: number, timeoutMs: number, seq: number) {
    if (!accountId) {
      if (login.value) login.value = { ...login.value, status: 'error', message: '插件未返回 accountId' }
      finishSettle()
      return
    }
    const deadline = Date.now() + timeoutMs
    let failures = 0

    try {
      // 先立即轮询一次：短流程（已授权）不必等一个间隔。
      for (;;) {
        if (seq !== loginSeq) return // 已被取消或被新会话取代
        if (Date.now() > deadline) {
          login.value = login.value
            ? { ...login.value, status: 'timeout', message: '等待授权超时，可重试或取消后重来' }
            : null
          return
        }
        const current = login.value
        if (current) login.value = { ...current, polls: current.polls + 1 }
        try {
          const res = await callJetHub<{ done: boolean }>('login.poll', { accountId })
          failures = 0
          if (res?.done === true) {
            login.value = login.value ? { ...login.value, status: 'done', message: '授权成功，账号已添加' } : null
            await refresh()
            return
          }
        } catch (e) {
          // 单次轮询失败不终结会话：插件侧登录仍在后台进行。
          failures += 1
          if (failures >= 5) {
            login.value = login.value
              ? { ...login.value, status: 'error', message: toErrorMessage(e) }
              : null
            return
          }
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
    } finally {
      finishSettle()
    }
  }

  function dismissLogin() {
    login.value = null
  }

  // ── Token 用量账本（usage.*）──

  const usage = ref<JetHubUsageTotals | null>(null)
  const usageChannels = ref<JetHubUsageChannel[]>([])
  const usageHistory = ref<Array<Record<string, unknown>>>([])
  const usageLoading = ref(false)

  async function loadUsage() {
    usageLoading.value = true
    error.value = ''
    try {
      const [ledger, history] = await Promise.all([
        callJetHub<{ snapshot?: { channels?: JetHubUsageChannel[]; totals?: JetHubUsageTotals } }>('usage.tokenLedger', {}),
        callJetHub<{ history?: Array<Record<string, unknown>>; totals?: JetHubUsageTotals }>('usage.tokenLedgerHistory', {}),
      ])
      usageChannels.value = ledger?.snapshot?.channels ?? []
      usage.value = ledger?.snapshot?.totals ?? history?.totals ?? null
      usageHistory.value = Array.isArray(history?.history) ? history.history : []
    } catch (e) {
      error.value = toErrorMessage(e)
      usage.value = null
      usageChannels.value = []
      usageHistory.value = []
    } finally {
      usageLoading.value = false
    }
  }

  // ── 本机 OpenAI 网关（gateway.*）──
  //
  // ⚠️ 开关**不是**直接调 `gateway.setEnabled`：Maxma 的宿主在装配时按插件配置
  // 设置 `DSH_OPENAI_GATEWAY_ENABLED`，插件一旦看到该 env 为停用，`setEnabled`
  // 也不会让它监听端口（它自己会在状态里回 `blockedByEnv: true`）。
  // 所以这里把开关写进**插件配置**，并如实告知需要重启后端。

  const gateway = ref<JetHubGatewayStatus | null>(null)
  const gatewayLoading = ref(false)
  /**
   * Maxma 侧设置里的网关开关（真正被这个界面写、并在装配时注入 env 的那个值）。
   *
   * ⚠️ 必须与插件自己的偏好分开：插件 `state.json` 里的 gatewayEnabled 默认是 true，
   * 而 Maxma 默认是 false —— 只看插件那份会让按钮显示成「停用网关」，
   * 用户点下去写的却已经是 false，完全对不上。
   */
  const gatewayConfigEnabled = ref(false)

  async function loadGateway() {
    gatewayLoading.value = true
    error.value = ''
    try {
      const [status, config] = await Promise.all([
        callJetHub<JetHubGatewayStatus>('gateway.getEnabled', {}),
        request<{ config: Record<string, unknown> }>(`/plugins/${encodeURIComponent(pluginName.value)}/config`),
      ])
      gateway.value = status
      gatewayConfigEnabled.value = config?.config?.gatewayEnabled === true
    } catch (e) {
      error.value = toErrorMessage(e)
      gateway.value = null
    } finally {
      gatewayLoading.value = false
    }
  }

  /** 写插件配置里的 gatewayEnabled（需重启后端生效）。 */
  async function setGatewayEnabled(enabled: boolean) {
    await run('gateway', async () => {
      const current = await request<{ config: Record<string, unknown> }>(
        `/plugins/${encodeURIComponent(pluginName.value)}/config`,
      )
      await request(`/plugins/${encodeURIComponent(pluginName.value)}/config`, {
        method: 'PUT',
        body: JSON.stringify({ config: { ...(current?.config ?? {}), gatewayEnabled: enabled } }),
      })
      await loadGateway()
    })
  }

  // ── 积分与额度（credits.*），按渠道 ──

  const credits = ref<Record<string, JetHubCredits>>({})
  const creditsLoading = ref(false)

  async function loadCredits(provider: string) {
    creditsLoading.value = true
    error.value = ''
    try {
      const res = await callJetHub<{ accounts?: JetHubCreditsAccount[]; windowDays?: number }>('credits.balances', { provider })
      credits.value = {
        ...credits.value,
        [provider]: { accounts: res?.accounts ?? [], windowDays: res?.windowDays },
      }
    } catch (e) {
      error.value = toErrorMessage(e)
      credits.value = { ...credits.value, [provider]: { accounts: [] } }
    } finally {
      creditsLoading.value = false
    }
  }

  /** 一键领取该渠道当天的积分。 */
  async function claimCredits(provider: string) {
    const result = await run(`claim:${provider}`, () =>
      callJetHub<{ summary?: JetHubClaimSummary }>('credits.claimAll', { provider }),
    )
    await loadCredits(provider)
    await refresh()
    return result
  }

  // ── 备份与迁移（backup.*）──
  //
  // ⚠️ 两条与直觉不符、但已由源码确认的事实：
  //   1. **导出含明文凭据**。真机确认 `payload.credentials."<REF>"` 是完整凭据 JSON。
  //      所以导出前必须二次确认，并提醒用户文件本身就是要害。
  //   2. **导入是「整体替换」，不是合并**。RPC `backup.import` 没有模式参数
  //      （`importBackup(credentials, pool, raw)` → `pool.replaceAll(...)`），
  //      README 里写的 replace/merge 两种模式与这个已发布版本不符。
  //      插件为此专门提供了 `backup.status`：让界面在覆盖前告知「有 N 个账号会被替换」。

  const backupStatus = ref<{ accounts: number; withoutExpiry: number } | null>(null)
  const backupBusy = ref(false)
  const backupWarnings = ref<string[]>([])
  const backupResult = ref<JetHubImportResult | null>(null)

  async function loadBackupStatus() {
    error.value = ''
    try {
      backupStatus.value = await callJetHub<{ accounts: number; withoutExpiry: number }>('backup.status', {})
    } catch (e) {
      error.value = toErrorMessage(e)
      backupStatus.value = null
    }
  }

  /** 导出快照（**含明文凭据**，调用方必须先让用户确认）。 */
  async function exportBackup() {
    backupBusy.value = true
    error.value = ''
    try {
      const res = await callJetHub<{ payload: unknown; warnings?: string[] }>('backup.export', {})
      backupWarnings.value = Array.isArray(res?.warnings) ? res.warnings : []
      return res?.payload
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      backupBusy.value = false
    }
  }

  /** 导入快照（**整体替换**当前账号池与凭据）。 */
  async function importBackup(payload: unknown) {
    backupBusy.value = true
    error.value = ''
    backupResult.value = null
    try {
      const res = await callJetHub<JetHubImportResult>('backup.import', { payload })
      backupResult.value = res ?? null
      await loadBackupStatus()
      await refresh()
      return res
    } catch (e) {
      error.value = toErrorMessage(e)
      throw e
    } finally {
      backupBusy.value = false
    }
  }

  /** 轻量校验：只认插件自己的备份格式，避免把任意 JSON 喂进「整体替换」。 */
  function looksLikeBackup(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    const format = typeof record.format === 'string' ? record.format : ''
    return format.startsWith('dsh-codearts-auth/backup') || (record.accounts !== undefined && record.credentials !== undefined)
  }

  // ── OpenCode 专属动作（opencode.*）──
  //
  // 五个方法都是 OpenCode 独有（真机确认的入参 / 回执）：
  //   addAccount {apiKey, nickname?}  → {accountId, existed}   ← **唯一不跳浏览器**的登录：手动粘贴 key
  //   addAnonymous {nickname?}        → {accountId, existed}   ← 匿名通道 = 池里一条 api_key='public' 的普通条目
  //   setProxy {accountId, proxy}     → {proxy, label}         ← 空串 = 清除（回到共享本机出口）
  //   testProxy {proxy}               → {exitIp, country, latencyMs}
  //   rotateFingerprint {accountId}   → {generation, projectId}
  //
  // ⚠️ 两条必须如实告诉用户的领域事实（插件自己写在注释里，并要求面板文案按此口径）：
  //   1. **匿名通道按出口 IP 限额，换 key / 换指纹都不增加配额** ——
  //      指纹分离的价值是「防关联」，不是「多拿额度」。要多份额度只能给不同匿名通道配不同代理。
  //   2. 手动粘贴的 key 没有 refresh_token（Zen key 不过期），插件如实标 `refreshable:false`，
  //      界面不要承诺「可自动续期」。

  /** 添加 OpenCode 账号（手动粘贴 API key，不跳浏览器）。 */
  async function addOpencodeAccount(apiKey: string, nickname?: string) {
    return await run('opencode:add', async () => {
      const result = await callJetHub<{ accountId: string; existed: boolean }>('opencode.addAccount', {
        apiKey: apiKey.trim(),
        ...(nickname?.trim() ? { nickname: nickname.trim() } : {}),
      })
      await refresh()
      return result
    })
  }

  /** 添加一条匿名通道（各走各的出口）。 */
  async function addOpencodeAnonymous(nickname?: string) {
    return await run('opencode:anon', async () => {
      const result = await callJetHub<{ accountId: string; existed: boolean }>('opencode.addAnonymous', {
        ...(nickname?.trim() ? { nickname: nickname.trim() } : {}),
      })
      await refresh()
      return result
    })
  }

  /** 设置/清除某账号的出口代理（空串 = 直连）。 */
  async function setOpencodeProxy(accountId: string, proxy: string) {
    return await run(`opencode:proxy:${accountId}`, async () => {
      const result = await callJetHub<{ proxy: string; label: string }>('opencode.setProxy', { accountId, proxy })
      await refresh()
      return result
    })
  }

  /** 测试一个代理串能否出网（成功回出口 IP 与延迟）。 */
  async function testOpencodeProxy(proxy: string) {
    return await run(`opencode:test:${proxy}`, () =>
      callJetHub<{ exitIp: string; country: string; latencyMs: number }>('opencode.testProxy', { proxy }),
    )
  }

  /** 轮换账号指纹（防关联；不影响配额）。 */
  async function rotateOpencodeFingerprint(accountId: string) {
    return await run(`opencode:fp:${accountId}`, async () => {
      const result = await callJetHub<{ generation: number; projectId: string }>('opencode.rotateFingerprint', { accountId })
      await refresh()
      return result
    })
  }

  // ── 会话内用量徽标（usage.badge / usage.badgePreference）──
  //
  // 徽标行为按插件客户端已定的口径（不是我自创的）：
  //   - **60 秒轮询**，页面隐藏时跳过；`force:true` 绕过宿主侧 TTL 缓存（手动刷新用）；
  //   - **失败保留上次读数**（插件客户端这么做：一次网络抖动不该让徽标变空）；
  //     只有「首次读数就失败且没有任何数据」才进 failed 态；
  //   - 折叠态那行文案完全交给搬运过来的 `badgeView()` 计算（口径：窗口 > 套餐包 > 积分，
  //     已由插件自带的 74 条单测锁住）。

  const badge = ref<JetHubBadgeReading | null>(null)
  /** 首次读数还没回来 —— 必须与「没有账号」区分（插件为此有过真实报障）。 */
  const badgeLoading = ref(false)
  /** 首次读数失败且无数据 —— 显示「用量不可用」而不是「未配置启用账号」。 */
  const badgeFailed = ref(false)
  const badgeError = ref('')
  const badgeProvider = ref('')
  const badgePreference = ref<JetHubBadgePreference>('auto')

  let badgeTimer: ReturnType<typeof setInterval> | null = null

  async function loadBadgeProvider(provider: string, options?: { force?: boolean }) {
    const name = String(provider ?? '').trim()
    if (!name) return null
    badgeProvider.value = name
    if (!badge.value) badgeLoading.value = true
    badgeError.value = ''
    try {
      const reading = await callJetHub<JetHubBadgeReading>('usage.badge', {
        provider: name,
        ...(options?.force ? { force: true } : {}),
      })
      badge.value = reading ?? null
      badgeFailed.value = false
      if (reading?.preference) badgePreference.value = normalizePreference(reading.preference)
      return reading
    } catch (e) {
      // ⚠️ 保留上次读数：一次抖动不该让徽标变空（插件客户端同款行为）
      badgeError.value = toErrorMessage(e)
      if (!badge.value) badgeFailed.value = true
      throw e
    } finally {
      badgeLoading.value = false
    }
  }

  function normalizePreference(value: unknown): JetHubBadgePreference {
    return value === 'subscription' || value === 'credits' ? value : 'auto'
  }

  async function loadBadgePreference() {
    try {
      const res = await callJetHub<{ preference?: string }>('usage.badgePreference', {})
      badgePreference.value = normalizePreference(res?.preference)
    } catch {
      // 偏好读不到不是致命问题，回落 auto
    }
  }

  /** 切换徽标显示偏好（插件会拒绝非法值，界面只发三种之一）。 */
  async function setBadgePreference(preference: JetHubBadgePreference) {
    const res = await run('badge:preference', async () => {
      const saved = await callJetHub<{ preference?: string }>('usage.badgePreference', { preference })
      badgePreference.value = normalizePreference(saved?.preference)
      // 偏好影响折叠态那一行，立即重读
      if (badgeProvider.value) await loadBadgeProvider(badgeProvider.value, { force: true })
      return badgePreference.value
    })
    return res
  }

  /**
   * 开始 60 秒轮询（页面隐藏时跳过）。
   * @returns 停止函数。
   */
  function startBadgePolling(provider: string, intervalMs = 60_000) {
    stopBadgePolling()
    void loadBadgeProvider(provider).catch(() => {})
    badgeTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void loadBadgeProvider(provider).catch(() => {})
    }, intervalMs)
    return stopBadgePolling
  }

  function stopBadgePolling() {
    if (badgeTimer) clearInterval(badgeTimer)
    badgeTimer = null
  }

  // ── 批量 / 排序 / 账号更新 ──
  //
  // 入参照插件的校验文案逐字对齐（真机探测）：
  //   account.retest {accountId?}          account.retestAll {}        account.resetAll {}
  //   account.update {accountId, patch}    account.reorder {provider, order}
  //   model.setAllDisabled {provider, disabled}                        model.clearDead {provider}
  //   model.setDisabledMany {provider, modelIds, disabled}
  //   provider.getOrder {}                 provider.setOrder {order: string[]}
  //   usage.autoCheckin {}                 usage.autoCheckin {enabled: boolean}

  /** 重测单个账号的连通性并清掉已恢复的限流标记。 */
  async function retestAccount(accountId: string) {
    return await run(`retest:${accountId}`, async () => {
      const result = await callJetHub('account.retest', { accountId })
      await refresh()
      return result
    })
  }

  /** 重测该渠道全部账号。 */
  async function retestAllAccounts() {
    return await run('retest-all', async () => {
      const result = await callJetHub<{ accounts?: unknown[]; clearedCount?: number }>('account.retestAll', {})
      await refresh()
      return result
    })
  }

  /** 清空全部账号的限流冷却（比单账号 account.reset 范围更广）。 */
  async function resetAllRateLimits() {
    return await run('reset-all-accounts', async () => {
      const result = await callJetHub<{ clearedCount?: number; accountCount?: number }>('account.resetAll', {})
      await refresh()
      return result
    })
  }

  /** 更新账号（改名 / 启停等；`patch` 直接交给插件的 pool.updateAccount）。 */
  async function updateAccount(accountId: string, patch: Record<string, unknown>) {
    return await run(`update:${accountId}`, async () => {
      const result = await callJetHub('account.update', { accountId, patch })
      await refresh()
      return result
    })
  }

  /** 保存账号顺序（顺序即插件自动选号的优先级）。 */
  async function reorderAccounts(provider: string, order: string[]) {
    return await run(`reorder:${provider}`, async () => {
      const result = await callJetHub('account.reorder', { provider, order })
      await refresh()
      return result
    })
  }

  /** 一键停用/启用该渠道全部模型。 */
  async function setAllModelsDisabled(provider: string, disabled: boolean) {
    return await run(`models-all:${provider}`, async () => {
      const result = await callJetHub('model.setAllDisabled', { provider, disabled })
      await loadModels(provider)
      await refresh()
      return result
    })
  }

  /** 清理「上游失效」标记（让被误判的模型重新可用）。 */
  async function clearDeadModels(provider: string) {
    return await run(`models-clear:${provider}`, async () => {
      const result = await callJetHub('model.clearDead', { provider })
      await loadModels(provider)
      await refresh()
      return result
    })
  }

  /** 批量停用/启用指定模型。 */
  async function setModelsDisabled(provider: string, modelIds: string[], disabled: boolean) {
    return await run(`models-many:${provider}`, async () => {
      const result = await callJetHub('model.setDisabledMany', { provider, modelIds, disabled })
      await loadModels(provider)
      await refresh()
      return result
    })
  }

  // ── 渠道顺序（provider.getOrder / provider.setOrder）──

  const providerOrder = ref<string[]>([])

  async function loadProviderOrder() {
    try {
      const res = await callJetHub<{ order?: string[] }>('provider.getOrder', {})
      providerOrder.value = Array.isArray(res?.order) ? res.order : []
    } catch {
      providerOrder.value = []
    }
  }

  async function saveProviderOrder(order: string[]) {
    return await run('provider-order', async () => {
      await callJetHub('provider.setOrder', { order })
      await loadProviderOrder()
      await refresh()
    })
  }

  /** 把某渠道上移/下移一位（顺序即自动选号优先级）。 */
  async function moveProvider(provider: string, delta: number) {
    const ids = routes.value.map((item) => item.id)
    const from = ids.indexOf(provider)
    if (from < 0) return
    const to = from + delta
    if (to < 0 || to >= ids.length) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    await saveProviderOrder(next)
  }

  // ── 自动签到开关（usage.autoCheckin）──

  const autoCheckin = ref<{ enabled: boolean; lastDate?: string; ranToday?: boolean; running?: boolean; lastResult?: string } | null>(null)

  async function loadAutoCheckin() {
    try {
      const res = await callJetHub<{ autoCheckin?: typeof autoCheckin.value }>('usage.autoCheckin', {})
      autoCheckin.value = res?.autoCheckin ?? null
    } catch {
      autoCheckin.value = null
    }
  }

  async function setAutoCheckin(enabled: boolean) {
    return await run('auto-checkin', async () => {
      const res = await callJetHub<{ autoCheckin?: typeof autoCheckin.value }>('usage.autoCheckin', { enabled })
      autoCheckin.value = res?.autoCheckin ?? null
      return autoCheckin.value
    })
  }

  // ── 渠道专属面板：Cline 订阅额度与请求日志 ──
  //
  // cline.quota {provider:'cline'}                 → {accounts:[…]}（订阅窗口读数）
  // cline.requestLog {provider:'cline', accountId} → {rows:[…]}
  //
  // ⚠️ 请求日志是**本插件自己发出的请求流水**（进程内存，重启即丢），不是官方 /usages ——
  // 后者记的是该账号在所有渠道的消费，没有首块时间等字段。面板文案要讲清这一点，
  // 否则用户会拿它对账。另外记录里可能有**失败行**（error 有值）：那是排查
  // 「为什么没回复」的第一线索，与成功行同表展示，不要过滤掉。

  const clineQuota = ref<{ accounts: Array<Record<string, unknown>> } | null>(null)
  const clineQuotaLoading = ref(false)
  const clineRequestLog = ref<Array<Record<string, unknown>>>([])
  const clineRequestLogLoading = ref(false)
  const clineRequestLogAccount = ref('')

  async function loadClineQuota() {
    clineQuotaLoading.value = true
    error.value = ''
    try {
      const res = await callJetHub<{ accounts?: Array<Record<string, unknown>> }>('cline.quota', { provider: 'cline' })
      clineQuota.value = { accounts: Array.isArray(res?.accounts) ? res.accounts : [] }
    } catch (e) {
      error.value = toErrorMessage(e)
      clineQuota.value = null
    } finally {
      clineQuotaLoading.value = false
    }
  }

  async function loadClineRequestLog(accountId: string, limit?: number) {
    clineRequestLogLoading.value = true
    clineRequestLogAccount.value = accountId
    error.value = ''
    try {
      const res = await callJetHub<{ rows?: Array<Record<string, unknown>> }>('cline.requestLog', {
        provider: 'cline',
        accountId,
        ...(limit ? { limit } : {}),
      })
      clineRequestLog.value = Array.isArray(res?.rows) ? res.rows : []
    } catch (e) {
      error.value = toErrorMessage(e)
      clineRequestLog.value = []
    } finally {
      clineRequestLogLoading.value = false
    }
  }

  // ── 渠道专属面板：Loomy / Raccoon 的新人任务 / 登录奖励（onboarding.*）──
  //
  // ⚠️ 这两个端点**只支持 loomy 与 raccoon**（其余渠道回 `unsupported provider`），
  // 且**必须带 accountId**。Raccoon 只有一项一次性奖励（桌面端登录奖励），
  // 插件把它映射成 Loomy 那套「任务」形状，复用同一个 RPC 与 UI。
  // ⚠️ 领取在 Raccoon 侧是**幂等**的：已领过返回 `granted:false`，
  // 此时 `earned` 必须报**累计值**而不是 0（插件记录过这个真实缺陷）。

  const onboarding = ref<{
    provider: string
    accountId: string
    tasks: Array<Record<string, unknown>>
    earned?: number
    claimed?: unknown[]
    skipped?: unknown[]
  } | null>(null)
  const onboardingLoading = ref(false)

  async function loadOnboarding(provider: string, accountId: string) {
    onboardingLoading.value = true
    error.value = ''
    try {
      const res = await callJetHub<Record<string, unknown>>('onboarding.status', { provider, accountId })
      onboarding.value = {
        provider,
        accountId,
        tasks: Array.isArray(res?.tasks) ? (res.tasks as Array<Record<string, unknown>>) : [],
        earned: typeof res?.earned === 'number' ? res.earned : undefined,
      }
    } catch (e) {
      error.value = toErrorMessage(e)
      onboarding.value = null
    } finally {
      onboardingLoading.value = false
    }
  }

  async function claimOnboarding(provider: string, accountId: string) {
    return await run(`onboarding:${accountId}`, async () => {
      const res = await callJetHub<Record<string, unknown>>('onboarding.claim', { provider, accountId })
      onboarding.value = {
        provider,
        accountId,
        tasks: onboarding.value?.tasks ?? [],
        earned: typeof res?.earned === 'number' ? res.earned : undefined,
        claimed: Array.isArray(res?.claimed) ? res.claimed : [],
        skipped: Array.isArray(res?.skipped) ? res.skipped : [],
      }
      await loadOnboarding(provider, accountId)
      await refresh()
      return res
    })
  }

  function clearAccountDetail() {
    clineRequestLog.value = []
    clineRequestLogAccount.value = ''
    onboarding.value = null
  }

  // ── 锁定永久积分（credits.permanentLock）──
  //
  // 语义（README + 插件文案）：锁上以后**只消耗**「N 天内到期」的积分包
  //（那部分再不用就作废），这类积分用尽后**没有可用账号** —— 而不是偷偷烧掉永久积分。
  //
  // ⚠️ 三条来自插件的事故记录：
  //   1. **N 必须用插件回的 `windowDays`**，不能写死 15：它可被
  //      `DSH_BUDDY_EXPIRING_WINDOW_DAYS` 覆盖，写死会让文案与实际选号判据分叉；
  //   2. **判据是「是否按到期时间分桶」不是「是不是 buddy」**：trae / lobsterai 与
  //      buddy 系走同一套分桶，若落到 Loomy 那套「每日赠送额度」文案就是错的
  //      （它们根本没有「每日额度」概念）—— 这层判断整个交给搬运过来的
  //      `permanentLockCopy()`；
  //   3. Loomy 没有窗口概念（服务端直接给两个命名池），插件对它**不回** windowDays。

  const permanentLocks = ref<Record<string, { locked: boolean; windowDays?: number }>>({})

  async function loadPermanentLock(provider: string) {
    if (!supportsPermanentLock(provider)) return
    try {
      const res = await callJetHub<{ provider: string; locked: boolean; windowDays?: number }>('credits.permanentLock', { provider })
      permanentLocks.value = {
        ...permanentLocks.value,
        [provider]: { locked: res?.locked === true, ...(typeof res?.windowDays === 'number' ? { windowDays: res.windowDays } : {}) },
      }
    } catch (e) {
      error.value = toErrorMessage(e)
    }
  }

  async function setPermanentLock(provider: string, locked: boolean) {
    return await run(`permanent-lock:${provider}`, async () => {
      const res = await callJetHub<{ locked: boolean; windowDays?: number }>('credits.permanentLock', { provider, locked })
      permanentLocks.value = {
        ...permanentLocks.value,
        [provider]: { locked: res?.locked === true, ...(typeof res?.windowDays === 'number' ? { windowDays: res.windowDays } : {}) },
      }
      return permanentLocks.value[provider]
    })
  }

  return {
    pluginName,
    routes,
    statuses,
    accounts,
    models,
    modelsLoading,
    login,
    usage,
    usageChannels,
    usageHistory,
    usageLoading,
    gateway,
    gatewayLoading,
    gatewayConfigEnabled,
    credits,
    creditsLoading,
    loading,
    error,
    notReady,
    pending,
    openProviders,
    closedProviders,
    accountTotal,
    accountEnabled,
    accountsOf,
    statusOf,
    loadProviders,
    loadModels,
    clearModels,
    loadUsage,
    loadGateway,
    setGatewayEnabled,
    loadCredits,
    claimCredits,
    backupStatus,
    backupBusy,
    backupWarnings,
    backupResult,
    loadBackupStatus,
    exportBackup,
    importBackup,
    looksLikeBackup,
    addOpencodeAccount,
    addOpencodeAnonymous,
    setOpencodeProxy,
    testOpencodeProxy,
    rotateOpencodeFingerprint,
    badge,
    badgeLoading,
    badgeFailed,
    badgeError,
    badgeProvider,
    badgePreference,
    loadBadgeProvider,
    loadBadgePreference,
    setBadgePreference,
    startBadgePolling,
    stopBadgePolling,
    retestAccount,
    retestAllAccounts,
    resetAllRateLimits,
    updateAccount,
    reorderAccounts,
    setAllModelsDisabled,
    clearDeadModels,
    setModelsDisabled,
    providerOrder,
    loadProviderOrder,
    saveProviderOrder,
    moveProvider,
    autoCheckin,
    loadAutoCheckin,
    setAutoCheckin,
    clineQuota,
    clineQuotaLoading,
    clineRequestLog,
    clineRequestLogLoading,
    clineRequestLogAccount,
    loadClineQuota,
    loadClineRequestLog,
    onboarding,
    onboardingLoading,
    loadOnboarding,
    claimOnboarding,
    clearAccountDetail,
    permanentLocks,
    loadPermanentLock,
    setPermanentLock,
    refresh,
    setPluginName,
    setProviderEnabled,
    setModelDisabled,
    testAccount,
    refreshAccount,
    deleteAccount,
    resetRateLimits,
    canLogin,
    beginLogin,
    cancelLogin,
    dismissLogin,
    whenLoginSettled,
  }
})
