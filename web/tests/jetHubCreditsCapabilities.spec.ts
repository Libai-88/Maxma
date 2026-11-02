/**
 * 积分能力矩阵与「锁定永久积分」文案（PLUGIN-001 / P10）。
 *
 * 模块是**原样搬运**的 `dsh-codearts-auth/plugin-src/client/credits-capabilities.js`
 * （自包含、零依赖）。它的官方单测在插件仓库里 import 了若干**不随包发布**的宿主模块
 * （`src/jet-hub-rpc.js` 等），无法原样复制，故这里按同样的口径重写断言：
 *
 *   - 能力矩阵就是「发请求前门控」的真相源 —— 界面据此决定按钮显不显示，
 *     而不是让用户点了才吃一个 `unsupported provider`；
 *   - 「锁定永久积分」文案的判据是「**是否按到期时间分桶**」，不是「是不是 buddy」：
 *     trae / lobsterai 与 buddy 系走同一套分桶，若落到 Loomy 那套「每日赠送额度」
 *     文案就是错的（它们根本没有「每日额度」概念）。
 *
 * ⚠️ 客户端能力表与**宿主侧** provider 集合必须一致 —— 那条跨端断言在
 * `bun-backend/tests/plugins/jet-hub-coverage.test.ts` 里（后端套件才装了插件包）。
 */

import { describe, expect, it } from 'vitest'

import {
  PERMANENT_LOCK_EXPIRING_WINDOW_DAYS,
  permanentLockCopy,
  supportsCreditBalance,
  supportsDailyCheckin,
  supportsOnboardingTasks,
  supportsPermanentLock,
  supportsRateLimit,
  supportsSubscriptionQuota,
} from '../src/utils/jetHub/credits-capabilities.js'

describe('积分能力矩阵（发请求前门控）', () => {
  it('锁定永久积分只对按到期分桶或有命名池的渠道开放', () => {
    for (const provider of ['buddy', 'workbuddy', 'loomy', 'lobsterai', 'trae']) {
      expect(supportsPermanentLock(provider), `${provider} 应当支持锁定`).toBe(true)
    }
    // 其余渠道一律不支持：界面不该给它们渲染锁定按钮
    for (const provider of ['cline', 'qoder', 'zcode', 'gemini', 'opencode', 'jet-hub-auto', '']) {
      expect(supportsPermanentLock(provider), `${provider} 不应支持锁定`).toBe(false)
    }
    expect(supportsPermanentLock(undefined)).toBe(false)
    expect(supportsPermanentLock(null)).toBe(false)
  })

  it('订阅额度只对 Cline 开放（面板据此分支）', () => {
    expect(supportsSubscriptionQuota('cline')).toBe(true)
    for (const provider of ['buddy', 'trae', 'loomy']) {
      expect(supportsSubscriptionQuota(provider)).toBe(false)
    }
  })

  it('未知渠道默认「无此能力」，而不是抛错', () => {
    for (const check of [supportsCreditBalance, supportsDailyCheckin, supportsOnboardingTasks, supportsPermanentLock]) {
      expect(check('nope')).toBe(false)
      expect(check(undefined)).toBe(false)
      expect(check(null)).toBe(false)
    }
  })

  it('限流读数是**默认放行**（未登记即视为有限流，界面照常显示读数）', () => {
    // ⚠️ 这一条与上面那组相反，是刻意的：未登记的渠道被当作「有限流」，
    // 于是「重测 / 重置」照常渲染。插件在这个函数上明确写了默认 true，
    // 别为了「统一」把它改成默认 false —— 那会让新渠道静默失去限流相关按钮。
    expect(supportsRateLimit('nope')).toBe(true)
    expect(supportsRateLimit(undefined)).toBe(true)
    // 而明确登记为「不会因模型限流被拒」的渠道是 false
    expect(supportsRateLimit('gemini')).toBe(false)
  })

  it('新人任务的渠道集合与端点能力一致（loomy / raccoon）', () => {
    expect(supportsOnboardingTasks('loomy')).toBe(true)
    expect(supportsOnboardingTasks('raccoon')).toBe(true)
    expect(supportsOnboardingTasks('trae')).toBe(false)
  })
})

describe('「锁定永久积分」文案', () => {
  it('按到期分桶的四家走带天数的文案（含 trae / lobsterai）', () => {
    for (const provider of ['buddy', 'workbuddy', 'trae', 'lobsterai']) {
      const copy = permanentLockCopy(provider, 31)
      expect(copy.days).toBe(31)
      // ⚠️ 天数必须来自入参（插件可被 DSH_BUDDY_EXPIRING_WINDOW_DAYS 覆盖），
      // 写死 15 会让文案与实际选号判据分叉
      expect(copy.lockTitle).toContain('31 天内到期')
      expect(copy.lockedTitle).toContain('31 天内到期')
      expect(copy.lockedNotice).toContain('31 天内到期')
      expect(copy.unlockedNotice).toContain('31 天内到期')
    }
  })

  it('Loomy 走「每日赠送额度」文案且不带天数（它没有窗口概念）', () => {
    const copy = permanentLockCopy('loomy', 15)
    expect(copy.days).toBeNull()
    expect(copy.lockTitle).toContain('每日赠送额度')
    expect(copy.lockTitle).not.toContain('天内到期')
  })

  it('窗口天数非法时回落默认常量，但数字 0 是合法值', () => {
    // ⚠️ 三条边界：undefined/null/'' 必须回落（否则会渲染「只消耗 0 天内到期的积分」这种荒谬提示），
    // 而**数字 0 是合法值**（表示「没有临时积分」），不能被 `||` 静默换成默认。
    for (const bad of [undefined, null, '', 'x', -1]) {
      expect(permanentLockCopy('buddy', bad).days).toBe(PERMANENT_LOCK_EXPIRING_WINDOW_DAYS)
    }
    expect(permanentLockCopy('buddy', 0).days).toBe(0)
    expect(permanentLockCopy('buddy', 0).lockTitle).toContain('0 天内到期')
  })

  it('文案明确了「用尽后没有可用账号」，而不是含糊的「可能不可用」', () => {
    // 这条是用户能否做出正确判断的关键：锁定后临期积分用尽会**直接没有可用账号**，
    // 而不是偷偷烧掉永久积分（插件 README 的原话）。两个分支措辞不同：
    // 带天数的那支说「将没有可用账号」，Loomy 那支说「今日额度用尽即无可用账号」。
    expect(permanentLockCopy('loomy', null).lockTitle).toContain('无可用账号')
    expect(permanentLockCopy('loomy', null).lockedTitle).toContain('没有可用账号')
    expect(permanentLockCopy('buddy', 15).lockedTitle).toContain('没有可用账号')
    expect(permanentLockCopy('buddy', 15).lockTitle).toContain('没有可用账号')
    // 两套文案都必须点明「锁定能保住永久积分」这个收益，否则用户只看到风险
    expect(permanentLockCopy('loomy', null).lockTitle).toContain('保住永久积分')
    expect(permanentLockCopy('buddy', 15).lockTitle).toContain('不用就作废')
  })
})
