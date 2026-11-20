import { describe, expect, test } from 'bun:test'

import {
  WORKBENCH_PANES,
  WORKBENCH_PANE_LABELS,
  availableWorkbenchTabs,
  rememberVisitedPane,
  resolveWorkbenchTab,
} from '../src/components/workbench/panes.ts'

describe('Workbench Pane 注册表', () => {
  test('桌面 + 浏览器桥：七类 Pane 顺序固定，且每个都有中文名', () => {
    const tabs = availableWorkbenchTabs({ desktop: true, browser: true })
    expect(tabs).toEqual(['reasoning', 'canvas', 'files', 'changes', 'commands', 'browser', 'tasks'])
    for (const tab of tabs) expect(WORKBENCH_PANE_LABELS[tab]).toBeTruthy()
  })

  test('纯 Web：不出现文件/变更/命令/浏览器死入口', () => {
    expect(availableWorkbenchTabs({ desktop: false, browser: false })).toEqual([
      'reasoning',
      'canvas',
      'tasks',
    ])
  })

  test('有桌面桥但浏览器桥缺失时不放浏览器入口', () => {
    const tabs = availableWorkbenchTabs({ desktop: true, browser: false })
    expect(tabs).toContain('files')
    expect(tabs).not.toContain('browser')
  })

  test('持久化的旧 tab 失效时回退到第一个可用 Pane', () => {
    expect(resolveWorkbenchTab(['reasoning', 'canvas', 'tasks'], 'browser')).toBe('reasoning')
    expect(resolveWorkbenchTab(['reasoning', 'canvas', 'tasks'], 'canvas')).toBe('canvas')
    expect(resolveWorkbenchTab([], 'browser')).toBe('reasoning')
  })

  test('已访问 Pane 只增不减，切换回来不丢状态', () => {
    const first = rememberVisitedPane([], 'files')
    const second = rememberVisitedPane(first, 'browser')
    const again = rememberVisitedPane(second, 'files')
    expect(again).toEqual(['files', 'browser'])
  })

  test('每个 Pane 都自带加载器与布局策略，宿主不许再维护第二份 tab 分支', () => {
    expect(new Set(WORKBENCH_PANES.map((pane) => pane.id)).size).toBe(WORKBENCH_PANES.length)
    for (const pane of WORKBENCH_PANES) {
      expect(typeof pane.load).toBe('function')
      expect(pane.bodyClassName.trim().length).toBeGreaterThan(0)
      expect(pane.keepAlive).toBe(true)
    }
  })
})
