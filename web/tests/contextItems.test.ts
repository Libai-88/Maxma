/**
 * web/tests/contextItems.test.ts — C5 上下文总线的纯函数回归。
 *
 * 锁四件事：非法引用不进对话、重复引用去重、快照按会话隔离、正文截断。
 */

import { describe, expect, test } from 'bun:test'

import {
  MAX_CONTEXT_ITEMS,
  contextItemToRef,
  contextItemsToRefs,
  loadContextSnapshot,
  mergeContextItems,
  normalizeContextItem,
  removeContextItem,
  saveContextSnapshot,
  type ContextStorage,
} from '../src/context/contextItems.ts'

function memoryStorage(): ContextStorage & { dump(): Map<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
    dump: () => map,
  }
}

describe('上下文条目归一化', () => {
  test('缺来源或缺正文的条目不进对话', () => {
    expect(normalizeContextItem({ kind: 'canvas-element', label: '空' }, 's1')).toBeNull()
    expect(normalizeContextItem({ kind: 'nope', label: 'x', text: 'y' }, 's1')).toBeNull()
    expect(normalizeContextItem({ kind: 'file', path: '/a.ts' }, 's1')).toBeNull()
    expect(normalizeContextItem({ kind: 'file', label: 'a.ts', path: '/a.ts' }, 's1')).not.toBeNull()
  })

  test('同内容生成同一 id；合并去重且最多 20 条', () => {
    const a = normalizeContextItem({ kind: 'file', label: 'a.ts', path: '/a.ts' }, 's1')!
    const a2 = normalizeContextItem({ kind: 'file', label: 'a.ts', path: '/a.ts' }, 's1')!
    expect(a.id).toBe(a2.id)
    let items = mergeContextItems([], a)
    items = mergeContextItems(items, a2)
    expect(items).toHaveLength(1)
    for (let i = 0; i < 30; i += 1) {
      items = mergeContextItems(items, normalizeContextItem({ kind: 'command-output', label: `c${i}`, text: `out ${i}` }, 's1'))
    }
    expect(items).toHaveLength(MAX_CONTEXT_ITEMS)
    expect(items.at(-1)!.label).toBe('c29')
  })

  test('超长正文截断并留下提示', () => {
    const text = 'x'.repeat(9_000)
    const item = normalizeContextItem({ kind: 'command-output', label: '长输出', text }, 's1')!
    expect(item.text).toContain('已截断')
    expect(item.text!.length).toBeLessThan(9_000)
  })
})

describe('转成对话引用', () => {
  test('文件保持原生 file 引用；网页与画布变成 context 引用并带正文', () => {
    const file = normalizeContextItem({ kind: 'file', label: 'index.ts', path: 'D:/repo/index.ts' }, 's1')!
    expect(contextItemToRef(file)).toMatchObject({ type: 'file', path: 'D:/repo/index.ts' })

    const browser = normalizeContextItem({
      kind: 'browser-selection',
      label: '网页元素 a',
      url: 'https://example.com/a',
      text: '正文片段',
      meta: { 选择器: 'main > p' },
    }, 's1')!
    const ref = contextItemToRef(browser) as { type: string; text: string }
    expect(ref.type).toBe('context')
    expect(ref.text).toContain('https://example.com/a')
    expect(ref.text).toContain('main > p')
    expect(ref.text).toContain('正文片段')
  })

  test('contextItemsToRefs 去掉重复引用', () => {
    const a = normalizeContextItem({ kind: 'canvas-element', label: 'T', text: 'same' }, 's1')!
    const b = normalizeContextItem({ kind: 'canvas-element', label: 'T2', text: 'same' }, 's1')!
    expect(contextItemsToRefs([a, b])).toHaveLength(1)
  })
})

describe('会话级快照', () => {
  test('保存/恢复；不同会话互不串', () => {
    const storage = memoryStorage()
    const item = normalizeContextItem({ kind: 'file', label: 'a.ts', path: '/a.ts' }, 's1')!
    saveContextSnapshot(storage, 's1', [item])
    expect(loadContextSnapshot(storage, 's1')).toHaveLength(1)
    expect(loadContextSnapshot(storage, 's2')).toEqual([])
    expect(storage.dump().size).toBe(1)
  })

  test('损坏快照或版本不对返回空，不抛错', () => {
    const storage = memoryStorage()
    storage.setItem('maxma.context.bad', '{not json')
    expect(loadContextSnapshot(storage, 'bad')).toEqual([])
    storage.setItem('maxma.context.v2', JSON.stringify({ version: 2, sessionId: 'v2', items: [] }))
    expect(loadContextSnapshot(storage, 'v2')).toEqual([])
  })

  test('空列表会删除快照；移除条目按 id', () => {
    const storage = memoryStorage()
    const a = normalizeContextItem({ kind: 'file', label: 'a', path: '/a' }, 's1')!
    saveContextSnapshot(storage, 's1', [a])
    saveContextSnapshot(storage, 's1', [])
    expect(storage.dump().size).toBe(0)
    expect(removeContextItem([a], a.id)).toEqual([])
  })
})
