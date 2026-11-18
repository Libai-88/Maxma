import { describe, expect, test } from 'bun:test'
import {
  clampFloatingPos,
  defaultFloatingPos,
  FLOATING_MARGIN,
  readStoredPos,
  writeStoredPos,
} from '../src/utils/floatingWindow.ts'

/**
 * 浮窗位置的边界行为。这里守的是**拖动后还能找回来**：
 * 一旦允许窗口飘出视口，用户只能重载页面恢复——比"不能拖"更糟。
 */
describe('floatingWindow', () => {
  test('默认停靠右下、输入框上方，且不出视口', () => {
    const pos = defaultFloatingPos({ width: 360, height: 260 }, { width: 1280, height: 900 })
    expect(pos.x).toBe(1280 - 360 - 16)
    expect(pos.y).toBe(900 - 260 - 96)
  })

  test('窗口比视口还高时贴住上边而不是负数', () => {
    const pos = defaultFloatingPos({ width: 360, height: 1200 }, { width: 1280, height: 900 })
    expect(pos.y).toBe(16)
  })

  test('拖到左上/右下越界都被钳回，且留出边距', () => {
    expect(clampFloatingPos({ x: -500, y: -20 }, { width: 300, height: 200 }, { width: 1000, height: 800 }))
      .toEqual({ x: FLOATING_MARGIN, y: FLOATING_MARGIN })
    expect(clampFloatingPos({ x: 5000, y: 5000 }, { width: 300, height: 200 }, { width: 1000, height: 800 }))
      .toEqual({ x: 1000 - 300 - FLOATING_MARGIN, y: 800 - 200 - FLOATING_MARGIN })
  })

  test('小视口下不会算出比边距更小的值（钳制的上下界不交叉）', () => {
    const pos = clampFloatingPos({ x: 100, y: 100 }, { width: 400, height: 200 }, { width: 300, height: 150 })
    expect(pos.x).toBe(FLOATING_MARGIN)
    expect(pos.y).toBe(FLOATING_MARGIN)
  })

  test('存储内容损坏/缺失时返回 null，调用方回退默认锚点', () => {
    expect(readStoredPos('k', { getItem: () => null })).toBeNull()
    expect(readStoredPos('k', { getItem: () => '{oops' })).toBeNull()
    expect(readStoredPos('k', { getItem: () => JSON.stringify({ x: 'no', y: 1 }) })).toBeNull()
    expect(readStoredPos('k', { getItem: () => JSON.stringify({ x: 12, y: 34 }) })).toEqual({ x: 12, y: 34 })
  })

  test('写入失败不抛出（隐私模式/配额满时拖动仍要能用）', () => {
    expect(() => writeStoredPos('k', { x: 1, y: 2 }, { setItem: () => { throw new Error('quota') } })).not.toThrow()
  })
})
