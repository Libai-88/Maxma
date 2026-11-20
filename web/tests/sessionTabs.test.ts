import { describe, expect, test } from 'bun:test'

import { MAX_SESSION_TABS, parseTabIds, pushTabId } from '../src/stores/sessionTabs.ts'

describe('并行会话 tab', () => {
  test('最近打开的会话排第一，重复打开不新增', () => {
    expect(pushTabId(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushTabId(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(pushTabId(['a', 'b'], '')).toEqual(['a', 'b'])
  })

  test('最多保留三个 live tab，超出淘汰最旧', () => {
    expect(pushTabId(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b'])
    expect(pushTabId(['a', 'b', 'c'], 'd')).toHaveLength(MAX_SESSION_TABS)
  })

  test('持久化只接受非空字符串，损坏数据回退为空', () => {
    expect(parseTabIds(JSON.stringify(['a', '', 1, 'b']))) .toEqual(['a', 'b'])
    expect(parseTabIds('{broken')).toEqual([])
    expect(parseTabIds(null)).toEqual([])
  })
})
