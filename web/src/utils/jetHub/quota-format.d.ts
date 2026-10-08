/**
 * quota-format.js 的类型声明（原样搬运的纯逻辑，见 credits-format.d.ts 的说明）。
 */

/** 订阅额度窗口的固定顺序（徽标与设置页共用同一口径）。 */
export const QUOTA_WINDOWS: readonly string[]

/** 窗口类型 → 展示标签。 */
export function quotaWindowLabel(type: string): string

/** 归一窗口列表，返回 `[type, label, window]` 三元组（顺序由 QUOTA_WINDOWS 固定）。 */
export function quotaWindowsOf(windows: unknown): Array<[string, string, { percentUsed?: number; resetsAt?: number }]>

/** 距重置时刻的倒计时文案。 */
export function quotaCountdown(resetsAt: unknown): string

/** 「N 后重置」文案；无有效时刻返回空串。 */
export function quotaResetsIn(resetsAt: unknown): string

/** 百分比 → 色调（ok / warn / error）。 */
export function quotaTone(percent: unknown): string

/** 百分比取值并夹取到 [0, 100]。 */
export function quotaPercentValue(percent: unknown): number

/** 百分比格式化（取整 + `%`）。 */
export function formatQuotaPercent(percent: unknown): string
