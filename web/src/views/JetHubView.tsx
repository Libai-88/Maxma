import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Puzzle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { callJetHub } from '@/api'
import { toErrorMessage } from '@/utils/error'
import { useJetHubStore, type JetHubAccount } from '@/stores/jetHub'
import { disablingLeavesNoEnabledAccount } from '@/utils/jetHub/account-model-link.js'
import {
  supportsAccountTest,
  supportsCreditBalance,
  supportsDailyCheckin,
  supportsOnboardingTasks,
  supportsPermanentLock,
  supportsRateLimit,
  supportsSubscriptionQuota,
  permanentLockCopy,
} from '@/utils/jetHub/credits-capabilities.js'
import { creditGroupsOf } from '@/utils/jetHub/badge-model.js'
import { formatUnits } from '@/utils/jetHub/credits-format.js'

/**
 * Jet Hub 管理界面（等价移植自 JetHubView.vue）。
 * 路由挂在 `/plugins/:name/jet-hub` 下，从插件详情页进入。
 * 渠道清单/状态/账号/模型/积分等一律走 useJetHubStore（其内部 RPC 均经
 * `callJetHub` → POST /api/jet-hub）；Token 用量面板直接用 callJetHub 读取账本。
 * 能力门控一律走搬运过来的 credits-capabilities 矩阵，不自己写 provider === 'xxx'。
 */

// jetHub store 由另一个 agent 同时产出（对外成员沿用旧 store 同名）。
// 这里按对外契约声明本视图消费的成员；未逐项声明的 action 走宽松类型，
// 以保证在 store 精确类型落地前本文件也能独立通过 tsc。
interface RouteItem {
  id: string
  name: string
}

interface ProviderStatus {
  models: { total: number; disabled: number }
  accounts: { total: number; enabled: number }
  closed: boolean
}

type AccountRow = JetHubAccount

function fmtTs(ts: unknown): string {
  const n = typeof ts === 'number' ? ts : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const at = new Date(n)
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')}`
}

function fmtNumber(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

/** Cline 订阅额度行：真实结构是 { accountId, nickname, ok, windows[], error? }。 */
function clineQuotaLine(row: Record<string, unknown>): string {
  if (row.error) return String(row.error)
  const windows = Array.isArray(row.windows) ? (row.windows as Array<Record<string, unknown>>) : []
  if (windows.length === 0) return row.ok === false ? '读取失败' : '—'
  return windows
    .map((w) => {
      const label = String(w.label ?? w.type ?? '窗口')
      const percent = typeof w.percentUsed === 'number' ? `${Math.round(w.percentUsed)}%` : '—'
      return `${label} ${percent}`
    })
    .join(' · ')
}

/** Cline 请求日志行尾（token 用量 + 延迟）。 */
function clineLogTail(row: Record<string, unknown>): string {
  if (row.error) return String(row.error)
  const parts: string[] = []
  if (row.usageReported === false) {
    parts.push('用量未上报')
  } else {
    const inTok = Number(row.inputTokens)
    const outTok = Number(row.outputTokens)
    if (Number.isFinite(inTok) || Number.isFinite(outTok)) parts.push(`↑${fmtNumber(inTok)} ↓${fmtNumber(outTok)}`)
  }
  const ttft = Number(row.ttftMs)
  if (Number.isFinite(ttft) && ttft > 0) parts.push(`首块 ${Math.round(ttft)}ms`)
  const ttfc = Number(row.ttfcMs)
  if (Number.isFinite(ttfc) && ttfc > 0) parts.push(`首字 ${Math.round(ttfc)}ms`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** 一个账号的余额文案：余额在 balance.total，单位在 packages[].unit。 */
function creditLine(entry: Record<string, unknown>): string {
  const balance = entry?.balance as { total?: unknown; packages?: unknown } | undefined
  if (!balance || typeof balance.total !== 'number' || !Number.isFinite(balance.total)) return '未读取到'
  const { groups } = creditGroupsOf([entry])
  const group = groups[0]
  if (group) {
    if (Array.isArray(group.quotaLines) && group.quotaLines.length > 0) return group.quotaLines.join(' · ')
    return `${formatUnits(group.total, group.unit)}${group.label}`
  }
  return formatUnits(balance.total, '')
}

function fmtExpiry(account: Record<string, unknown>): string {
  const raw = account.expiresAt
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return '未知'
  const at = new Date(raw)
  const expired = raw <= Date.now()
  const text = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return expired ? `${text}（已过期）` : text
}

export default function JetHubView() {
  const { name } = useParams<{ name: string }>()
  const pluginName = name ?? ''
  const store = useJetHubStore()

  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [showUsage, setShowUsage] = useState(false)
  const [showGateway, setShowGateway] = useState(false)
  const [showBackup, setShowBackup] = useState(false)
  const [pendingImport, setPendingImport] = useState<Record<string, unknown> | null>(null)
  const [claimSummary, setClaimSummary] = useState<Record<string, unknown> | null>(null)

  // OpenCode 专属
  const [ocApiKey, setOcApiKey] = useState('')
  const [ocNickname, setOcNickname] = useState('')
  const [proxyEditing, setProxyEditing] = useState('')
  const [proxyDraft, setProxyDraft] = useState('')
  const [proxyTestResult, setProxyTestResult] = useState<Record<string, string>>({})

  // Token 用量（直接走 callJetHub 的 usage.tokenLedger / usage.tokenLedgerHistory）
  const [usageTotals, setUsageTotals] = useState<Record<string, unknown> | null>(null)
  const [usageChannels, setUsageChannels] = useState<Array<Record<string, unknown>>>([])
  const [usageHistory, setUsageHistory] = useState<unknown[]>([])
  const [usageLoading, setUsageLoading] = useState(false)

  const allProviders: RouteItem[] = [...store.openProviders(), ...store.closedProviders()]
  const current: RouteItem | null = allProviders.find((item) => item.id === selected) ?? allProviders[0] ?? null
  const currentStatus: ProviderStatus | null = current ? store.statusOf(current.id) : null
  const currentAccounts: AccountRow[] = current ? store.accountsOf(current.id) : []
  const currentCredits = current ? store.credits?.[current.id] : undefined
  const isOpencode = current?.id === 'opencode'

  // 能力门控：一律走搬运过来的能力矩阵，不自己写 provider === 'xxx'
  const providerId = current?.id ?? ''
  const canCreditBalance = supportsCreditBalance(providerId)
  const canDailyCheckin = supportsDailyCheckin(providerId)
  const canOnboarding = supportsOnboardingTasks(providerId)
  const canSubscriptionQuota = supportsSubscriptionQuota(providerId)
  const canRateLimit = supportsRateLimit(providerId)
  const canAccountTest = supportsAccountTest(providerId)
  const isCline = canSubscriptionQuota
  const canPermanentLock = supportsPermanentLock(providerId)
  const permanentLockState = current ? store.permanentLocks?.[current.id] : undefined
  const permanentLockText = permanentLockCopy(providerId, permanentLockState?.windowDays)

  async function guard(label: string, task: () => Promise<unknown>) {
    setNotice('')
    try {
      await task()
      setNotice(`${label}完成`)
    } catch (e) {
      setNotice(`${label}失败：${toErrorMessage(e)}`)
    }
  }

  async function refresh() {
    store.clearModels()
    await store.refresh()
  }

  function selectProvider(id: string) {
    setSelected(id)
    store.clearModels()
    setNotice('')
    setClaimSummary(null)
    store.clearAccountDetail()
    if (id) {
      // 门控自动请求：不对不支持的 provider 发必然失败的请求
      if (supportsCreditBalance(id)) void guard('读取积分', () => store.loadCredits(id))
      if (supportsPermanentLock(id)) void store.loadPermanentLock(id)
    }
  }

  useEffect(() => {
    store.setPluginName(pluginName)
    void refresh()
  }, [pluginName]) // eslint-disable-line react-hooks/exhaustive-deps

  // 登录状态回执（对应旧视图 watch(() => store.login?.status)）
  useEffect(() => {
    const status = store.login?.status
    if (status === 'done') setNotice('授权成功，账号已添加')
    else if (status === 'timeout') setNotice('等待授权超时')
    else if (status === 'cancelled') setNotice('已取消登录')
  }, [store.login?.status])

  // ── Cline / 新人任务 ──
  function openClineQuota() {
    void guard('读取订阅额度', () => store.loadClineQuota())
  }
  function openClineLog(accountId: string) {
    void guard('读取请求日志', () => store.loadClineRequestLog(accountId, 50))
  }
  function openOnboarding(accountId: string) {
    if (!current) return
    void guard('读取任务状态', () => store.loadOnboarding(current.id, accountId))
  }
  async function claimOnboarding(accountId: string) {
    if (!current) return
    const id = current.id
    await guard('领取奖励', async () => {
      const res = (await store.claimOnboarding(id, accountId)) as { earned?: number }
      setNotice(`领取完成${typeof res?.earned === 'number' ? `，累计 ${res.earned}` : ''}`)
    })
  }

  async function togglePermanentLock() {
    if (!current) return
    const id = current.id
    const next = !(permanentLockState?.locked ?? false)
    await guard(next ? '锁定永久积分' : '解锁永久积分', async () => {
      const state = (await store.setPermanentLock(id, next)) as { locked?: boolean }
      setNotice(state?.locked ? permanentLockText.lockedNotice : permanentLockText.unlockedNotice)
    })
  }

  // ── Token 用量（直接 callJetHub） ──
  function toggleUsage() {
    const next = !showUsage
    setShowUsage(next)
    if (next) {
      void guard('读取用量', async () => {
        setUsageLoading(true)
        try {
          const [ledger, history] = await Promise.all([
            callJetHub<{ snapshot?: { channels?: Array<Record<string, unknown>>; totals?: Record<string, unknown> } }>('usage.tokenLedger', {}),
            callJetHub<{ history?: unknown[]; totals?: Record<string, unknown> }>('usage.tokenLedgerHistory', {}),
          ])
          setUsageChannels(ledger?.snapshot?.channels ?? [])
          setUsageTotals(ledger?.snapshot?.totals ?? history?.totals ?? null)
          setUsageHistory(history?.history ?? [])
        } finally {
          setUsageLoading(false)
        }
      })
    }
  }

  // ── 本机网关 ──
  function toggleGateway() {
    const next = !showGateway
    setShowGateway(next)
    if (next) void guard('读取网关状态', () => store.loadGateway())
  }
  async function toggleGatewayEnabled() {
    const next = !store.gatewayConfigEnabled
    await guard(next ? '启用本机网关' : '停用本机网关', async () => {
      await store.setGatewayEnabled(next)
      setNotice(`${next ? '已启用' : '已停用'}本机网关（需重启后端生效）`)
    })
  }

  // ── 积分 ──
  function refreshCredits() {
    if (!current) return
    void guard('刷新积分', () => store.loadCredits(current.id))
  }
  async function claimCredits() {
    if (!current) return
    const id = current.id
    await guard('一键领取积分', async () => {
      const res = (await store.claimCredits(id)) as { summary?: Record<string, unknown> }
      const summary = res?.summary ?? null
      setClaimSummary(summary)
      if (summary) {
        const units = Object.entries((summary.totalByUnit as Record<string, unknown>) ?? {})
          .filter(([, v]) => Number(v) > 0)
          .map(([unit, v]) => `${fmtNumber(v)} ${unit}`)
          .join(' + ')
        setNotice(`领取完成：${summary.claimed} 个账号${units ? `，合计 ${units}` : ''}`)
      }
    })
  }

  // ── 备份与迁移 ──
  function toggleBackup() {
    const next = !showBackup
    setShowBackup(next)
    if (next) void guard('读取备份状态', () => store.loadBackupStatus())
  }
  async function doExportBackup() {
    const status = store.backupStatus
    const ok = await confirmAction({
      title: '导出备份',
      message:
        `即将导出${status ? ` ${status.accounts} 个` : ''}账号的完整快照。\n\n` +
        '⚠️ 文件里包含**明文凭据**（令牌 / refresh token），任何拿到它的人都能直接使用这些账号，' +
        '请只保存在可信位置，不要提交到仓库或发给别人。',
      confirmText: '导出',
      danger: true,
    })
    if (!ok) return
    await guard('导出备份', async () => {
      const payload = await store.exportBackup()
      const text = JSON.stringify(payload, null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const stamp = new Date().toISOString().slice(0, 10)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `jet-hub-backup-${stamp}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice(`已导出备份（${store.backupWarnings?.length ? `${store.backupWarnings.length} 条提示，见下方` : '无异常'}）`)
    })
  }
  async function onBackupFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!store.looksLikeBackup(parsed)) {
        setNotice('这个文件不是 Jet Hub 备份（缺少 format/accounts 字段），已拒绝导入')
        return
      }
      setPendingImport(parsed)
      setNotice(`已读取 ${file.name}，确认后才会写入`)
    } catch (e) {
      setNotice(`读取失败：${toErrorMessage(e)}`)
    }
  }
  async function doImportBackup() {
    if (!pendingImport) return
    const status = store.backupStatus
    const ok = await confirmAction({
      title: '导入备份',
      message:
        '⚠️ 导入是**整体替换**，不是合并：当前账号池会被快照里的内容取代' +
        `${status ? `（当前 ${status.accounts} 个账号将被替换）` : ''}。\n\n` +
        '凭据与模型黑名单都会一并还原。此操作不可撤销。',
      confirmText: '导入',
      danger: true,
    })
    if (!ok) return
    await guard('导入备份', async () => {
      const result = await store.importBackup(pendingImport)
      setPendingImport(null)
      setNotice(
        result
          ? `导入完成：凭据 ${result.credentialsImported} 条、账号 ${result.accountsImported} 个` +
              `${Array.isArray(result.skipped) && result.skipped.length ? `，跳过 ${result.skipped.length}` : ''}${result.expiredAccounts ? `，已过期 ${result.expiredAccounts}` : ''}` +
              `${result.missingCredentials ? `，缺凭据 ${result.missingCredentials}` : ''}`
          : '导入完成',
      )
    })
  }

  // ── OpenCode 专属动作 ──
  async function submitOpencodeAccount() {
    const key = ocApiKey.trim()
    if (!key) {
      setNotice('请先粘贴 API key（sk- 开头）')
      return
    }
    await guard('添加 OpenCode 账号', async () => {
      const res = (await store.addOpencodeAccount(key, ocNickname)) as { accountId: string; existed: boolean }
      setNotice(
        res?.existed
          ? `该 key 已存在，复用账号 ${res.accountId}（同一份额度，不会变成两个桶）`
          : `已添加账号 ${res?.accountId}`,
      )
      setOcApiKey('')
      setOcNickname('')
    })
  }
  async function addAnonymousChannel() {
    await guard('添加匿名通道', async () => {
      const res = (await store.addOpencodeAnonymous()) as { accountId: string }
      setNotice(`已添加匿名通道 ${res?.accountId}（按出口 IP 限额，多配代理才能多分支）`)
    })
  }
  function openProxyEditor(accountId: string) {
    setProxyEditing(accountId)
    setProxyDraft('')
  }
  async function saveProxy(accountId: string) {
    await guard('设置出口代理', async () => {
      const res = (await store.setOpencodeProxy(accountId, proxyDraft.trim())) as { label: string }
      setNotice(`代理已设置为 ${res?.label ?? '直连'}`)
      setProxyEditing('')
      setProxyDraft('')
    })
  }
  async function testProxy(accountId: string) {
    await guard('测试代理', async () => {
      const res = (await store.testOpencodeProxy(proxyDraft.trim())) as { exitIp: string; country: string; latencyMs: number }
      setProxyTestResult((prev) => ({
        ...prev,
        [accountId]: `出口 ${res?.exitIp}${res?.country ? ` (${res.country})` : ''} · ${res?.latencyMs}ms`,
      }))
    })
  }
  async function rotateFingerprint(accountId: string) {
    await guard('轮换指纹', async () => {
      const res = (await store.rotateOpencodeFingerprint(accountId)) as { generation: number }
      setNotice(`指纹已轮换到第 ${res?.generation} 代（仅防关联，不增加配额）`)
    })
  }

  // ── 批量 / 排序 / 账号更新 ──
  async function retestAll() {
    await guard('重测全部账号', async () => {
      const res = (await store.retestAllAccounts()) as { clearedCount?: number }
      setNotice(`重测完成${res?.clearedCount ? `，清掉 ${res.clearedCount} 个限流标记` : ''}`)
    })
  }
  function retestOne(accountId: string) {
    void guard('重测账号', () => store.retestAccount(accountId))
  }
  async function resetAllLimits() {
    await guard('全部重置限流', async () => {
      const res = (await store.resetAllRateLimits()) as { clearedCount?: number; accountCount?: number }
      setNotice(`已清空 ${res?.clearedCount ?? 0} 个限流标记（共 ${res?.accountCount ?? 0} 个账号）`)
    })
  }
  async function toggleAccountEnabled(account: { id: string; enabled?: boolean }) {
    const provider = current?.id ?? ''
    const enabling = account.enabled === false
    const leavesNone = !enabling && disablingLeavesNoEnabledAccount(store.accounts, account.id, provider)
    let alsoDisableModels = false
    if (leavesNone) {
      alsoDisableModels = await confirmAction({
        title: '停用账号',
        message:
          `停用后 ${current?.name ?? provider} 不再有任何启用账号，但它的模型仍会留在模型选择器里` +
          '（插件门控刻意不看启用状态）。是否同时关闭该渠道的全部模型？',
        confirmText: '同时关闭模型',
        cancelText: '只停用账号',
      })
    }
    await guard(enabling ? '启用账号' : '停用账号', async () => {
      await store.updateAccount(account.id, { enabled: enabling })
      if (leavesNone && alsoDisableModels) await store.setAllModelsDisabled(provider, true)
    })
  }
  async function renameAccount(account: { id: string; nickname?: string }) {
    const next = window.prompt('账号备注名', String(account.nickname ?? ''))
    if (next === null) return
    await guard('重命名账号', () => store.updateAccount(account.id, { nickname: next.trim() }))
  }
  async function moveAccount(accountId: string, delta: number) {
    const provider = current?.id
    if (!provider) return
    const ids = store.accountsOf(provider).map((item) => String(item.id))
    const from = ids.indexOf(accountId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    await guard('调整账号顺序', () => store.reorderAccounts(provider, next))
  }
  function moveProviderItem(delta: number) {
    if (!current) return
    void guard('调整渠道顺序', () => store.moveProvider(current.id, delta))
  }
  async function setAllModels(disabled: boolean) {
    if (!current) return
    const id = current.id
    if (disabled) {
      const ok = await confirmAction({
        message: `确定停用 ${current.name} 的全部模型？它们会从 Maxma 的模型选择器里消失（可随时重新启用）。`,
        danger: true,
        confirmText: '停用',
      })
      if (!ok) return
    }
    await guard(disabled ? '停用全部模型' : '启用全部模型', () => store.setAllModelsDisabled(id, disabled))
  }
  function clearDead() {
    if (!current) return
    void guard('清理失效标记', async () => {
      await store.clearDeadModels(current.id)
      setNotice('已清理「上游失效」标记')
    })
  }

  // ── 渠道 / 模型 / 账号动作 ──
  async function toggleProvider() {
    if (!current || !currentStatus) return
    const next = !currentStatus.closed
    await guard(next ? '关闭渠道' : '打开渠道', () => store.setProviderEnabled(current.id, !next))
  }
  function toggleModel(modelId: string, disabled: boolean) {
    if (!current) return
    void guard(disabled ? '停用模型' : '启用模型', () => store.setModelDisabled(current.id, modelId, disabled))
  }
  function testAccount(accountId: string) {
    void guard('账号测试', () => store.testAccount(accountId))
  }
  function refreshAccount(accountId: string) {
    void guard('凭据续期', () => store.refreshAccount(accountId))
  }
  async function removeAccount(accountId: string) {
    if (!(await confirmAction({
      message: `确定删除账号 ${accountId}？该账号的凭据会被一并移除，且无法恢复。`,
      danger: true,
      confirmText: '删除',
    }))) return
    await guard('删除账号', () => store.deleteAccount(accountId))
  }
  async function resetRateLimits() {
    await guard('重置限流', async () => {
      const result = (await store.resetRateLimits()) as { clearedCount?: number }
      setNotice(`已清空 ${result?.clearedCount ?? 0} 个限流标记`)
    })
  }

  // ── 浏览器授权登录 ──
  async function newAccount() {
    if (!current) return
    setNotice('')
    try {
      await store.beginLogin(current.id)
    } catch (e) {
      setNotice(`发起登录失败：${toErrorMessage(e)}`)
    }
  }
  function cancelLogin() {
    store.cancelLogin()
  }
  async function copyLoginUrl() {
    const url = store.login?.loginUrl
    if (!url) return
    try {
      await navigator.clipboard?.writeText(url)
      setNotice('登录链接已复制')
    } catch {
      setNotice('复制失败，请手动选中链接复制')
    }
  }

  return (
    <div className="jet-hub ds-view ds-view--wide flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
      {/* 页头 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Jet Hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            多账号与渠道管理 · {store.routes?.length ?? 0} 个渠道 · 账号 {store.accountEnabled()}/{store.accountTotal()} 已启用
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={showUsage ? 'default' : 'outline'} onClick={toggleUsage}>Token 用量</Button>
          <Button size="sm" variant={showGateway ? 'default' : 'outline'} onClick={toggleGateway}>本机网关</Button>
          <Button size="sm" variant={showBackup ? 'default' : 'outline'} onClick={toggleBackup}>备份 / 迁移</Button>
          <Button size="sm" disabled={Boolean(store.loading)} onClick={() => void refresh()}>
            {store.loading ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </header>

      {/* 备份与迁移 */}
      {showBackup && (
        <section className="glass-panel rounded-lg border border-border p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">备份 / 迁移</h2>
            <span className="text-xs text-muted-foreground">账号池 + 凭据 + 模型黑名单的快照</span>
          </div>
          <KVList items={[
            ['当前账号', `${store.backupStatus?.accounts ?? '—'} 个`],
            ['其中无有效期', `${store.backupStatus?.withoutExpiry ?? '—'} 个（多为版本切换后自动恢复的产物）`],
          ]} />
          <WarnBanner><strong>导出文件包含明文凭据</strong>（令牌 / refresh token）。任何拿到它的人都能直接使用这些账号 —— 只保存在可信位置，不要提交到仓库或转发。</WarnBanner>
          <WarnBanner><strong>导入是整体替换，不是合并</strong>。插件当前的导入接口没有 merge 模式，替换后当前账号池会被快照内容完全取代，且不可撤销。</WarnBanner>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={Boolean(store.backupBusy)} onClick={() => void doExportBackup()}>
              {store.backupBusy ? '处理中…' : '导出备份'}
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-border bg-transparent px-3.5 text-sm text-foreground">
              选择备份文件
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onBackupFile(e)} />
            </label>
            <Button size="sm" variant="destructive" disabled={!pendingImport || Boolean(store.backupBusy)} onClick={() => void doImportBackup()}>
              {pendingImport ? '导入（整体替换）' : '导入（先选文件）'}
            </Button>
          </div>
          {pendingImport && <p className="mt-2 text-xs text-muted-foreground">已读取备份文件，等待确认。</p>}
          {store.backupWarnings?.length > 0 && (
            <KVList items={store.backupWarnings.map((w, idx) => [`导出提示 ${idx + 1}`, w] as [string, string])} />
          )}
          {store.backupResult && (
            <KVList items={[
              ['凭据导入', String(store.backupResult.credentialsImported ?? '—')],
              ['账号导入', String(store.backupResult.accountsImported ?? '—')],
              ['跳过', String(Array.isArray(store.backupResult.skipped) ? store.backupResult.skipped.length : (store.backupResult.skipped ?? 0))],
              ['已过期', String(store.backupResult.expiredAccounts ?? '—')],
              ['缺凭据', String(store.backupResult.missingCredentials ?? '—')],
            ]} />
          )}
        </section>
      )}

      {/* Token 用量（直接 callJetHub） */}
      {showUsage && (
        <section className="glass-panel rounded-lg border border-border p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">Token 用量</h2>
            <span className="text-xs text-muted-foreground">来自插件账本（90 天日聚合）</span>
          </div>
          {usageLoading ? (
            <p className="text-sm text-muted-foreground">读取中…</p>
          ) : usageTotals ? (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3">
                <Stat value={fmtNumber(usageTotals.requests)} label="请求" />
                <Stat value={fmtNumber(usageTotals.inputTokens)} label="输入 Tokens" />
                <Stat value={fmtNumber(usageTotals.outputTokens)} label="输出 Tokens" />
                <Stat value={fmtNumber(usageTotals.cacheReadTokens)} label="缓存读取" />
                <Stat value={fmtNumber(usageTotals.reasoningTokens)} label="思考 Tokens" />
                <Stat value={fmtNumber(usageTotals.errors)} label="错误" />
              </div>
              {usageChannels.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1">
                  {usageChannels.map((channel, idx) => {
                    const totals = channel.totals as { requests?: number; inputTokens?: number; outputTokens?: number } | undefined
                    return (
                      <li key={idx} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm">
                        <span className="text-foreground">{String(channel.provider || channel.channel || `渠道 ${idx + 1}`)}</span>
                        <span className="text-xs text-muted-foreground">
                          {fmtNumber(totals?.requests)} 次 · 输入 {fmtNumber(totals?.inputTokens)} · 输出 {fmtNumber(totals?.outputTokens)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">账本里还没有记录。等 Maxma 里用这些渠道跑过对话后，这里会出现按渠道的用量。</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">历史采样点：{usageHistory.length} 条</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">暂无用量数据。</p>
          )}
        </section>
      )}

      {/* 本机网关 */}
      {showGateway && (
        <section className="glass-panel rounded-lg border border-border p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">本机 OpenAI 网关</h2>
            <span className="text-xs text-muted-foreground">让其它客户端复用已登录账号</span>
          </div>
          {store.gatewayLoading ? (
            <p className="text-sm text-muted-foreground">读取中…</p>
          ) : store.gateway ? (
            <>
              <KVList items={[
                ['Maxma 设置', store.gatewayConfigEnabled ? '已启用（重启后生效）' : '已停用'],
                ['插件运行时', store.gateway.running ? '运行中' : '未监听'],
                ['监听地址', store.gateway.address || '（未监听）'],
                ['访问密钥', store.gateway.apiKey ? '已生成（在插件侧）' : '（未生成）'],
                ['可选模型', `${store.gateway.models?.length ?? 0} 个`],
              ]} />
              {store.gateway.blockedByEnv && (
                <p className="mt-2 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
                  插件报告「已被环境变量停用」。Maxma 在装配插件时按上面的设置注入网关开关 —— 所以在这里启用后需要<strong>重启后端</strong>，插件才会真正开始监听端口。
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" disabled={store.pending === 'gateway'} onClick={() => void toggleGatewayEnabled()}>
                  {store.gatewayConfigEnabled ? '停用网关' : '启用网关'}
                </Button>
              </div>
            </>
          ) : null}
        </section>
      )}

      {store.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{String(store.error)}</p>
      ) : store.notReady ? (
        <p className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">{String(store.notReady)}</p>
      ) : null}

      {/* 渠道 rail + 面板 */}
      <section className="grid flex-1 grid-cols-[220px_1fr] gap-4 max-md:grid-cols-1">
        <nav aria-label="渠道列表" className="glass-panel flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-3">
          {store.openProviders().length > 0 && (
            <>
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">已打开 ({store.openProviders().length})</div>
              {store.openProviders().map((item) => (
                <RailRow
                  key={item.id}
                  name={item.name}
                  meta={`${store.statusOf(item.id).models.total} 模型 · ${store.statusOf(item.id).accounts.enabled} 号`}
                  active={current?.id === item.id}
                  onClick={() => selectProvider(item.id)}
                />
              ))}
            </>
          )}
          {store.closedProviders().length > 0 && (
            <>
              <div className="px-2 py-1 text-xs font-medium text-muted-foreground">已关闭 ({store.closedProviders().length})</div>
              {store.closedProviders().map((item) => (
                <RailRow
                  key={item.id}
                  name={item.name}
                  meta={`${store.statusOf(item.id).models.total} 模型`}
                  active={current?.id === item.id}
                  closed
                  onClick={() => selectProvider(item.id)}
                />
              ))}
            </>
          )}
          {!(store.routes?.length) && !store.loading && <p className="px-2 py-4 text-sm text-muted-foreground">暂无可用渠道</p>}
        </nav>

        <div className="glass-panel flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border p-4">
          {current && currentStatus ? (
            <>
              {/* 面板头 */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{current.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    模型 {currentStatus.models.total}（停用 {currentStatus.models.disabled}）· 账号 {currentStatus.accounts.enabled}/{currentStatus.accounts.total}
                    {currentStatus.closed && <Badge variant="secondary" className="ml-2 text-xs">已关闭</Badge>}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isOpencode ? (
                    <Button
                      size="xs"
                      disabled={!store.canLogin(current.id) || store.pending === `login:${current.id}` || store.login?.status === 'waiting'}
                      title={store.canLogin(current.id) ? '在浏览器中完成授权后，账号会自动加入该渠道' : `${current.id} 不支持浏览器授权登录（它有自己的接入口）`}
                      onClick={() => void newAccount()}
                    >
                      新建账号
                    </Button>
                  ) : (
                    <Button size="xs" disabled={store.pending === 'opencode:anon'} title="匿名通道 = 池里一条 api_key 为 public 的普通条目" onClick={() => void addAnonymousChannel()}>
                      添加匿名通道
                    </Button>
                  )}
                  <ActButton disabled={store.pending === `provider:${current.id}`} title={currentStatus.closed ? '重新打开该渠道的自动选号' : '关闭该渠道的自动选号（已登录账号保留）'} onClick={() => void toggleProvider()}>
                    {currentStatus.closed ? '打开渠道' : '关闭渠道'}
                  </ActButton>
                  {canRateLimit && (
                    <>
                      <ActButton disabled={store.pending === 'reset-all'} title="清空插件记录的全部限流冷却标记" onClick={() => void resetRateLimits()}>重置限流</ActButton>
                      <ActButton disabled={store.pending === 'reset-all-accounts'} title="清空全部账号的限流冷却" onClick={() => void resetAllLimits()}>全部重置限流</ActButton>
                      <ActButton disabled={store.pending === 'retest-all'} title="逐个重测该渠道全部账号，并清掉已恢复的限流标记" onClick={() => void retestAll()}>重测全部</ActButton>
                    </>
                  )}
                  <ActButton disabled={store.pending === 'provider-order'} title="上移该渠道（顺序即插件的自动选号优先级）" onClick={() => moveProviderItem(-1)}>↑</ActButton>
                  <ActButton disabled={store.pending === 'provider-order'} title="下移该渠道" onClick={() => moveProviderItem(1)}>↓</ActButton>
                  {canPermanentLock && (
                    <ActButton
                      active={permanentLockState?.locked}
                      disabled={store.pending === `permanent-lock:${current.id}`}
                      title={permanentLockState?.locked ? permanentLockText.lockedTitle : permanentLockText.lockTitle}
                      onClick={() => void togglePermanentLock()}
                    >
                      {permanentLockState?.locked ? '已锁定永久积分' : '锁定永久积分'}
                    </ActButton>
                  )}
                  <ActButton disabled={Boolean(store.modelsLoading)} onClick={() => void store.loadModels(current.id)}>
                    {store.modelsLoading ? '读取中…' : store.models?.length ? '重新读取模型' : '显示模型列表'}
                  </ActButton>
                  {(store.models?.length ?? 0) > 0 && (
                    <>
                      <ActButton disabled={store.pending === `models-all:${current.id}`} onClick={() => void setAllModels(true)}>全部停用</ActButton>
                      <ActButton disabled={store.pending === `models-all:${current.id}`} onClick={() => void setAllModels(false)}>全部启用</ActButton>
                      <ActButton disabled={store.pending === `models-clear:${current.id}`} title="清理「上游失效」标记，让被误判的模型重新可用" onClick={clearDead}>清理失效</ActButton>
                    </>
                  )}
                </div>
              </div>

              {/* 模型列表 */}
              {(store.models?.length ?? 0) > 0 && (
                <ul className="flex flex-col gap-1">
                  {store.models.map((model) => (
                    <li key={model.id} className={cn('flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm', (model.disabled || model.dead) && 'opacity-60')}>
                      <span className="text-foreground">{model.name || model.id}</span>
                      <span className="flex items-center gap-2">
                        {model.disabled && <Badge variant="secondary" className="text-xs">已停用</Badge>}
                        {model.dead && <Badge variant="destructive" className="text-xs">上游失效</Badge>}
                        <ActButton disabled={store.pending === `model:${model.id}`} onClick={() => toggleModel(model.id, !model.disabled)}>
                          {model.disabled ? '启用' : '停用'}
                        </ActButton>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="text-sm font-semibold text-foreground">账号 ({currentAccounts.length})</h3>

              {/* Cline 订阅额度 */}
              {isCline && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">订阅额度</h3>
                    <ActButton disabled={Boolean(store.clineQuotaLoading)} onClick={openClineQuota}>{store.clineQuotaLoading ? '读取中…' : '读取额度'}</ActButton>
                  </div>
                  {store.clineQuota?.accounts?.length ? (
                    <KVList items={store.clineQuota.accounts.map((row: Record<string, unknown>, idx: number) => [
                      String(row.nickname || row.accountId || `账号 ${idx + 1}`),
                      clineQuotaLine(row),
                    ] as [string, string])} />
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无额度读数（需要该渠道已登录账号，且插件已拉到订阅信息）。</p>
                  )}
                </div>
              )}

              {/* Cline 请求日志 */}
              {isCline && (store.clineRequestLog?.length || store.clineRequestLogAccount) && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">请求日志 · {store.clineRequestLogAccount}</h3>
                    <ActButton onClick={() => store.clearAccountDetail()}>关闭</ActButton>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    这是<strong>插件自己发出的请求流水</strong>（进程内存，重启即丢），不是官方用量接口 —— 请勿用它对外对账。失败行会与成功行一起列出，那是排查「为什么没回复」的第一线索。
                  </p>
                  {store.clineRequestLog?.length ? (
                    <ul className="flex flex-col gap-1">
                      {store.clineRequestLog.map((row, idx) => (
                        <li key={idx} className={cn('flex flex-wrap justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 text-xs', Boolean(row.error) && 'text-destructive')}>
                          <span>{fmtTs(row.ts)}</span>
                          <span>{String(row.upstream || row.model || '—')}</span>
                          <span>{clineLogTail(row)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">该账号还没有请求记录。</p>
                  )}
                </div>
              )}

              {/* Loomy / Raccoon 新人任务 · 登录奖励 */}
              {canOnboarding && store.onboarding && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      {current?.id === 'raccoon' ? '登录奖励' : '新人任务'} · {store.onboarding.accountId}
                    </h3>
                    <ActButton onClick={() => store.clearAccountDetail()}>关闭</ActButton>
                  </div>
                  {store.onboarding.tasks.length ? (
                    <KVList items={store.onboarding.tasks.map((task: { title: string; claimed?: boolean; points?: number }) => [
                      task.title,
                      `${task.claimed ? '已领取' : '可领取'}${typeof task.points === 'number' ? ` · ${task.points} 分` : ''}`,
                    ] as [string, string])} />
                  ) : (
                    <p className="text-xs text-muted-foreground">该账号暂无可展示的任务。</p>
                  )}
                  {typeof store.onboarding.earned === 'number' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      累计已领：{store.onboarding.earned}{typeof store.onboarding.total === 'number' ? ` / ${store.onboarding.total}` : ''}
                    </p>
                  )}
                </div>
              )}

              {/* OpenCode 手动粘贴 API key */}
              {isOpencode && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap gap-2">
                    <Input type="password" value={ocApiKey} placeholder="粘贴 API key（sk- 开头，20 位以上）" onChange={(e) => setOcApiKey(e.target.value)} className="max-w-xs" />
                    <Input value={ocNickname} placeholder="备注名（可选）" onChange={(e) => setOcNickname(e.target.value)} className="max-w-[160px]" />
                    <Button size="sm" disabled={store.pending === 'opencode:add'} onClick={() => void submitOpencodeAccount()}>添加账号</Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    key 在 <a href="https://opencode.ai/console/account" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">opencode.ai/console/account</a> 生成。
                    <strong>同一个 key 重复添加会复用同一账号</strong>（不会变成两个额度桶）。手动粘贴的 key 没有续期概念，插件如实标为不可续期。
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    匿名通道按<strong>出口 IP</strong> 限额：换 key、换指纹都<strong>不</strong>增加配额，指纹分离只用于防关联。要多份额度得给不同匿名通道配不同代理。
                  </p>
                </div>
              )}

              {/* 积分 */}
              {(canCreditBalance || canDailyCheckin) && (
                <div className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">积分</h3>
                    <div className="flex gap-2">
                      {canCreditBalance && <ActButton disabled={Boolean(store.creditsLoading)} onClick={refreshCredits}>{store.creditsLoading ? '读取中…' : '刷新积分'}</ActButton>}
                      {canDailyCheckin && (
                        <Button size="xs" disabled={store.pending === `claim:${current.id}`} title="领取该渠道当天的积分（按账号逐个执行）" onClick={() => void claimCredits()}>
                          {store.pending === `claim:${current.id}` ? '领取中…' : '一键领取积分'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {currentCredits?.accounts?.length ? (
                    <KVList items={currentCredits.accounts.map((entry, idx) => [
                      String(entry.nickname || entry.accountId || `账号 ${idx + 1}`),
                      creditLine(entry as Record<string, unknown>),
                    ] as [string, string])} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      暂无可展示的余额{currentCredits?.windowDays ? `（统计窗口 ${currentCredits.windowDays} 天）` : ''}。该渠道还没有登录账号，或插件侧尚未统计到。
                    </p>
                  )}
                  {claimSummary && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      上次领取：{String(claimSummary.claimed)} 个账号 · 已领 {String(claimSummary.alreadyClaimed)} · 不适用 {String(claimSummary.inactive)} · 失败 {String(claimSummary.failed)}
                    </p>
                  )}
                </div>
              )}

              {/* 浏览器授权登录会话 */}
              {store.login && store.login.provider === current.id && (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">{store.login.status === 'waiting' ? '等待浏览器授权…' : '登录会话'}</span>
                    {store.login.status === 'waiting' && <span className="text-xs text-muted-foreground">已轮询 {store.login.polls} 次</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">插件可能已自动打开系统浏览器。若没有，请手动打开下面的链接完成授权；授权成功后该账号会自动出现在列表里。</p>
                  <div className="mt-2 flex items-center gap-2">
                    <a href={store.login.loginUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-xs text-primary hover:underline">{store.login.loginUrl}</a>
                    <ActButton onClick={() => void copyLoginUrl()}>复制</ActButton>
                  </div>
                  {store.login.message && <p className="mt-1 text-xs text-muted-foreground">{store.login.message}</p>}
                  <div className="mt-2 flex gap-2">
                    {store.login.status === 'waiting' ? (
                      <ActButton onClick={cancelLogin}>取消登录</ActButton>
                    ) : (
                      <ActButton onClick={() => store.dismissLogin()}>关闭</ActButton>
                    )}
                  </div>
                </div>
              )}

              {/* 账号列表 */}
              {currentAccounts.length ? (
                <ul className="flex flex-col gap-2">
                  {currentAccounts.map((account) => (
                    <li key={account.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{account.nickname || account.id}</span>
                        <span className="font-mono text-xs text-muted-foreground">{account.id}</span>
                      </div>
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>有效期：{fmtExpiry(account as unknown as Record<string, unknown>)}</span>
                        {account.enabled === false && <Badge variant="secondary" className="text-xs">已停用</Badge>}
                        {account.refreshable === false && <Badge variant="destructive" className="text-xs">不可续期</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canRateLimit && (
                          <ActButton disabled={store.pending === `retest:${account.id}`} title="重测该账号并清掉已恢复的限流标记" onClick={() => retestOne(account.id)}>重测</ActButton>
                        )}
                        <ActButton disabled={store.pending === `update:${account.id}`} title={account.enabled === false ? '启用该账号（参与自动选号）' : '停用该账号（不参与自动选号）'} onClick={() => void toggleAccountEnabled(account)}>
                          {account.enabled === false ? '启用' : '停用'}
                        </ActButton>
                        <ActButton disabled={store.pending === `update:${account.id}`} title="修改账号备注名" onClick={() => void renameAccount(account)}>改名</ActButton>
                        <ActButton title="上移（提高自动选号优先级）" onClick={() => void moveAccount(String(account.id), -1)}>↑</ActButton>
                        <ActButton title="下移" onClick={() => void moveAccount(String(account.id), 1)}>↓</ActButton>
                        {isCline && (
                          <ActButton disabled={Boolean(store.clineRequestLogLoading)} title="查看该账号最近发出的请求流水" onClick={() => openClineLog(String(account.id))}>请求日志</ActButton>
                        )}
                        {canOnboarding && (
                          <>
                            <ActButton disabled={Boolean(store.onboardingLoading) || store.pending === `onboarding:${account.id}`} title={current?.id === 'raccoon' ? '查看一次性登录奖励的领取状态' : '查看新人任务与领取状态'} onClick={() => openOnboarding(String(account.id))}>
                              {current?.id === 'raccoon' ? '登录奖励' : '新人任务'}
                            </ActButton>
                            <Button size="xs" disabled={store.pending === `onboarding:${account.id}`} title="领取该账号可领的奖励" onClick={() => void claimOnboarding(String(account.id))}>领取</Button>
                          </>
                        )}
                        {isOpencode && (
                          <>
                            <ActButton title="设置该账号的出口代理（HTTP/SOCKS5；留空 = 直连）" onClick={() => (proxyEditing === account.id ? setProxyEditing('') : openProxyEditor(account.id))}>代理</ActButton>
                            <ActButton disabled={store.pending === `opencode:fp:${account.id}`} title="轮换指纹（仅防关联，不增加配额）" onClick={() => void rotateFingerprint(account.id)}>换指纹</ActButton>
                          </>
                        )}
                        {canAccountTest && (
                          <ActButton disabled={store.pending === `test:${account.id}`} title="测试该账号的连通性与凭据有效性" onClick={() => testAccount(account.id)}>测试</ActButton>
                        )}
                        <ActButton disabled={store.pending === `refresh:${account.id}`} title="立即续期该账号凭据" onClick={() => refreshAccount(account.id)}>续期</ActButton>
                        <ActButton variant="destructive" disabled={store.pending === `delete:${account.id}`} title="删除该账号（凭据一并移除，不可恢复）" onClick={() => void removeAccount(account.id)}>删除</ActButton>
                      </div>
                      {isOpencode && proxyEditing === account.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input value={proxyDraft} placeholder="http://user:pass@host:port 或 socks5://host:port（留空 = 直连）" onChange={(e) => setProxyDraft(e.target.value)} className="max-w-sm" />
                          <Button size="xs" onClick={() => void saveProxy(account.id)}>保存</Button>
                          <ActButton disabled={store.pending === `opencode:test:${proxyDraft}`} onClick={() => void testProxy(account.id)}>测试</ActButton>
                          {proxyTestResult[account.id] && <span className="text-xs text-muted-foreground">{proxyTestResult[account.id]}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {store.canLogin(current.id) ? (
                    <>该渠道还没有登录账号。点上方<strong>新建账号</strong>，插件会打开浏览器完成授权。</>
                  ) : (
                    <>{current.id} 不使用浏览器授权登录（它有自己的接入口，尚未接入）。</>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">{store.loading ? '正在读取插件状态…' : '未选择渠道'}</p>
          )}
        </div>
      </section>

      {notice && <p className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">{notice}</p>}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Puzzle className="size-3.5" />
        数据来自插件自身的 RPC（<code>provider.status</code> / <code>account.list</code> / <code>model.list</code>），经 Maxma 后端 <code>POST /api/jet-hub</code> 转发。
      </p>
    </div>
  )
}

// ── 展示辅助组件 ──

function ActButton({
  children,
  onClick,
  disabled,
  title,
  variant = 'outline',
  active,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  variant?: 'outline' | 'default' | 'destructive' | 'secondary' | 'ghost'
  active?: boolean
}) {
  return (
    <Button size="xs" variant={active ? 'default' : variant} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

function RailRow({ name, meta, active, closed, onClick }: { name: string; meta: string; active?: boolean; closed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-accent text-foreground' : 'text-foreground/85 hover:bg-accent',
        closed && 'opacity-60',
      )}
      onClick={onClick}
    >
      <span className="truncate">{name}</span>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </button>
  )
}

function KVList({ items }: { items: Array<[string, string]> }) {
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {items.map(([k, v], idx) => (
        <li key={idx} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm">
          <span className="shrink-0 text-muted-foreground">{k}</span>
          <span className="text-right text-foreground">{v}</span>
        </li>
      ))}
    </ul>
  )
}

function WarnBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
