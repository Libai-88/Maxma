/** memory-search.test.ts — 记忆 BM25 排序、分类过滤、去重/冲突提示。 */
import { describe, expect, it } from 'bun:test'
import { searchMemoryEntries, tokenizeMemory } from '../src/memory/search'

const entries = [
  { id: 'birthday', description: '爸爸的生日是 8 月 5 日', category: '事实', updatedAt: '2026-08-01 10:00:00' },
  { id: 'gift', description: '爸爸喜欢机械键盘', category: '偏好', updatedAt: '2026-09-01 10:00:00' },
  { id: 'dup-a', description: '用户喜欢吃热干面', category: '偏好', updatedAt: '2026-07-01 10:00:00' },
  { id: 'dup-b', description: '爸爸喜欢吃热干面', category: '偏好', updatedAt: '2026-07-02 10:00:00' },
  { id: 'conflict-old', description: '爸爸不吃香菜', category: '偏好', updatedAt: '2026-06-01 10:00:00' },
  { id: 'conflict-new', description: '爸爸现在吃香菜了', category: '偏好', updatedAt: '2026-10-01 10:00:00' },
]

describe('memory hybrid search', () => {
  it('tokenizes Chinese into unigram + bigram and keeps latin words', () => {
    expect(tokenizeMemory('热干面 RTX 5090')).toContain('热干')
    expect(tokenizeMemory('热干面 RTX 5090')).toContain('rtx')
  })

  it('ranks exact topic above unrelated memories', () => {
    const result = searchMemoryEntries(entries, { query: '生日' })
    expect(result.returned[0]?.id).toBe('birthday')
    expect(result.returned.length).toBe(1)
  })

  it('supports category filtering without changing ranking rules', () => {
    const result = searchMemoryEntries(entries, { query: '吃', category: '偏好', limit: 3 })
    expect(result.returned.every((entry) => entry.category === '偏好')).toBe(true)
    expect(result.returned.length).toBeLessThanOrEqual(3)
  })

  it('flags near-duplicates and numeric/negation conflicts', () => {
    const result = searchMemoryEntries(entries, { query: '香菜 热干面' , limit: 10 })
    const duplicateIds = result.duplicateGroups.flatMap((group) => group.ids)
    const conflictIds = result.possibleConflicts.flatMap((group) => group.ids)
    expect(duplicateIds).toContain('dup-a')
    expect(duplicateIds).toContain('dup-b')
    expect(conflictIds).toContain('conflict-old')
    expect(conflictIds).toContain('conflict-new')
  })

  it('returns newest entries when query is empty', () => {
    const result = searchMemoryEntries(entries, { limit: 2 })
    expect(result.returned[0]?.id).toBe('conflict-new')
    expect(result.returned.length).toBe(2)
  })
})
