import { describe, expect, test } from 'bun:test'
import { computeScrollEdges, SCROLL_FADE_THRESHOLD } from '../src/lib/scrollFade.ts'

/**
 * 滚动边缘渐隐的判定是纯函数，可断言。这里守两件事：
 * 1. 没滚动时绝不能有顶部渐隐（否则首屏标题被永久淡掉，比不渐隐更糟）；
 * 2. 内容比容器矮时两侧都不渐隐（没有可滚内容却加遮罩只会白淡第一行）。
 */
describe('computeScrollEdges', () => {
  test('停在顶部且下方还有内容：只渐隐底部', () => {
    expect(computeScrollEdges(0, 4000, 800)).toEqual({ fadeTop: false, fadeBottom: true })
  })

  test('滚过阈值才出现顶部渐隐', () => {
    expect(computeScrollEdges(SCROLL_FADE_THRESHOLD, 4000, 800).fadeTop).toBe(false)
    expect(computeScrollEdges(SCROLL_FADE_THRESHOLD + 1, 4000, 800).fadeTop).toBe(true)
  })

  test('贴底时底部渐隐关闭', () => {
    expect(computeScrollEdges(3200, 4000, 800)).toEqual({ fadeTop: true, fadeBottom: false })
    expect(computeScrollEdges(3200 - SCROLL_FADE_THRESHOLD, 4000, 800).fadeBottom).toBe(false)
  })

  test('内容不足一屏：两侧都不渐隐', () => {
    expect(computeScrollEdges(0, 700, 800)).toEqual({ fadeTop: false, fadeBottom: false })
    expect(computeScrollEdges(0, 800, 800)).toEqual({ fadeTop: false, fadeBottom: false })
  })

  test('内容远长于一屏且停在中间：两侧都渐隐', () => {
    expect(computeScrollEdges(1000, 9000, 800)).toEqual({ fadeTop: true, fadeBottom: true })
  })
})
