import { describe, expect, it } from 'vitest'

import { resolveStickerSrc } from '@/utils/markdown'

// 文件名按后端 FILENAME_RE 只允许 ASCII（[\w-]+），目录可以是中文。
describe('resolveStickerSrc', () => {
  it.each([
    ['日常/happy.webp', '/api/stickers/日常/happy.webp'],
    ['./日常/happy.webp', '/api/stickers/日常/happy.webp'],
    ['stickers/日常/happy.webp', '/api/stickers/日常/happy.webp'],
    ['config/stickers/日常/happy.webp', '/api/stickers/日常/happy.webp'],
    ['%E6%97%A5%E5%B8%B8/happy.webp', '/api/stickers/日常/happy.webp'],
  ])('把模型可能写出的前缀统一重写：%s', (src, expected) => {
    expect(resolveStickerSrc(src)).toBe(expected)
  })

  it.each([
    'https://example.com/a.webp',
    '/日常/happy.webp',
    '/uploads/a.webp',
    '日常/happy.png',
    '../日常/happy.webp',
    '日常/子目录/happy.webp',
  ])('非贴纸形状原样返回：%s', src => {
    expect(resolveStickerSrc(src)).toBe(src)
  })
})
