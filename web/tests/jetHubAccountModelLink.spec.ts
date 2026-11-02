// 从 dsh-codearts-auth 原样搬运的纯逻辑回归（plugin-src/client/account-model-link.js 的官方单测）。
// 只改了 import 路径，断言逐字未动。

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  allModelsDisabled,
  disablingLeavesNoEnabledAccount,
} from '../src/utils/jetHub/account-model-link.js'

/**
 * 「停用账号」与「关闭该 Provider 模型」之间的联动判定。
 *
 * ## 这组用例锁的是什么
 *
 * 门控判据刻意**不看 `enabled`**（「停用只应影响自动选号，与是否已登录无关」），
 * 这是既有整体设计。该设计导致：停用某 provider 的最后一个启用账号后，它的模型
 * **仍留在模型选择器里**。用户明确要求把这件事变成**一次显式选择**，而不是改门控
 * 语义 —— 本模块就是那个选择的判定。
 *
 * 因此两条边界必须锁死：
 * 1. **只在「停用后不再有任何启用账号」时才提示** —— 否则该 provider 还有别的
 *    启用账号时也会弹窗，关掉全部模型纯属误伤；
 * 2. **对已停用账号再点停用不提示**（空操作），否则用户会收到一个无从理解的确认框。
 */
describe('disablingLeavesNoEnabledAccount（停用后是否已无启用账号）', () => {
  const acct = (id, provider, enabled) => ({ id, provider, enabled })

  it('唯一启用账号被停用 → true', () => {
    expect(disablingLeavesNoEnabledAccount([acct('a', 'qoder', true)], 'a', 'qoder')).toBe(true)
  })

  it('还有别的启用账号 → false（不该误伤该 provider 的模型）', () => {
    const list = [acct('a', 'qoder', true), acct('b', 'qoder', true)]
    expect(disablingLeavesNoEnabledAccount(list, 'a', 'qoder')).toBe(false)
  })

  /** 已停用的同 provider 账号不算「启用账号」。 */
  it('其余账号都已停用 → true', () => {
    const list = [acct('a', 'qoder', true), acct('b', 'qoder', false)]
    expect(disablingLeavesNoEnabledAccount(list, 'a', 'qoder')).toBe(true)
  })

  /** 未声明 enabled 的条目按已启用处理（与 sanitizeAccounts 的默认值一致）。 */
  it('其余账号未声明 enabled 时按已启用处理 → false', () => {
    const list = [{ id: 'a', provider: 'qoder', enabled: true }, { id: 'b', provider: 'qoder' }]
    expect(disablingLeavesNoEnabledAccount(list, 'a', 'qoder')).toBe(false)
  })

  /**
   * **只看同一 provider**。
   *
   * 别的 provider 有启用账号与本 provider 的模型是否可用毫无关系 —— 若实现成
   * 「全表还有启用账号就不提示」，多 provider 用户永远不会收到该提示。
   */
  it('其他 provider 的启用账号不影响判定', () => {
    const list = [acct('a', 'qoder', true), acct('b', 'trae', true)]
    expect(disablingLeavesNoEnabledAccount(list, 'a', 'qoder')).toBe(true)
  })

  /** 对已停用账号再点停用是空操作，不提示。 */
  it('目标账号本就已停用 → false', () => {
    expect(disablingLeavesNoEnabledAccount([acct('a', 'qoder', false)], 'a', 'qoder')).toBe(false)
  })

  /** 列表过期（找不到该账号）时不提示：状态未知就不该弹确认框。 */
  it('账号不在列表里 → false', () => {
    expect(disablingLeavesNoEnabledAccount([acct('b', 'qoder', true)], 'a', 'qoder')).toBe(false)
  })

  it('null / 非数组输入不抛错', () => {
    expect(disablingLeavesNoEnabledAccount(null, 'a', 'qoder')).toBe(false)
    expect(disablingLeavesNoEnabledAccount(undefined, 'a', 'qoder')).toBe(false)
    expect(disablingLeavesNoEnabledAccount('nope', 'a', 'qoder')).toBe(false)
  })
})

describe('allModelsDisabled（是否全部已关闭）', () => {
  it('全部关闭 → true', () => {
    expect(allModelsDisabled([{ disabled: true }, { disabled: true }])).toBe(true)
  })

  it('存在已打开 → false', () => {
    expect(allModelsDisabled([{ disabled: true }, { disabled: false }])).toBe(false)
  })

  /** 未声明 disabled 的条目算已打开（与适配器黑名单语义一致）。 */
  it('未声明 disabled 的条目算已打开 → false', () => {
    expect(allModelsDisabled([{ disabled: true }, {}])).toBe(false)
  })

  /**
   * 空列表返回 false：没有模型可谈，「打开全部」也无事可做。
   * 若返回 true，启用账号时会弹出一个「是否打开 0 个模型」的荒谬确认框。
   */
  it('空列表 → false（避免弹出「是否打开 0 个模型」）', () => {
    expect(allModelsDisabled([])).toBe(false)
    expect(allModelsDisabled(null)).toBe(false)
    expect(allModelsDisabled(undefined)).toBe(false)
  })
})

/**
 * 接线守卫（源码级）—— **改为锁 Maxma 侧的等价接线**。
 *
 * 原版这一段读的是插件自己的 React 客户端 `plugin-src/client/jet-hub.js`，锁的是
 * 「联动判定接在 toggleAccount 上、且在提交 account.update 之前取」。那个文件在
 * Maxma 里不存在（客户端 bundle 也不进 Maxma），所以这里改为锁 **Maxma 的 Jet Hub 页**：
 * 同样的两条不变式，锁的是我们这边的实现。
 *
 * ⚠️ 「判定必须在提交之前」这条尤其不能省：提交后列表已刷新，
 * 「是否还有启用账号」的答案就变成变更后的状态，多账号场景会误判。
 */
describe('停用账号联动接线（Maxma 侧源码级回归）', () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/views/JetHubView.vue'),
    'utf8',
  )
  const normalized = source.replace(/\r\n/g, '\n')

  it('引用搬运过来的纯逻辑模块，而不是另写一份判定', () => {
    expect(source).toContain("utils/jetHub/account-model-link.js")
    expect(source).toContain('disablingLeavesNoEnabledAccount')
  })

  it('联动判定在提交 account.update 之前完成', () => {
    const start = normalized.indexOf('async function toggleAccountEnabled')
    expect(start).toBeGreaterThan(-1)
    const body = normalized.slice(start, start + 1600)
    const guardAt = body.indexOf('disablingLeavesNoEnabledAccount')
    const submitAt = body.indexOf('updateAccount')
    expect(guardAt).toBeGreaterThan(-1)
    expect(submitAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(submitAt)
  })
})
