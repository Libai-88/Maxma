/**
 * 能力门控契约测试（PLUGIN-001 复查 · 缺陷 #6/#7）。
 *
 * ## 背景
 *
 * 插件把 credits-capabilities.js 定义为「**发请求前门控**的唯一真相源」，并在文件头
 * 记录了历史缺陷：客户端曾对不支持的 provider 无条件发请求 → 每次打开面板都留下
 * 必然失败的报错、把账号卡片渲染成「查询失败」。「修法不是吞掉错误，而是不发起请求。」
 *
 * 我移植时只用了 permanentLock 一个门控，复查实测影响：
 *   - 「一键领取积分」在 6 个渠道上是空按钮（点了必报 unsupported provider）；
 *   - 「账号测试」15 个渠道里只有 gemini 支持（表默认关闭、未登记即不渲染）；
 *   - **对 Loomy 显示「重测」会白烧积分**（Loomy 不限流，静默降级扣永久积分，
 *     插件记录的真实报障：「重测永远测不出限流、还会白烧积分」）；
 *   - 聊天页选「自动选号」（jet-hub-auto，**在渠道清单里**）时徽标每 60 秒
 *     轮询一个必然失败的 usage.badge（实测 `unsupported provider: jet-hub-auto`）。
 *
 * 本测试两层锁定：
 *   1. **能力表语义**——helper 的默认值与登记渠道不漂移；
 *   2. **源码契约**——界面的门控必须走能力矩阵（防止退回硬编码或无条件显示）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
  supportsAccountTest,
  supportsCreditBalance,
  supportsDailyCheckin,
  supportsOnboardingTasks,
  supportsRateLimit,
  supportsSubscriptionQuota,
} from '@/utils/jetHub/credits-capabilities.js'

const VIEW = readFileSync(join(__dirname, '../src/views/JetHubView.vue'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const BADGE = readFileSync(join(__dirname, '../src/components/chat/JetHubUsageBadge.vue'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

describe('能力表语义（插件定义，不得漂移）', () => {
  test('余额：14 个渠道支持，jet-hub-auto 不支持', () => {
    expect(supportsCreditBalance('opencode')).toBe(true)
    expect(supportsCreditBalance('gemini')).toBe(true)
    expect(supportsCreditBalance('jet-hub-auto')).toBe(false)
  })

  test('一键领取：workbuddy/cline/raccoon/opencode/gemini 不支持', () => {
    expect(supportsDailyCheckin('trae')).toBe(true)
    expect(supportsDailyCheckin('workbuddy')).toBe(false)
    expect(supportsDailyCheckin('cline')).toBe(false)
    expect(supportsDailyCheckin('raccoon')).toBe(false)
    expect(supportsDailyCheckin('opencode')).toBe(false)
  })

  test('账号测试：默认关闭，只登记 gemini（未登记 ⇒ 不渲染）', () => {
    expect(supportsAccountTest('gemini')).toBe(true)
    expect(supportsAccountTest('opencode')).toBe(false)
    expect(supportsAccountTest('codearts')).toBe(false)
  })

  test('限流：默认开启，只 loomy/gemini 显式关闭（loomy 不限流，重测白烧积分）', () => {
    expect(supportsRateLimit('trae')).toBe(true)
    expect(supportsRateLimit('loomy')).toBe(false)
    expect(supportsRateLimit('gemini')).toBe(false)
  })

  test('订阅额度只 cline；新人任务只 loomy/raccoon', () => {
    expect(supportsSubscriptionQuota('cline')).toBe(true)
    expect(supportsSubscriptionQuota('trae')).toBe(false)
    expect(supportsOnboardingTasks('loomy')).toBe(true)
    expect(supportsOnboardingTasks('raccoon')).toBe(true)
    expect(supportsOnboardingTasks('opencode')).toBe(false)
  })
})

describe('界面门控源码契约（必须走能力矩阵，不许硬编码/无条件）', () => {
  test('一键领取 / 刷新积分 / 积分区块都有门控', () => {
    expect(VIEW).toMatch(/v-if="canCreditBalance \|\| canDailyCheckin"/)
    expect(VIEW).toMatch(/v-if="canCreditBalance"/)
    expect(VIEW).toMatch(/v-if="canDailyCheckin"/)
    // 门控值来自能力矩阵，不是手写的 provider 判断
    expect(VIEW).toMatch(/supportsCreditBalance\(/)
    expect(VIEW).toMatch(/supportsDailyCheckin\(/)
  })

  test('重测/重置限流按钮按 canRateLimit 门控（Loomy 白烧积分问题）', () => {
    // 全部重置、单账号重测都用同一个门控；裸按钮（无 v-if）视为回归
    expect(VIEW).not.toMatch(/:disabled="store\.pending === 'reset-all'"(?![\s\S]{0,200}?v-if)/)
    expect(VIEW).toMatch(/v-if="canRateLimit"[\s\S]{0,220}?@click="resetRateLimits"/)
    expect(VIEW).toMatch(/v-if="canRateLimit"[\s\S]{0,220}?@click="resetAllLimits"/)
    expect(VIEW).toMatch(/v-if="canRateLimit"[\s\S]{0,260}?@click="retestOne\(/)
  })

  test('账号「测试」按钮按 canAccountTest 门控（只 gemini 支持）', () => {
    expect(VIEW).toMatch(/v-if="canAccountTest"[\s\S]{0,300}?@click="testAccount\(/)
  })

  test('切换渠道时按能力决定自动请求（不发起必然失败的调用）', () => {
    expect(VIEW).toMatch(/if \(supportsCreditBalance\(id\)\) void guard\('读取积分'/)
    expect(VIEW).toMatch(/if \(supportsPermanentLock\(id\)\) void store\.loadPermanentLock\(id\)/)
    // 不得退回无条件加载（行首就是调用、前面没有 if 门控的写法）
    expect(VIEW).not.toMatch(/^\s*void guard\('读取积分'/m)
  })

  test('徽标对不支持用量的渠道（jet-hub-auto）不挂载、不轮询', () => {
    expect(BADGE).toMatch(/supportsCreditBalance\(providerId\.value\)/)
  })

  test('Cline 面板走 supportsSubscriptionQuota，不再是 id === "cline"', () => {
    expect(VIEW).not.toMatch(/id === 'cline'/)
    expect(VIEW).toMatch(/supportsSubscriptionQuota\(/)
  })
})
