import { describe, expect, test } from 'bun:test'
/**
 * 密度的存储口径是纯函数：只认两个值，其它一律回落到默认。
 * 这条守的是"被手改坏的 localStorage 不能让界面卡在未知档位"。
 */
import { DEFAULT_DENSITY, normalizeDensity } from '../src/lib/density.ts'

describe('normalizeDensity', () => {
  test('认得出两个已知档位', () => {
    expect(normalizeDensity('comfortable')).toBe('comfortable')
    expect(normalizeDensity('compact')).toBe('compact')
  })

  test('未设置 / 空值回落到默认', () => {
    expect(normalizeDensity(null)).toBe(DEFAULT_DENSITY)
    expect(normalizeDensity(undefined)).toBe(DEFAULT_DENSITY)
    expect(normalizeDensity('')).toBe(DEFAULT_DENSITY)
  })

  test('未知字符串与类型一律回落', () => {
    expect(normalizeDensity('dense')).toBe(DEFAULT_DENSITY)
    expect(normalizeDensity('COMPACT')).toBe(DEFAULT_DENSITY)
    expect(normalizeDensity(1)).toBe(DEFAULT_DENSITY)
    expect(normalizeDensity({})).toBe(DEFAULT_DENSITY)
  })
})
