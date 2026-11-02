/**
 * credits-capabilities.js 的类型声明（原样搬运的纯逻辑，见 credits-format.d.ts 的说明）。
 *
 * 这是「**发请求前门控**」的真相源：某个渠道支持哪些积分能力（余额 / 签到 /
 * 永久积分锁定 / 新人任务 / 订阅额度 / 限流读数 / 账号测试），界面据此决定
 * 显不显示按钮 —— 而不是让用户点了才吃一个 `unsupported provider`。
 */

export interface PermanentLockCopy {
  /** 到期窗口天数；Loomy 这类没有窗口概念的渠道为 null。 */
  days: number | null
  lockTitle: string
  lockedTitle: string
  lockedNotice: string
  unlockedNotice: string
}

export const CREDITS_CAPABILITIES: Readonly<Record<string, Record<string, boolean>>>
export const RATE_LIMIT_CAPABILITIES: Readonly<Record<string, boolean>>
export const ACCOUNT_TEST_CAPABILITIES: Readonly<Record<string, boolean>>
export const PERMANENT_LOCK_EXPIRING_WINDOW_DAYS: number

export function supportsRateLimit(provider: unknown): boolean
export function supportsAccountTest(provider: unknown): boolean
export function supportsPermanentLock(provider: unknown): boolean
export function supportsCreditPackageList(provider: unknown): boolean
export function supportsCreditBalance(provider: unknown): boolean
export function supportsDailyCheckin(provider: unknown): boolean
export function checkinProviders(): string[]
export function supportsOnboardingTasks(provider: unknown): boolean
export function onboardingTaskProviders(): string[]
export function supportsSubscriptionQuota(provider: unknown): boolean

/** 「锁定永久积分」的按钮/提示文案；判据是「是否按到期时间分桶」，不是「是不是 buddy」。 */
export function permanentLockCopy(provider: string, windowDays: unknown): PermanentLockCopy
