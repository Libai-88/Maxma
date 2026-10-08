<script setup lang="ts">
/**
 * JetHubView.vue — 插件 Jet Hub 的管理界面（PLUGIN-001 / P4）。
 *
 * 这是「插件开启后拥有单独的界面进行管理」的落地页：左侧渠道 rail + 右侧渠道面板。
 * 路由挂在 `/plugins/:name/jet-hub` 下，从插件详情页进入，受 `plugins` 能力开关守卫。
 *
 * 本轮范围是**只读**：渠道清单/状态/账号明细/模型列表全部接真 RPC；写操作（登录、
 * 续期、启停、领取积分、备份）留到下一轮 —— 那些方法的入参形状还没核对，先把按钮
 * 做成显式禁用而不是假装能用。
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useJetHubStore } from '@/stores/jetHub'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'
import { confirmAction } from '@/composables/useConfirm'
import { toErrorMessage } from '@/utils/error'
import { disablingLeavesNoEnabledAccount } from '@/utils/jetHub/account-model-link.js'
import { permanentLockCopy, supportsPermanentLock } from '@/utils/jetHub/credits-capabilities.js'
import { creditGroupsOf } from '@/utils/jetHub/badge-model.js'
import { formatUnits } from '@/utils/jetHub/credits-format.js'
import Icon from '@/components/Icon.vue'

const route = useRoute()
const store = useJetHubStore()

const rootEl = ref<HTMLElement | null>(null)
const selected = ref('')
/** 最近一次写操作的回执（成功提示），失败走 store.error 横幅。 */
const notice = ref('')
/** 页头两个工具面板的显隐。 */
const showUsage = ref(false)
const showGateway = ref(false)
const showBackup = ref(false)
/** 已读取、等待确认导入的备份文件内容。 */
const pendingImport = ref<unknown>(null)
/** 最近一次「一键领取积分」的汇总。 */
const claimSummary = ref<import('@/stores/jetHub').JetHubClaimSummary | null>(null)

const pluginName = computed(() => String(route.params.name ?? ''))

const allProviders = computed(() => [...store.openProviders, ...store.closedProviders])
const current = computed(() => allProviders.value.find((item) => item.id === selected.value) ?? allProviders.value[0] ?? null)
const currentStatus = computed(() => (current.value ? store.statusOf(current.value.id) : null))
const currentAccounts = computed(() => (current.value ? store.accountsOf(current.value.id) : []))
const currentCredits = computed(() => (current.value ? store.credits[current.value.id] : undefined))
/** OpenCode 是唯一「不跳浏览器 + 匿名通道」的渠道，界面按此分支。 */
const isOpencode = computed(() => current.value?.id === 'opencode')
/** Cline 有订阅额度与请求日志（插件只为它实现了这两项）。 */
const isCline = computed(() => current.value?.id === 'cline')
/** 只有这两个渠道有「新人任务 / 登录奖励」（插件端点的硬限制）。 */
const ONBOARDING_PROVIDERS = new Set(['loomy', 'raccoon'])
const hasOnboarding = computed(() => ONBOARDING_PROVIDERS.has(current.value?.id ?? ''))

async function openClineQuota() {
  await guard('读取订阅额度', () => store.loadClineQuota())
}

async function openClineLog(accountId: string) {
  await guard('读取请求日志', () => store.loadClineRequestLog(accountId, 50))
}

async function openOnboarding(accountId: string) {
  if (!current.value) return
  await guard('读取任务状态', () => store.loadOnboarding(current.value!.id, accountId))
}

async function claimOnboarding(accountId: string) {
  if (!current.value) return
  await guard('领取奖励', async () => {
    const res = (await store.claimOnboarding(current.value!.id, accountId)) as { earned?: number }
    notice.value = `领取完成${typeof res?.earned === 'number' ? `，累计 ${res.earned}` : ''}`
  })
}

// ── 锁定永久积分 ──
//
// 锁上以后只消耗「N 天内到期」的积分包（那部分再不用就作废）；这类积分用尽后
// **没有可用账号** —— 而不是偷偷烧掉永久积分。N 用插件回的 windowDays，
// 文案整个来自搬运过来的 `permanentLockCopy()`（它按「是否按到期时间分桶」分支，
// 不是按「是不是 buddy」）。
//
// ⚠️ 插件客户端**不做二次确认**：它用一句解释清楚的 title + 直接切换 + 切换后的
// 提示。我照做 —— 给一个可逆的行为开关套确认框只会让人麻木。

const canPermanentLock = computed(() => supportsPermanentLock(current.value?.id ?? ''))
const permanentLockState = computed(() => (current.value ? store.permanentLocks[current.value.id] : undefined))
const permanentLockText = computed(() =>
  permanentLockCopy(current.value?.id ?? '', permanentLockState.value?.windowDays),
)

async function togglePermanentLock() {
  if (!current.value) return
  const next = !(permanentLockState.value?.locked ?? false)
  await guard(next ? '锁定永久积分' : '解锁永久积分', async () => {
    const state = (await store.setPermanentLock(current.value!.id, next)) as { locked?: boolean }
    notice.value = state?.locked ? permanentLockText.value.lockedNotice : permanentLockText.value.unlockedNotice
  })
}

function fmtTs(ts: unknown): string {  const n = typeof ts === 'number' ? ts : Number(ts)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const at = new Date(n)
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}:${String(at.getSeconds()).padStart(2, '0')}`
}

function fmtNumber(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN')
}

/**
 * 一个账号的余额文案。
 *
 * ⚠️ `credits.balances` 的返回形状是
 * `{ accountId, nickname, balance: { total, packages[], expiredTotal } }` ——
 * **余额在 `balance.total`，单位在 `packages[].unit`**，两者都不在账号对象上。
 *
 * 这里曾经写成 `fmtNumber(entry.balance) + entry.unit`：`entry.balance` 是对象，
 * `Number(对象)` 得 NaN → 显示 **0**，单位也永远为空。症状就是「登录后刷新积分仍是 0」，
 * 且与账号是否登录无关。
 *
 * 单位归一口径直接复用搬运过来的 `creditGroupsOf()`（它已经处理了同义异拼
 * `credit`/`credits`/`''` 与 token 特例，以及配额单位的特殊分支），不自己再写一套。
 */
function creditLine(entry: Record<string, unknown>): string {
  const balance = entry?.balance as { total?: unknown; packages?: unknown } | undefined
  if (!balance || typeof balance.total !== 'number' || !Number.isFinite(balance.total)) {
    // 读不到数的账号**不要画成 0**：0 会被读成「额度用光了」，而实际是「没读到」
    return '未读取到'
  }
  const { groups } = creditGroupsOf([entry])
  const group = groups[0]
  if (group) {
    // 配额单位（窗口型）是并行百分比，累加无意义 —— 用插件自己的逐窗口行
    if (Array.isArray(group.quotaLines) && group.quotaLines.length > 0) {
      return group.quotaLines.join(' · ')
    }
    // 与插件客户端同款拼法：数值紧贴单位标签，中间不加空格（badge-model.js:566）
    return `${formatUnits(group.total, group.unit)}${group.label}`
  }
  return formatUnits(balance.total, '')
}

async function toggleUsage() {
  showUsage.value = !showUsage.value
  if (showUsage.value) await guard('读取用量', () => store.loadUsage())
}

async function toggleGateway() {
  showGateway.value = !showGateway.value
  if (showGateway.value) await guard('读取网关状态', () => store.loadGateway())
}

async function toggleGatewayEnabled() {
  const next = !store.gatewayConfigEnabled
  await guard(next ? '启用本机网关' : '停用本机网关', async () => {
    await store.setGatewayEnabled(next)
    notice.value = `${next ? '已启用' : '已停用'}本机网关（需重启后端生效）`
  })
}

async function refreshCredits() {
  if (!current.value) return
  await guard('刷新积分', () => store.loadCredits(current.value!.id))
}async function claimCredits() {  if (!current.value) return
  await guard('一键领取积分', async () => {
    const res = (await store.claimCredits(current.value!.id)) as { summary?: import('@/stores/jetHub').JetHubClaimSummary }
    claimSummary.value = res?.summary ?? null
    if (claimSummary.value) {
      const units = Object.entries(claimSummary.value.totalByUnit ?? {})
        .filter(([, v]) => Number(v) > 0)
        .map(([unit, v]) => `${fmtNumber(v)} ${unit}`)
        .join(' + ')
      notice.value = `领取完成：${claimSummary.value.claimed} 个账号${units ? `，合计 ${units}` : ''}`
    }
  })
}

// ── 备份与迁移 ──
//
// 导出**含明文凭据**，导入是**整体替换**（插件 RPC 没有 merge 模式）。
// 两件事都必须先让用户看见，而不是默默做完。

async function toggleBackup() {
  showBackup.value = !showBackup.value
  if (showBackup.value) await guard('读取备份状态', () => store.loadBackupStatus())
}

async function doExportBackup() {
  const status = store.backupStatus
  const ok = await confirmAction({
    title: '导出账号备份',
    message:
      `即将导出${status ? ` ${status.accounts} 个` : ''}账号的完整快照。\n\n` +
      '⚠️ 文件里包含**明文凭据**（令牌 / refresh token），任何拿到它的人都能直接使用这些账号，' +
      '请只保存在可信位置，不要提交到仓库或发给别人。',
    confirmText: '确认导出',
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
    notice.value = `已导出备份（${store.backupWarnings.length ? `${store.backupWarnings.length} 条提示，见下方` : '无异常'}）`
  })
}

async function onBackupFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  store.backupResult = null
  try {
    const parsed = JSON.parse(await file.text())
    if (!store.looksLikeBackup(parsed)) {
      notice.value = '这个文件不是 Jet Hub 备份（缺少 format/accounts 字段），已拒绝导入'
      return
    }
    pendingImport.value = parsed
    notice.value = `已读取 ${file.name}，确认后才会写入`
  } catch (e) {
    notice.value = `读取失败：${toErrorMessage(e)}`
  }
}

// ── OpenCode 专属动作 ──
//
// OpenCode 是唯一「不跳浏览器」的登录方式（手动粘贴 API key），而且它的匿名通道
// 按**出口 IP** 限额 —— 换 key、换指纹都不增加配额，指纹只防关联。面板文案照此口径。

const ocApiKey = ref('')
const ocNickname = ref('')
/** 正在编辑代理的账号 id（同时只开一个输入框）。 */
const proxyEditing = ref('')
const proxyDraft = ref('')
/** 最近一次代理测试的结果，按账号 id 展示。 */
const proxyTestResult = ref<Record<string, string>>({})

async function submitOpencodeAccount() {
  const key = ocApiKey.value.trim()
  if (!key) {
    notice.value = '请先粘贴 API key（sk- 开头）'
    return
  }
  await guard('添加 OpenCode 账号', async () => {
    const res = (await store.addOpencodeAccount(key, ocNickname.value)) as { accountId: string; existed: boolean }
    notice.value = res?.existed
      ? `该 key 已存在，复用账号 ${res.accountId}（同一份额度，不会变成两个桶）`
      : `已添加账号 ${res?.accountId}`
    ocApiKey.value = ''
    ocNickname.value = ''
  })
}

async function addAnonymousChannel() {
  await guard('添加匿名通道', async () => {
    const res = (await store.addOpencodeAnonymous()) as { accountId: string }
    notice.value = `已添加匿名通道 ${res?.accountId}（按出口 IP 限额，多配代理才能多分支）`
  })
}

function openProxyEditor(accountId: string) {
  proxyEditing.value = accountId
  proxyDraft.value = ''
}

async function saveProxy(accountId: string) {
  await guard('设置出口代理', async () => {
    const res = (await store.setOpencodeProxy(accountId, proxyDraft.value.trim())) as { label: string }
    notice.value = `代理已设置为 ${res?.label ?? '直连'}`
    proxyEditing.value = ''
    proxyDraft.value = ''
  })
}

async function testProxy(accountId: string) {
  await guard('测试代理', async () => {
    const res = (await store.testOpencodeProxy(proxyDraft.value.trim())) as { exitIp: string; country: string; latencyMs: number }
    proxyTestResult.value = { ...proxyTestResult.value, [accountId]: `出口 ${res?.exitIp}${res?.country ? ` (${res.country})` : ''} · ${res?.latencyMs}ms` }
  })
}

async function rotateFingerprint(accountId: string) {
  await guard('轮换指纹', async () => {
    const res = (await store.rotateOpencodeFingerprint(accountId)) as { generation: number }
    notice.value = `指纹已轮换到第 ${res?.generation} 代（仅防关联，不增加配额）`
  })
}

// ── 批量 / 排序 / 账号更新 ──

async function retestAll() {
  await guard('重测全部账号', async () => {
    const res = (await store.retestAllAccounts()) as { clearedCount?: number }
    notice.value = `重测完成${res?.clearedCount ? `，清掉 ${res.clearedCount} 个限流标记` : ''}`
  })
}

async function retestOne(accountId: string) {
  await guard('重测账号', () => store.retestAccount(accountId))
}

async function resetAllLimits() {
  await guard('全部重置限流', async () => {
    const res = (await store.resetAllRateLimits()) as { clearedCount?: number; accountCount?: number }
    notice.value = `已清空 ${res?.clearedCount ?? 0} 个限流标记（共 ${res?.accountCount ?? 0} 个账号）`
  })
}

/**
 * 启用/停用账号。
 *
 * ⚠️ 停用**最后一个**启用账号时要问一句「是否同时关闭该渠道全部模型」——
 * 门控刻意不看 `enabled`（停用只影响自动选号），所以停用后它的模型仍留在模型
 * 选择器里，用户会疑惑「我都停用了怎么还能选到」。插件把这件事做成一次显式选择，
 * 而不是替用户改门控语义。判定用的是**搬运过来的纯逻辑**，且必须在提交前取：
 * 提交后列表已刷新，答案会变成变更后的状态（多账号场景会误判）。
 */
async function toggleAccountEnabled(account: { id: string; enabled?: boolean }) {
  const provider = current.value?.id ?? ''
  const enabling = account.enabled === false
  const leavesNone = !enabling && disablingLeavesNoEnabledAccount(store.accounts, account.id, provider)

  let alsoDisableModels = false
  if (leavesNone) {
    alsoDisableModels = await confirmAction({
      title: '停用最后一个启用账号',
      message:
        `停用后 ${current.value?.name ?? provider} 不再有任何启用账号，但它的模型仍会留在模型选择器里` +
        '（插件门控刻意不看启用状态）。是否同时关闭该渠道的全部模型？',
      confirmText: '同时关闭模型',
      cancelText: '只停用账号',
    })
  }

  await guard(enabling ? '启用账号' : '停用账号', async () => {
    await store.updateAccount(account.id, { enabled: enabling })
    if (leavesNone && alsoDisableModels) {
      await store.setAllModelsDisabled(provider, true)
    }
  })
}

async function renameAccount(account: { id: string; nickname?: string }) {
  const next = window.prompt('账号备注名', String(account.nickname ?? ''))
  if (next === null) return
  await guard('重命名账号', () => store.updateAccount(account.id, { nickname: next.trim() }))
}

/** 账号上移/下移（顺序即插件的自动选号优先级）。 */
async function moveAccount(accountId: string, delta: number) {
  const provider = current.value?.id
  if (!provider) return
  const ids = store.accountsOf(provider).map((item) => String(item.id))
  const from = ids.indexOf(accountId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  await guard('调整账号顺序', () => store.reorderAccounts(provider, next))
}

async function moveProviderItem(delta: number) {
  if (!current.value) return
  await guard('调整渠道顺序', () => store.moveProvider(current.value!.id, delta))
}

async function setAllModels(disabled: boolean) {
  if (!current.value) return
  if (disabled) {
    const ok = await confirmAction({
      title: '停用全部模型',
      message: `确定停用 ${current.value.name} 的全部模型？它们会从 Maxma 的模型选择器里消失（可随时重新启用）。`,
      confirmText: '全部停用',
      danger: true,
    })
    if (!ok) return
  }
  await guard(disabled ? '停用全部模型' : '启用全部模型', () => store.setAllModelsDisabled(current.value!.id, disabled))
}

async function clearDead() {
  if (!current.value) return
  await guard('清理失效标记', async () => {
    await store.clearDeadModels(current.value!.id)
    notice.value = '已清理「上游失效」标记'
  })
}

async function doImportBackup() {  if (!pendingImport.value) return
  const status = store.backupStatus
  const ok = await confirmAction({
    title: '导入账号备份',
    message:
      '⚠️ 导入是**整体替换**，不是合并：当前账号池会被快照里的内容取代' +
      `${status ? `（当前 ${status.accounts} 个账号将被替换）` : ''}。\n\n` +
      '凭据与模型黑名单都会一并还原。此操作不可撤销。',
    confirmText: '确认替换',
    danger: true,
  })
  if (!ok) return

  await guard('导入备份', async () => {
    const result = await store.importBackup(pendingImport.value)
    pendingImport.value = null
    const r = result as import('@/stores/jetHub').JetHubImportResult | undefined
    notice.value = r
      ? `导入完成：凭据 ${r.credentialsImported} 条、账号 ${r.accountsImported} 个` +
        `${r.skipped?.length ? `，跳过 ${r.skipped.length}` : ''}${r.expiredAccounts ? `，已过期 ${r.expiredAccounts}` : ''}` +
        `${r.missingCredentials ? `，缺凭据 ${r.missingCredentials}` : ''}`
      : '导入完成'
  })
}

function fmtExpiry(account: Record<string, unknown>): string {
  const raw = account.expiresAt
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return '未知'
  const at = new Date(raw)
  const expired = raw <= Date.now()
  const text = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return expired ? `${text}（已过期）` : text
}

async function guard(label: string, task: () => Promise<unknown>) {
  notice.value = ''
  try {
    await task()
    notice.value = `${label}完成`
  } catch (e) {
    // store.error 已有可读文案；这里只兜住未预期异常
    notice.value = `${label}失败：${toErrorMessage(e)}`
  }
}

async function refresh() {
  store.clearModels()
  await store.refresh()
  if (current.value) selected.value = current.value.id
}

function selectProvider(id: string) {
  selected.value = id
  store.clearModels()
  notice.value = ''
  claimSummary.value = null
  store.clearAccountDetail()
  if (id) {
    void guard('读取积分', () => store.loadCredits(id))
    void store.loadPermanentLock(id)
  }
}

async function toggleProvider() {
  if (!current.value || !currentStatus.value) return
  const next = !currentStatus.value.closed
  await guard(next ? '关闭渠道' : '打开渠道', () => store.setProviderEnabled(current.value!.id, !next))
}

async function toggleModel(modelId: string, disabled: boolean) {
  if (!current.value) return
  await guard(disabled ? '停用模型' : '启用模型', () => store.setModelDisabled(current.value!.id, modelId, disabled))
}

async function testAccount(accountId: string) {
  await guard('账号测试', () => store.testAccount(accountId))
}

async function refreshAccount(accountId: string) {
  await guard('凭据续期', () => store.refreshAccount(accountId))
}

async function removeAccount(accountId: string) {
  const ok = await confirmAction({
    title: '删除账号',
    message: `确定删除账号 ${accountId}？该账号的凭据会被一并移除，且无法恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await guard('删除账号', () => store.deleteAccount(accountId))
}

async function resetRateLimits() {
  await guard('重置限流', async () => {
    const result = await store.resetRateLimits()
    notice.value = `已清空 ${(result as { clearedCount?: number })?.clearedCount ?? 0} 个限流标记`
  })
}

// ── 浏览器授权登录 ──

async function newAccount() {
  if (!current.value) return
  notice.value = ''
  try {
    await store.beginLogin(current.value.id)
  } catch (e) {
    notice.value = `发起登录失败：${toErrorMessage(e)}`
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
    notice.value = '登录链接已复制'
  } catch {
    notice.value = '复制失败，请手动选中链接复制'
  }
}

/** 登录成功后刷新列表（store 内部已 refresh，这里只补一条回执）。 */
watch(
  () => store.login?.status,
  (status) => {
    if (status === 'done') notice.value = '授权成功，账号已添加'
    if (status === 'timeout') notice.value = '等待授权超时'
    if (status === 'cancelled') notice.value = '已取消登录'
  },
)

onMounted(async () => {
  store.setPluginName(pluginName.value)
  try {
    await refresh()
  } catch {
    // 错误已进 store.error，界面据此展示
  }
})

useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.section', ready: () => !store.loading })
// ⚠️ watchSources 收 WatchSource：store.error 取值后是 string，必须包成 getter。
useButtonFx(() => rootEl.value, '.btn', { watchSources: [() => store.error] })
</script>

<template>
  <div ref="rootEl" class="jet-hub">
    <header class="header">
      <div class="header-copy">
        <h1 class="title">Jet Hub</h1>
        <p class="subtitle">
          多账号与渠道管理 · {{ store.routes.length }} 个渠道 · 账号
          {{ store.accountEnabled }}/{{ store.accountTotal }} 已启用
        </p>
      </div>
      <div class="header-actions">
        <button class="btn" type="button" :class="{ 'btn-active': showUsage }" @click="toggleUsage">Token 用量</button>
        <button class="btn" type="button" :class="{ 'btn-active': showGateway }" @click="toggleGateway">本机网关</button>
        <button class="btn" type="button" :class="{ 'btn-active': showBackup }" @click="toggleBackup">备份 / 迁移</button>
        <button class="btn btn-primary" type="button" :disabled="store.loading" @click="refresh">
          {{ store.loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </header>

    <!-- 备份与迁移（插件 backup.*） -->
    <section v-if="showBackup" class="section card">
      <div class="card-head">
        <h2 class="card-title">备份 / 迁移</h2>
        <span class="card-sub">账号池 + 凭据 + 模型黑名单的快照</span>
      </div>
      <ul class="kv">
        <li><span>当前账号</span><span>{{ store.backupStatus?.accounts ?? '—' }} 个</span></li>
        <li><span>其中无有效期</span><span>{{ store.backupStatus?.withoutExpiry ?? '—' }} 个（多为版本切换后自动恢复的产物）</span></li>
      </ul>
      <p class="banner banner-warn">
        <strong>导出文件包含明文凭据</strong>（令牌 / refresh token）。任何拿到它的人都能直接使用这些账号 ——
        只保存在可信位置，不要提交到仓库或转发。
      </p>
      <p class="banner banner-warn">
        <strong>导入是整体替换，不是合并</strong>。插件当前的导入接口没有 merge 模式，
        替换后当前账号池会被快照内容完全取代，且不可撤销。
      </p>
      <div class="card-actions">
        <button class="btn" type="button" :disabled="store.backupBusy" @click="doExportBackup">
          {{ store.backupBusy ? '处理中…' : '导出备份' }}
        </button>
        <label class="btn btn-file">
          选择备份文件
          <input type="file" accept="application/json,.json" class="file-input" @change="onBackupFile" />
        </label>
        <button
          class="btn btn-danger"
          type="button"
          :disabled="!pendingImport || store.backupBusy"
          @click="doImportBackup"
        >
          {{ pendingImport ? '导入（整体替换）' : '导入（先选文件）' }}
        </button>
      </div>
      <p v-if="pendingImport" class="card-sub">已读取备份文件，等待确认。</p>
      <ul v-if="store.backupWarnings.length" class="kv">
        <li v-for="(w, idx) in store.backupWarnings" :key="idx"><span>导出提示</span><span>{{ w }}</span></li>
      </ul>
      <ul v-if="store.backupResult" class="kv">
        <li><span>凭据导入</span><span>{{ store.backupResult.credentialsImported }}</span></li>
        <li><span>账号导入</span><span>{{ store.backupResult.accountsImported }}</span></li>
        <li><span>跳过</span><span>{{ store.backupResult.skipped?.length ?? 0 }}</span></li>
        <li><span>已过期</span><span>{{ store.backupResult.expiredAccounts }}</span></li>
        <li><span>缺凭据</span><span>{{ store.backupResult.missingCredentials }}</span></li>
      </ul>
    </section>

    <!-- Token 用量（插件 usage.tokenLedger / usage.tokenLedgerHistory） -->
    <section v-if="showUsage" class="section card">
      <div class="card-head">
        <h2 class="card-title">Token 用量</h2>
        <span class="card-sub">来自插件账本（90 天日聚合）</span>
      </div>
      <p v-if="store.usageLoading" class="card-sub">读取中…</p>
      <template v-else-if="store.usage">
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.requests) }}</div><div class="stat-label">请求</div></div>
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.inputTokens) }}</div><div class="stat-label">输入 Tokens</div></div>
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.outputTokens) }}</div><div class="stat-label">输出 Tokens</div></div>
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.cacheReadTokens) }}</div><div class="stat-label">缓存读取</div></div>
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.reasoningTokens) }}</div><div class="stat-label">思考 Tokens</div></div>
          <div class="stat"><div class="stat-value">{{ fmtNumber(store.usage.errors) }}</div><div class="stat-label">错误</div></div>
        </div>
        <ul v-if="store.usageChannels.length" class="models">
          <li v-for="(channel, idx) in store.usageChannels" :key="idx" class="model-row">
            <span class="model-name">{{ channel.provider || channel.channel || `渠道 ${idx + 1}` }}</span>
            <span class="model-tags">
              {{ fmtNumber(channel.totals?.requests) }} 次 ·
              输入 {{ fmtNumber(channel.totals?.inputTokens) }} ·
              输出 {{ fmtNumber(channel.totals?.outputTokens) }}
            </span>
          </li>
        </ul>
        <p v-else class="empty">账本里还没有记录。等 Maxma 里用这些渠道跑过对话后，这里会出现按渠道的用量。</p>
        <p class="card-sub">历史采样点：{{ store.usageHistory.length }} 条</p>
      </template>
    </section>

    <!-- 本机 OpenAI 网关（插件 gateway.*） -->
    <section v-if="showGateway" class="section card">
      <div class="card-head">
        <h2 class="card-title">本机 OpenAI 网关</h2>
        <span class="card-sub">让其它客户端复用已登录账号</span>
      </div>
      <p v-if="store.gatewayLoading" class="card-sub">读取中…</p>
      <template v-else-if="store.gateway">
        <ul class="kv">
          <li><span>Maxma 设置</span><span>{{ store.gatewayConfigEnabled ? '已启用（重启后生效）' : '已停用' }}</span></li>
          <li><span>插件运行时</span><span>{{ store.gateway.running ? '运行中' : '未监听' }}</span></li>
          <li><span>监听地址</span><span>{{ store.gateway.address || '（未监听）' }}</span></li>
          <li><span>访问密钥</span><span>{{ store.gateway.apiKey ? '已生成（在插件侧）' : '（未生成）' }}</span></li>
          <li><span>可选模型</span><span>{{ store.gateway.models?.length ?? 0 }} 个</span></li>
        </ul>
        <p v-if="store.gateway.blockedByEnv" class="banner banner-muted">
          插件报告「已被环境变量停用」。Maxma 在装配插件时按上面的设置注入网关开关 ——
          所以在这里启用后需要<strong>重启后端</strong>，插件才会真正开始监听端口。
        </p>
        <div class="card-actions">
          <button
            class="btn"
            type="button"
            :disabled="store.pending === 'gateway'"
            @click="toggleGatewayEnabled"
          >
            {{ store.gatewayConfigEnabled ? '停用网关' : '启用网关' }}
          </button>
        </div>
      </template>
    </section>

    <p v-if="store.error" class="banner banner-error">{{ store.error }}</p>
    <p v-else-if="store.notReady" class="banner banner-muted">{{ store.notReady }}</p>

    <section class="section layout">
      <nav class="rail" aria-label="渠道列表">
        <template v-if="store.openProviders.length">
          <div class="rail-group">已打开 ({{ store.openProviders.length }})</div>
          <button
            v-for="item in store.openProviders"
            :key="item.id"
            type="button"
            class="rail-row"
            :class="{ active: current?.id === item.id }"
            @click="selectProvider(item.id)"
          >
            <span class="rail-name">{{ item.name }}</span>
            <span class="rail-meta">{{ store.statusOf(item.id).models.total }} 模型 · {{ store.statusOf(item.id).accounts.enabled }} 号</span>
          </button>
        </template>

        <template v-if="store.closedProviders.length">
          <div class="rail-group">已关闭 ({{ store.closedProviders.length }})</div>
          <button
            v-for="item in store.closedProviders"
            :key="item.id"
            type="button"
            class="rail-row rail-row-closed"
            :class="{ active: current?.id === item.id }"
            @click="selectProvider(item.id)"
          >
            <span class="rail-name">{{ item.name }}</span>
            <span class="rail-meta">{{ store.statusOf(item.id).models.total }} 模型</span>
          </button>
        </template>

        <p v-if="!store.routes.length && !store.loading" class="rail-empty">暂无可用渠道</p>
      </nav>

      <div class="panel">
        <template v-if="current && currentStatus">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">{{ current.name }}</h2>
              <p class="panel-sub">
                模型 {{ currentStatus.models.total }}（停用 {{ currentStatus.models.disabled }}）·
                账号 {{ currentStatus.accounts.enabled }}/{{ currentStatus.accounts.total }}
                <span v-if="currentStatus.closed" class="tag tag-closed">已关闭</span>
              </p>
            </div>
            <div class="panel-actions">
              <button
                v-if="!isOpencode"
                class="btn btn-primary"
                type="button"
                :disabled="!store.canLogin(current.id) || store.pending === `login:${current.id}` || store.login?.status === 'waiting'"
                :title="store.canLogin(current.id)
                  ? '在浏览器中完成授权后，账号会自动加入该渠道'
                  : `${current.id} 不支持浏览器授权登录（它有自己的接入口）`"
                @click="newAccount"
              >
                新建账号
              </button>
              <button
                v-else
                class="btn btn-primary"
                type="button"
                :disabled="store.pending === 'opencode:anon'"
                title="匿名通道 = 池里一条 api_key 为 public 的普通条目。按出口 IP 限额，多条匿名通道需要各配不同代理才有意义"
                @click="addAnonymousChannel"
              >
                添加匿名通道
              </button>
              <button
                class="btn"
                type="button"
                :disabled="store.pending === `provider:${current.id}`"
                :title="currentStatus.closed ? '重新打开该渠道的自动选号' : '关闭该渠道的自动选号（已登录账号保留）'"
                @click="toggleProvider"
              >
                {{ currentStatus.closed ? '打开渠道' : '关闭渠道' }}
              </button>
              <button
                class="btn"
                type="button"
                :disabled="store.pending === 'reset-all'"
                title="清空插件记录的全部限流冷却标记"
                @click="resetRateLimits"
              >
                重置限流
              </button>
              <button
                class="btn"
                type="button"
                :disabled="store.pending === 'reset-all-accounts'"
                title="清空全部账号的限流冷却（范围比单账号重置更广）"
                @click="resetAllLimits"
              >
                全部重置限流
              </button>
              <button
                class="btn"
                type="button"
                :disabled="store.pending === 'retest-all'"
                title="逐个重测该渠道全部账号，并清掉已恢复的限流标记"
                @click="retestAll"
              >
                重测全部
              </button>
              <button
                class="btn"
                type="button"
                title="上移该渠道（顺序即插件的自动选号优先级）"
                :disabled="store.pending === 'provider-order'"
                @click="moveProviderItem(-1)"
              >
                ↑
              </button>
              <button
                class="btn"
                type="button"
                title="下移该渠道"
                :disabled="store.pending === 'provider-order'"
                @click="moveProviderItem(1)"
              >
                ↓
              </button>
              <button
                v-if="canPermanentLock"
                class="btn"
                type="button"
                :class="{ 'btn-active': permanentLockState?.locked }"
                :disabled="store.pending === `permanent-lock:${current.id}`"
                :title="permanentLockState?.locked ? permanentLockText.lockedTitle : permanentLockText.lockTitle"
                @click="togglePermanentLock"
              >
                {{ permanentLockState?.locked ? '已锁定永久积分' : '锁定永久积分' }}
              </button>
              <button class="btn" type="button" :disabled="store.modelsLoading" @click="store.loadModels(current.id)">
                {{ store.modelsLoading ? '读取中…' : store.models.length ? '重新读取模型' : '显示模型列表' }}
              </button>
              <template v-if="store.models.length">
                <button class="btn" type="button" :disabled="store.pending === `models-all:${current.id}`" @click="setAllModels(true)">
                  全部停用
                </button>
                <button class="btn" type="button" :disabled="store.pending === `models-all:${current.id}`" @click="setAllModels(false)">
                  全部启用
                </button>
                <button
                  class="btn"
                  type="button"
                  :disabled="store.pending === `models-clear:${current.id}`"
                  title="清理「上游失效」标记，让被误判的模型重新可用"
                  @click="clearDead"
                >
                  清理失效
                </button>
              </template>
            </div>
          </div>

          <ul v-if="store.models.length" class="models">
            <li v-for="model in store.models" :key="model.id" class="model-row" :class="{ muted: model.disabled || model.dead }">
              <span class="model-name">{{ model.name || model.id }}</span>
              <span class="model-tags">
                <span v-if="model.disabled" class="tag">已停用</span>
                <span v-if="model.dead" class="tag tag-warn">上游失效</span>
              </span>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="store.pending === `model:${model.id}`"
                @click="toggleModel(model.id, !model.disabled)"
              >
                {{ model.disabled ? '启用' : '停用' }}
              </button>
            </li>
          </ul>

          <h3 class="block-title">账号 ({{ currentAccounts.length }})</h3>

          <!-- Cline 订阅额度（插件只为 Cline 实现） -->
          <div v-if="isCline" class="detail-card">
            <div class="credits-head">
              <h3 class="block-title">订阅额度</h3>
              <button class="btn btn-sm" type="button" :disabled="store.clineQuotaLoading" @click="openClineQuota">
                {{ store.clineQuotaLoading ? '读取中…' : '读取额度' }}
              </button>
            </div>
            <ul v-if="store.clineQuota?.accounts?.length" class="kv">
              <li v-for="(row, idx) in store.clineQuota.accounts" :key="idx">
                <span>{{ (row.nickname as string) || (row.accountId as string) || `账号 ${idx + 1}` }}</span>
                <span>{{ row.error ? String(row.error) : (row.summary as string) || '—' }}</span>
              </li>
            </ul>
            <p v-else class="card-sub">暂无额度读数（需要该渠道已登录账号，且插件已拉到订阅信息）。</p>
          </div>

          <!-- Cline 请求日志：插件自己发出的请求流水，不是官方 /usages -->
          <div v-if="isCline && (store.clineRequestLog.length || store.clineRequestLogAccount)" class="detail-card">
            <div class="credits-head">
              <h3 class="block-title">请求日志 · {{ store.clineRequestLogAccount }}</h3>
              <button class="btn btn-sm" type="button" @click="store.clearAccountDetail()">关闭</button>
            </div>
            <p class="card-sub">
              这是<strong>插件自己发出的请求流水</strong>（进程内存，重启即丢），不是官方用量接口 ——
              请勿用它对外对账。失败行会与成功行一起列出，那是排查「为什么没回复」的第一线索。
            </p>
            <ul v-if="store.clineRequestLog.length" class="pop-list-wide">
              <li v-for="(row, idx) in store.clineRequestLog" :key="idx" :class="{ 'row-error': Boolean(row.error) }">
                <span>{{ fmtTs(row.ts) }}</span>
                <span>{{ (row.model as string) || '—' }}</span>
                <span>{{ row.error ? String(row.error) : `${row.status ?? ''} ${row.durationMs ? `${row.durationMs}ms` : ''}` }}</span>
              </li>
            </ul>
            <p v-else class="card-sub">该账号还没有请求记录。</p>
          </div>

          <!-- Loomy / Raccoon 新人任务 · 登录奖励 -->
          <div v-if="hasOnboarding && store.onboarding" class="detail-card">
            <div class="credits-head">
              <h3 class="block-title">
                {{ current?.id === 'raccoon' ? '登录奖励' : '新人任务' }} · {{ store.onboarding.accountId }}
              </h3>
              <button class="btn btn-sm" type="button" @click="store.clearAccountDetail()">关闭</button>
            </div>
            <ul v-if="store.onboarding.tasks.length" class="kv">
              <li v-for="(task, idx) in store.onboarding.tasks" :key="idx">
                <span>{{ (task.title as string) || (task.name as string) || (task.id as string) || `任务 ${idx + 1}` }}</span>
                <span>
                  {{ task.claimed ? '已领取' : task.claimable === false ? '未达成' : '可领取' }}
                  <template v-if="typeof task.earned === 'number'"> · 累计 {{ task.earned }}</template>
                </span>
              </li>
            </ul>
            <p v-else class="card-sub">该账号暂无可展示的任务。</p>
            <p v-if="typeof store.onboarding.earned === 'number'" class="card-sub">
              累计已领：{{ store.onboarding.earned }}
            </p>
          </div>

          <!-- OpenCode：手动粘贴 API key 添加（本插件唯一不跳浏览器的登录方式） -->
          <div v-if="isOpencode" class="oc-form">
            <div class="oc-row">
              <input v-model="ocApiKey" class="oc-input" type="password" placeholder="粘贴 API key（sk- 开头，20 位以上）" />
              <input v-model="ocNickname" class="oc-input oc-input-sm" type="text" placeholder="备注名（可选）" />
              <button class="btn btn-sm btn-primary" type="button" :disabled="store.pending === 'opencode:add'" @click="submitOpencodeAccount">
                添加账号
              </button>
            </div>
            <p class="card-sub">
              key 在 <a href="https://opencode.ai/auth" target="_blank" rel="noopener noreferrer">opencode.ai/auth</a> 生成。
              <strong>同一个 key 重复添加会复用同一账号</strong>（不会变成两个额度桶）。
              手动粘贴的 key 没有续期概念，插件如实标为不可续期。
            </p>
            <p class="card-sub">
              匿名通道按<strong>出口 IP</strong> 限额：换 key、换指纹都<strong>不</strong>增加配额，
              指纹分离只用于防关联。要多份额度得给不同匿名通道配不同代理。
            </p>
          </div>

          <!-- 积分：余额来自 credits.balances；一键领取是 credits.claimAll（按单位分列，不跨单位求和） -->
          <div class="credits">
            <div class="credits-head">
              <h3 class="block-title">积分</h3>
              <div class="card-actions">
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.creditsLoading"
                  @click="refreshCredits"
                >
                  {{ store.creditsLoading ? '读取中…' : '刷新积分' }}
                </button>
                <button
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="store.pending === `claim:${current.id}`"
                  title="领取该渠道当天的积分（按账号逐个执行）"
                  @click="claimCredits"
                >
                  {{ store.pending === `claim:${current.id}` ? '领取中…' : '一键领取积分' }}
                </button>
              </div>
            </div>
            <ul v-if="currentCredits?.accounts?.length" class="kv">
              <li v-for="(entry, idx) in currentCredits.accounts" :key="idx">
                <span>{{ entry.nickname || entry.accountId || `账号 ${idx + 1}` }}</span>
                <span>{{ creditLine(entry) }}</span>
              </li>
            </ul>
            <p v-else class="card-sub">
              暂无可展示的余额{{ currentCredits?.windowDays ? `（统计窗口 ${currentCredits.windowDays} 天）` : '' }}。
              该渠道还没有登录账号，或插件侧尚未统计到。
            </p>
            <p v-if="claimSummary" class="card-sub">
              上次领取：{{ claimSummary.claimed }} 个账号 · 已领 {{ claimSummary.alreadyClaimed }} ·
              不适用 {{ claimSummary.inactive }} · 失败 {{ claimSummary.failed }}
            </p>
          </div>

          <!-- 浏览器授权登录会话：插件开浏览器 + 回环回调，这里负责出示链接与轮询状态 -->
          <div v-if="store.login && store.login.provider === current.id" class="login-card">
            <div class="login-head">
              <span class="login-title">
                {{ store.login.status === 'waiting' ? '等待浏览器授权…' : '登录会话' }}
              </span>
              <span class="login-polls" v-if="store.login.status === 'waiting'">已轮询 {{ store.login.polls }} 次</span>
            </div>
            <p class="login-hint">
              插件可能已自动打开系统浏览器。若没有，请手动打开下面的链接完成授权；
              授权成功后该账号会自动出现在列表里。
            </p>
            <div class="login-url">
              <a :href="store.login.loginUrl" target="_blank" rel="noopener noreferrer" class="login-link">
                {{ store.login.loginUrl }}
              </a>
              <button class="btn btn-sm" type="button" @click="copyLoginUrl">复制</button>
            </div>
            <p v-if="store.login.message" class="login-msg">{{ store.login.message }}</p>
            <div class="login-actions">
              <button
                v-if="store.login.status === 'waiting'"
                class="btn btn-sm"
                type="button"
                @click="cancelLogin"
              >
                取消登录
              </button>
              <button v-else class="btn btn-sm" type="button" @click="store.dismissLogin()">关闭</button>
            </div>
          </div>

          <ul v-if="currentAccounts.length" class="accounts">
            <li v-for="account in currentAccounts" :key="account.id" class="account-row">
              <div class="account-main">
                <span class="account-name">{{ account.nickname || account.id }}</span>
                <span class="account-id">{{ account.id }}</span>
              </div>              <div class="account-meta">
                <span>有效期：{{ fmtExpiry(account) }}</span>
                <span v-if="account.enabled === false" class="tag tag-closed">已停用</span>
                <span v-if="account.refreshable === false" class="tag tag-warn">不可续期</span>
              </div>
              <div class="account-actions">
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.pending === `retest:${account.id}`"
                  title="重测该账号并清掉已恢复的限流标记"
                  @click="retestOne(account.id)"
                >
                  重测
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.pending === `update:${account.id}`"
                  :title="account.enabled === false ? '启用该账号（参与自动选号）' : '停用该账号（不参与自动选号）'"
                  @click="toggleAccountEnabled(account)"
                >
                  {{ account.enabled === false ? '启用' : '停用' }}
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.pending === `update:${account.id}`"
                  title="修改账号备注名"
                  @click="renameAccount(account)"
                >
                  改名
                </button>
                <button class="btn btn-sm" type="button" title="上移（提高自动选号优先级）" @click="moveAccount(String(account.id), -1)">↑</button>
                <button class="btn btn-sm" type="button" title="下移" @click="moveAccount(String(account.id), 1)">↓</button>
                <button
                  v-if="isCline"
                  class="btn btn-sm"
                  type="button"
                  title="查看该账号最近发出的请求流水（插件进程内存，重启即丢）"
                  :disabled="store.clineRequestLogLoading"
                  @click="openClineLog(String(account.id))"
                >
                  请求日志
                </button>
                <button
                  v-if="hasOnboarding"
                  class="btn btn-sm"
                  type="button"
                  :title="current?.id === 'raccoon' ? '查看一次性登录奖励的领取状态' : '查看新人任务与领取状态'"
                  :disabled="store.onboardingLoading || store.pending === `onboarding:${account.id}`"
                  @click="openOnboarding(String(account.id))"
                >
                  {{ current?.id === 'raccoon' ? '登录奖励' : '新人任务' }}
                </button>
                <button
                  v-if="hasOnboarding"
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="store.pending === `onboarding:${account.id}`"
                  title="领取该账号可领的奖励（Raccoon 侧幂等：已领过不会重复发）"
                  @click="claimOnboarding(String(account.id))"
                >
                  领取
                </button>
                <template v-if="isOpencode">
                  <button
                    class="btn btn-sm"
                    type="button"
                    title="设置该账号的出口代理（HTTP/SOCKS5；留空 = 直连）"
                    @click="proxyEditing === account.id ? (proxyEditing = '') : openProxyEditor(account.id)"
                  >
                    代理
                  </button>
                  <button
                    class="btn btn-sm"
                    type="button"
                    :disabled="store.pending === `opencode:fp:${account.id}`"
                    title="轮换指纹（仅防关联，不增加配额）"
                    @click="rotateFingerprint(account.id)"
                  >
                    换指纹
                  </button>
                </template>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.pending === `test:${account.id}`"
                  title="测试该账号的连通性与凭据有效性"
                  @click="testAccount(account.id)"
                >
                  测试
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="store.pending === `refresh:${account.id}`"
                  title="立即续期该账号凭据"
                  @click="refreshAccount(account.id)"
                >
                  续期
                </button>
                <button
                  class="btn btn-sm btn-danger"
                  type="button"
                  :disabled="store.pending === `delete:${account.id}`"
                  title="删除该账号（凭据一并移除，不可恢复）"
                  @click="removeAccount(account.id)"
                >
                  删除
                </button>
              </div>
              <!-- OpenCode 出口代理编辑行 -->
              <div v-if="isOpencode && proxyEditing === account.id" class="proxy-row">
                <input
                  v-model="proxyDraft"
                  class="oc-input"
                  type="text"
                  placeholder="http://user:pass@host:port 或 socks5://host:port（留空 = 直连）"
                />
                <button class="btn btn-sm btn-primary" type="button" @click="saveProxy(account.id)">保存</button>
                <button class="btn btn-sm" type="button" :disabled="store.pending === `opencode:test:${proxyDraft}`" @click="testProxy(account.id)">测试</button>
                <span v-if="proxyTestResult[account.id]" class="card-sub">{{ proxyTestResult[account.id] }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="empty">
            <template v-if="store.canLogin(current.id)">
              该渠道还没有登录账号。点上方<strong>新建账号</strong>，插件会打开浏览器完成授权。
            </template>
            <template v-else>
              {{ current.id }} 不使用浏览器授权登录（它有自己的接入口，尚未接入）。
            </template>
          </p>
        </template>

        <p v-else class="empty">{{ store.loading ? '正在读取插件状态…' : '未选择渠道' }}</p>
      </div>
    </section>

    <p v-if="notice" class="banner banner-muted">{{ notice }}</p>

    <p class="footnote">
      <Icon name="puzzle" :size="14" decorative />
      数据来自插件自身的 RPC（<code>provider.status</code> / <code>account.list</code> / <code>model.list</code>），
      经 Maxma 后端 <code>POST /api/jet-hub</code> 转发。
    </p>
  </div>
</template>

<style scoped>
.jet-hub {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 24px 32px;
  height: 100%;
  overflow: auto;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary, #1c1c1c);
}

.subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary, #8a8a8a);
}

.layout {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: var(--radius, 10px);
  background: var(--bg-secondary, #faf8f4);
}

.rail-group {
  padding: 8px 8px 4px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--text-tertiary, #8a8a8a);
}

.rail-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}

.rail-row:hover {
  background: var(--bg-card, #fff);
}

.rail-row.active {
  background: var(--bg-card, #fff);
  border-color: var(--accent, #b4552d);
}

.rail-row-closed .rail-name {
  color: var(--text-tertiary, #8a8a8a);
}

.rail-name {
  font-size: 13px;
  font-weight: 500;
}

.rail-meta {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.rail-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--text-tertiary, #8a8a8a);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: var(--radius, 10px);
  background: var(--bg-card, #fff);
  min-height: 320px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.panel-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary, #8a8a8a);
}

.block-title {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 600;
}

.models,
.accounts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.model-row,
.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 8px;
  font-size: 12px;
}

.btn-danger {
  border-color: #b23b2e;
  color: #b23b2e;
}

.login-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--accent, #b4552d);
  border-radius: 10px;
  background: var(--bg-secondary, #faf8f4);
}

.login-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.login-title {
  font-size: 13px;
  font-weight: 600;
}

.login-polls {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.login-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary, #8a8a8a);
}

.login-url {
  display: flex;
  align-items: center;
  gap: 8px;
}

.login-link {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--accent, #b4552d);
}

.login-msg {
  margin: 0;
  font-size: 12px;
}

.login-actions {
  display: flex;
  gap: 6px;
}

.header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.btn-active {
  border-color: var(--accent, #b4552d);
  color: var(--accent, #b4552d);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: var(--radius, 10px);
  background: var(--bg-card, #fff);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.card-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.card-actions {
  display: flex;
  gap: 6px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 8px;
}

.stat {
  padding: 8px 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 8px;
}

.stat-value {
  font-size: 15px;
  font-weight: 600;
}

.stat-label {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.kv li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 8px;
  font-size: 12px;
}

.credits {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 10px;
  background: var(--bg-secondary, #faf8f4);
}

.credits-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.credits .block-title {
  margin: 0;
}

.detail-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 10px;
  background: var(--bg-secondary, #faf8f4);
}

.pop-list-wide {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 260px;
  overflow: auto;
}

.pop-list-wide li {
  display: grid;
  grid-template-columns: 92px 1fr auto;
  gap: 8px;
  font-size: 11px;
  padding: 3px 0;
}

.pop-list-wide li.row-error {
  color: #b23b2e;
}

.model-row.muted {
  opacity: 0.6;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-tags,
.account-meta {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.account-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.account-name {
  font-weight: 500;
}

.account-id {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-actions {
  display: flex;
  gap: 6px;
}

.oc-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 10px;
  background: var(--bg-secondary, #faf8f4);
}

.oc-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.oc-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 6px;
  background: var(--bg-card, #fff);
  color: inherit;
  font: inherit;
  font-size: 12px;
}

.oc-input-sm {
  flex: 0 0 140px;
}

.proxy-row {
  display: flex;
  flex: 1 0 100%;
  gap: 6px;
  align-items: center;
  padding-top: 6px;
  border-top: 1px dashed var(--border, #e6e2da);
}

.account-row {
  flex-wrap: wrap;
}

.tag {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border, #e6e2da);
  font-size: 11px;
}

.tag-warn {
  border-color: #d9a441;
  color: #a5731a;
}

.tag-closed {
  border-color: var(--border, #e6e2da);
  color: var(--text-tertiary, #8a8a8a);
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 8px;
  background: var(--bg-secondary, #faf8f4);
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  border-color: var(--accent, #b4552d);
  background: var(--accent, #b4552d);
  color: #fff;
}

.btn-sm {
  padding: 3px 9px;
  font-size: 11px;
}

.banner {
  margin: 0;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
}

.banner-error {
  border: 1px solid #d9a441;
  color: #a5731a;
}

.banner-muted {
  border: 1px solid var(--border, #e6e2da);
  color: var(--text-tertiary, #8a8a8a);
}

.banner-warn {
  border: 1px solid #d9a441;
  color: #a5731a;
}

.btn-file {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.empty {
  margin: 0;
  padding: 18px 4px;
  font-size: 13px;
  color: var(--text-tertiary, #8a8a8a);
}

.footnote {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.footnote code {
  font-size: 11px;
}
</style>
