import { describe, expect, test } from 'bun:test'
import { deriveAltHue, hexToHsl } from '../src/utils/themeColor.ts'

/**
 * 第二色相是背景动效唯一的“会自己变色”的地方。五套主题的强调色里
 * 有蓝色和青绿，+28° 很容易正好落进紫色带；这条守的是“全系无紫”。
 */
describe('deriveAltHue', () => {
  test('蓝色与青绿强调色不会派生到紫色带', () => {
    for (const accent of ['#4D699B', '#7E9CD8', '#24837B', '#3A94C5', '#7FBBB3']) {
      const [h] = hexToHsl(deriveAltHue(accent))
      expect(h >= 270 && h <= 330).toBe(false)
    }
  })

  test('粉色强调色仍保持邻近色关系', () => {
    const [sourceH] = hexToHsl('#F15FB4')
    const [derivedH] = hexToHsl(deriveAltHue('#F15FB4'))
    const distance = Math.min(
      Math.abs(sourceH - derivedH),
      360 - Math.abs(sourceH - derivedH),
    )
    expect(distance).toBeGreaterThan(10)
  })
})
