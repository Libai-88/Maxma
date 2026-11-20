import { describe, expect, test } from 'bun:test'

import {
  ancestorsOf,
  breadcrumbSegments,
  buildTreeRows,
  filterTreeRows,
  resolveTreeKey,
  type TreeNodeLike,
} from '../src/components/workbench/fileTreeModel.ts'
import type { WorkspaceTreeEntry } from '../src/types/workspace.ts'

function entry(path: string, type: WorkspaceTreeEntry['type'] = 'file'): WorkspaceTreeEntry {
  const name = path.split('/').pop() ?? path
  return { path, name, type, size: type === 'dir' ? 0 : 10, mtime: 0 }
}

function tree(): Record<string, TreeNodeLike> {
  return {
    '': {
      entries: [entry('src', 'dir'), entry('README.md'), entry('notes.md')],
    },
    src: {
      entries: [entry('src/nested.md'), entry('src/deep', 'dir')],
    },
    'src/deep': {
      entries: [entry('src/deep/deeper.txt')],
    },
  }
}

describe('文件树纯模型', () => {
  test('展开目录才把子项铺平，目录排在前面', () => {
    const rootOnly = buildTreeRows(tree(), new Set())
    expect(rootOnly.map((row) => row.entry.path)).toEqual(['src', 'README.md', 'notes.md'])
    expect(rootOnly[0]?.depth).toBe(0)

    const expanded = buildTreeRows(tree(), new Set(['src', 'src/deep']))
    expect(expanded.map((row) => row.entry.path)).toEqual([
      'src', 'src/nested.md', 'src/deep', 'src/deep/deeper.txt', 'README.md', 'notes.md',
    ])
    expect(expanded.find((row) => row.entry.path === 'src/deep/deeper.txt')?.depth).toBe(2)
  })

  test('过滤大小写不敏感，名称和相对路径都参与匹配', () => {
    const rows = buildTreeRows(tree(), new Set(['src']))
    expect(filterTreeRows(rows, 'read').map((row) => row.entry.path)).toEqual(['README.md'])
    expect(filterTreeRows(rows, 'SRC/').map((row) => row.entry.path)).toEqual([
      'src/nested.md', 'src/deep',
    ])
    expect(filterTreeRows(rows, '   ')).toBe(rows)
    expect(filterTreeRows(rows, 'missing')).toEqual([])
  })

  test('面包屑段与祖先目录由同一份路径规则推导', () => {
    expect(ancestorsOf('src/deep/deeper.txt')).toEqual(['src', 'src/deep'])
    expect(ancestorsOf('README.md')).toEqual([])
    expect(ancestorsOf('')).toEqual([])

    expect(breadcrumbSegments('src/deep/deeper.txt')).toEqual([
      { name: 'src', path: 'src', last: false },
      { name: 'deep', path: 'src/deep', last: false },
      { name: 'deeper.txt', path: 'src/deep/deeper.txt', last: true },
    ])
    expect(breadcrumbSegments('')).toEqual([])
  })

  test('键盘移动在两端夹住，不越界', () => {
    const rows = buildTreeRows(tree(), new Set())
    expect(resolveTreeKey(rows, 'src', 'ArrowDown', new Set())).toEqual({ type: 'move', path: 'README.md' })
    expect(resolveTreeKey(rows, 'src', 'ArrowUp', new Set())).toEqual({ type: 'move', path: 'src' })
    expect(resolveTreeKey(rows, 'notes.md', 'ArrowDown', new Set())).toEqual({ type: 'move', path: 'notes.md' })
    expect(resolveTreeKey(rows, 'unknown', 'ArrowDown', new Set())).toEqual({ type: 'move', path: 'README.md' })
  })

  test('键盘展开/折叠/打开与回到父级', () => {
    const collapsed = buildTreeRows(tree(), new Set())
    expect(resolveTreeKey(collapsed, 'src', 'ArrowRight', new Set())).toEqual({ type: 'toggle', path: 'src' })
    expect(resolveTreeKey(collapsed, 'src', 'Enter', new Set())).toEqual({ type: 'toggle', path: 'src' })
    expect(resolveTreeKey(collapsed, 'README.md', 'Enter', new Set())).toEqual({
      type: 'open',
      entry: entry('README.md'),
    })
    expect(resolveTreeKey(collapsed, 'README.md', 'ArrowLeft', new Set())).toEqual({ type: 'none' })

    const expandedRows = buildTreeRows(tree(), new Set(['src']))
    expect(resolveTreeKey(expandedRows, 'src', 'ArrowLeft', new Set(['src']))).toEqual({ type: 'toggle', path: 'src' })
    expect(resolveTreeKey(expandedRows, 'src/nested.md', 'ArrowLeft', new Set(['src']))).toEqual({
      type: 'move',
      path: 'src',
    })
    expect(resolveTreeKey(expandedRows, 'src/nested.md', 'Backspace', new Set(['src']))).toEqual({
      type: 'move',
      path: 'src',
    })
    expect(resolveTreeKey(expandedRows, 'src', 'ArrowRight', new Set(['src']))).toEqual({ type: 'none' })
    expect(resolveTreeKey(expandedRows, 'src', 'Escape', new Set(['src']))).toEqual({ type: 'none' })
  })

  test('空树不产生任何动作', () => {
    expect(resolveTreeKey([], '', 'ArrowDown', new Set())).toEqual({ type: 'none' })
  })
})
