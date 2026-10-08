/**
 * 积分余额渲染（PLUGIN-001，缺陷修复）。
 *
 * 真实缺陷：账号登录后点「刷新积分」仍显示 **0**。
 *
 * 根因是一行读错字段：
 * ```vue
 * {{ fmtNumber(entry.balance) }} {{ entry.unit || '' }}   // ← 错
 * ```
 * 而 `credits.balances` 的真实返回形状（真机抓取）是：
 * ```json
 * { "accountId": "opencode-anon-ecd49c", "nickname": "匿名通道",
 *   "balance": { "total": 1,
 *                "packages": [{ "name": "可用通道", "unit": "通道", "remaining": 1, ... }],
 *                "expiredTotal": 0 } }
 * ```
 * **余额在 `balance.total`，单位在 `packages[].unit`** —— 两者都不在账号对象上。
 * `Number(对象)` 得 NaN → 恒显示 0，与账号是否登录无关。
 *
 * 这里锁三件事：
 *   1. 余额取 `balance.total`，单位从 `packages[].unit` 归一（复用搬运过来的口径）；
 *   2. **读不到数的账号不画成 0**（0 会被读成「额度用光了」，实际是「没读到」）；
 *   3. 数值与单位标签的拼法对齐插件客户端（`formatUnits(total, unit) + label`，不加空格）。
 */

import { describe, expect, it } from 'vitest'

import { creditGroupsOf } from '../src/utils/jetHub/badge-model.js'
import { formatUnits } from '../src/utils/jetHub/credits-format.js'

/**
 * 与 `web/src/views/JetHubView.vue` 的 `creditLine()` 保持同构。
 *
 * ⚠️ 这里刻意复制一份实现而不是 import 组件里的函数：那个函数在 `.vue` 的
 * `<script setup>` 里，外部无法 import。复制意味着**两边可能漂移** ——
 * 所以下面有一条「源码契约」用例直接读 .vue 文件，确保组件用的仍是同一套口径。
 */
function creditLine(entry: Record<string, unknown>): string {
  const balance = entry?.balance as { total?: unknown } | undefined
  if (!balance || typeof balance.total !== 'number' || !Number.isFinite(balance.total)) {
    return '未读取到'
  }
  const { groups } = creditGroupsOf([entry])
  const group = groups[0]
  if (group) {
    if (Array.isArray(group.quotaLines) && group.quotaLines.length > 0) {
      return group.quotaLines.join(' · ')
    }
    return `${formatUnits(group.total, group.unit)}${group.label}`
  }
  return formatUnits(balance.total, '')
}

/** 真机抓到的形状：余额在 balance.total，单位在 packages[].unit。 */
function account(balance: unknown, nickname = '账号'): Record<string, unknown> {
  return { accountId: 'acc-1', nickname, balance }
}

describe('积分余额渲染', () => {
  it('从 balance.total 读数（而不是把 balance 对象当数字）', () => {
    // 这就是原缺陷的形状：若按 `Number(entry.balance)` 读会得 NaN → 0
    const entry = account({
      total: 1,
      packages: [{ name: '可用通道', unit: '通道', remaining: 1, total: 1, used: 0, active: true }],
      expiredTotal: 0,
    })
    expect(creditLine(entry)).toBe('1积分')
    expect(creditLine(entry)).not.toBe('0')
  })

  it('单位从 packages[].unit 取并归一（同义异拼 credit/credits 归一组）', () => {
    const credits = account({ total: 120, packages: [{ unit: 'credits', remaining: 120 }], expiredTotal: 0 })
    const credit = account({ total: 120, packages: [{ unit: 'credit', remaining: 120 }], expiredTotal: 0 })
    expect(creditLine(credits)).toBe('120积分')
    expect(creditLine(credit)).toBe('120积分')
  })

  it('token 单位走 token 格式化（ZCode 的额度是 token 不是积分）', () => {
    const entry = account({ total: 94540, packages: [{ unit: 'token', remaining: 94540 }], expiredTotal: 0 })
    expect(creditLine(entry)).toBe('94.54KToken')
    // 不得写成「积分」—— 插件记录过这个缺陷（同一屏里标题说积分、数值说 Token）
    expect(creditLine(entry)).not.toContain('积分')
  })

  it('读不到余额的账号显示「未读取到」，不画成 0', () => {
    // 0 会被读成「额度用光了」，而实际是「没读到」——两者用户要做的下一步完全不同
    expect(creditLine(account(null))).toBe('未读取到')
    expect(creditLine(account(undefined))).toBe('未读取到')
    expect(creditLine({ accountId: 'x' })).toBe('未读取到')
    expect(creditLine(account({ total: Number.NaN }))).toBe('未读取到')
  })

  it('数值与单位标签紧贴、中间不加空格（对齐插件客户端拼法）', () => {
    const entry = account({ total: 120, packages: [{ unit: 'credits', remaining: 120 }], expiredTotal: 0 })
    expect(creditLine(entry)).toBe('120积分')
    expect(creditLine(entry)).not.toMatch(/120\s+积分/)
  })

  it('多个账号各自独立读数（不跨账号求和）', () => {
    const rows = [
      account({ total: 1, packages: [{ unit: '通道', remaining: 1 }], expiredTotal: 0 }, '匿名通道'),
      account({ total: 120, packages: [{ unit: 'credits', remaining: 120 }], expiredTotal: 0 }, '主号'),
    ]
    const lines = rows.map(creditLine)
    expect(lines).toEqual(['1积分', '120积分'])
    // 跨账号求和（121）是错的：面板逐账号列出
    expect(lines.join('')).not.toContain('121')
  })
})

describe('组件源码契约（防漂移）', () => {
  it('JetHubView 的 creditLine 使用 balance.total + 搬运过来的单位口径', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(import.meta.dirname, '../src/views/JetHubView.vue'), 'utf8')

    // 必须读 balance.total，而不是把 balance 当数字
    expect(source).toContain('balance.total')
    expect(source).toContain('creditGroupsOf')
    expect(source).toContain('creditLine(entry)')

    // 不得再出现原来的错误写法。⚠️ 先把注释剥掉再断言 —— 修复说明里**引用了**
    // 那段错误代码（`fmtNumber(entry.balance) + entry.unit`），直接全文匹配会自伤。
    const withoutComments = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(withoutComments, '不要把 balance 对象直接喂给 fmtNumber').not.toMatch(/fmtNumber\(entry\.balance\)/)
    expect(withoutComments, '账号对象上没有 unit 字段').not.toMatch(/entry\.unit/)
  })
})
