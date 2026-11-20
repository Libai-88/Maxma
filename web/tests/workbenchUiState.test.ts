import { describe, expect, test } from 'bun:test'

import { parseWorkspaceUiState, readWorkspaceUiState } from '../src/stores/workbench.ts'

describe('Workbench UI 状态迁移', () => {
  test('v2 键优先，合法 tab/宽度/最大化原样恢复', () => {
    const state = readWorkspaceUiState({
      getItem: (key) => key === 'maxmahere.workbench-ui.v2'
        ? JSON.stringify({ isOpen: true, activeTab: 'files', width: 404, maximized: true })
        : JSON.stringify({ isOpen: true, activeTab: 'canvas', width: 500 }),
    })
    expect(state).toEqual({ isOpen: true, activeTab: 'files', width: 404, maximized: true })
  })

  test('v2 缺失时读旧 v1 键', () => {
    const state = readWorkspaceUiState({
      getItem: (key) => key === 'maxmahere.canvas-ui-state.v1'
        ? JSON.stringify({ isOpen: true, activeTab: 'canvas' })
        : null,
    })
    expect(state.isOpen).toBe(true)
    expect(state.activeTab).toBe('canvas')
    expect(state.width).toBe(380)
  })

  test('未知 tab、损坏 JSON、false 值都回退到安全默认', () => {
    expect(parseWorkspaceUiState({ isOpen: 'yes', activeTab: 'terminal' })).toEqual({
      isOpen: false,
      activeTab: 'reasoning',
      width: 380,
      maximized: false,
    })
    expect(readWorkspaceUiState({ getItem: () => '{broken' })).toEqual({
      isOpen: false,
      activeTab: 'reasoning',
      width: 380,
      maximized: false,
    })
    expect(readWorkspaceUiState(null)).toEqual({
      isOpen: false,
      activeTab: 'reasoning',
      width: 380,
      maximized: false,
    })
  })

  test('宽度按 320–860 夹紧，NaN 回落默认', () => {
    expect(parseWorkspaceUiState({ width: 100 }).width).toBe(320)
    expect(parseWorkspaceUiState({ width: 9999 }).width).toBe(860)
    expect(parseWorkspaceUiState({ width: 404.4 }).width).toBe(404)
    expect(parseWorkspaceUiState({ width: Number.NaN }).width).toBe(380)
    expect(parseWorkspaceUiState({ width: '404' }).width).toBe(380)
  })
})
