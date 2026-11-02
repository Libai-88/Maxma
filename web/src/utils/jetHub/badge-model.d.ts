/**
 * badge-model.js 的类型声明（原样搬运的纯逻辑，见 credits-format.d.ts 的说明）。
 *
 * 这份逻辑是「用量徽标折叠态那一行到底显示什么」的**唯一口径来源**
 * （窗口 > 套餐包 > 积分），由插件自带的 74 条单测锁住 —— 界面只渲染它的输出，
 * 不自己拼文案。
 */

export const BADGE_PREFERENCES: readonly string[]
export const DEFAULT_BADGE_PREFERENCE: string
export const AGGREGATE_PROVIDER_ID: string
export const BADGE_SEP: string
export const HOST_STALE_HINT: string
export const BADGE_PREFERENCE_LABELS: Readonly<Record<string, string>>

export interface BadgeGroup {
  unit: string
  label: string
  total: number
  accountCount: number
  quotaLines?: string[]
  quotaRemainings?: number[]
  quotaWindows?: Map<string, number>
}

export interface BadgeWindow {
  type: string
  label: string
  percent: number
}

export interface BadgeViewModel {
  /** 回落之后的实际模式：loading / windows / plan / credits / empty。 */
  mode: string
  preference: string
  name: string
  detail: string
  reading: string
  /** 完整一行（`title` / `aria-label` 用）；恒等于三段拼接。 */
  text: string
  tone: string
  groups: BadgeGroup[]
  planGroups: Array<Record<string, unknown>>
  windows: BadgeWindow[]
  failedCount: number
  okCount: number
  failureReason: string
  /** 读数不完整时的说明（空串 = 完整）。 */
  incompleteNote: string
}

export interface BadgeViewInput {
  providerLabel?: string
  preference?: unknown
  subscription?: { kind?: string; accounts?: Array<Record<string, unknown>> }
  accounts?: Array<Record<string, unknown>>
  /** 首次读数还没回来（**必需**：缺了它首屏会把「还没读到」说成「没有账号」）。 */
  loading?: boolean
  /** 首次读数失败且无任何数据（与「没有账号」区分开）。 */
  failed?: boolean
}

export function badgeView(input?: BadgeViewInput): BadgeViewModel
export function resolveBadgeProvider(provider: unknown, active?: unknown): string
export function describeBadgeError(error: unknown, fallback?: string): string
export function normalizeBadgePreference(value: unknown): string
export function windowPreview(windows: unknown, limit?: number): BadgeWindow[]
export function creditGroupsOf(accounts: unknown): { groups: BadgeGroup[]; failedCount: number; okCount: number }
export function planGroupsOf(rows: unknown): Array<Record<string, unknown>>
export function orderCreditRows(rows: unknown, options?: unknown): unknown
export function creditSectionLabel(groups: unknown): string
export function formatUpdatedAt(ms: unknown): string
