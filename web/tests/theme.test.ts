import { describe, expect, test } from 'bun:test'
import {
  getThemeFamily,
  getThemeMode,
  isThemeId,
  themeId,
  THEME_FAMILIES,
} from '../src/lib/theme.ts'

describe('theme ids', () => {
  test('五套家族都有浅色与深色', () => {
    for (const family of THEME_FAMILIES) {
      expect(isThemeId(themeId(family.id, 'light'))).toBe(true)
      expect(isThemeId(themeId(family.id, 'dark'))).toBe(true)
      expect(getThemeFamily(themeId(family.id, 'dark'))).toBe(family.id)
      expect(getThemeMode(themeId(family.id, 'dark'))).toBe('dark')
    }
  })

  test('旧两态值不是新 ID，由读取层迁移', () => {
    expect(isThemeId('light')).toBe(false)
    expect(isThemeId('dark')).toBe(false)
    expect(isThemeId('flexoki-midnight')).toBe(false)
    expect(isThemeId(null)).toBe(false)
  })
})
