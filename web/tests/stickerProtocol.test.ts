/**
 * tests/stickerProtocol.test.ts — `[表情: 描述]` / 旧 `[表情包:分类]` 解析契约。
 */
import { describe, expect, test } from 'bun:test'
import {
  hasStickerDirective,
  resolveStickerDirectiveSync,
  resolveStickerMeme,
  stripStickerDirectives,
} from '../src/utils/stickerUtils'
import type { StickerMeme } from '../src/types/sticker'

const memes: StickerMeme[] = [
  { packId: 'maxma_builtin', packName: '内置', path: '开心/a.webp', url: '/a', tag: 'happy', caption: '猫猫开心', keywords: '猫 开心', file_name: 'a.webp' },
  { packId: 'maxma_builtin', packName: '内置', path: '委屈/b.webp', url: '/b', tag: 'sad', caption: '委屈巴巴', keywords: '委屈 难过', file_name: 'b.webp' },
  { packId: 'dsh-meme-user', packName: '我的收藏', path: 'memes/daily/c.png', url: '/c', tag: 'daily', caption: '无语猫', keywords: '无语', file_name: 'c.png' },
]

describe('sticker protocol', () => {
  test('caption 精确优先于 tag', () => {
    expect(resolveStickerMeme('猫猫开心', memes)?.path).toBe('开心/a.webp')
    expect(resolveStickerMeme('开心', memes)?.tag).toBe('happy')
  })

  test('旧 [表情包:开心] 走 tag；未命中保留原文', () => {
    expect(resolveStickerDirectiveSync('好耶[表情包:开心]', memes)).toContain('<sticker:maxma_builtin/开心/a.webp>')
    expect(resolveStickerDirectiveSync('[表情: 不存在的描述]', memes)).toBe('[表情: 不存在的描述]')
  })

  test('新 [表情: 描述] 半角/全角冒号都识别；不随机塞图', () => {
    expect(resolveStickerDirectiveSync('[表情: 无语猫]', memes)).toContain('<sticker:dsh-meme-user/memes/daily/c.png>')
    expect(resolveStickerDirectiveSync('[表情：委屈巴巴]', memes)).toContain('<sticker:maxma_builtin/委屈/b.webp>')
    expect(resolveStickerDirectiveSync('[表情: 完全没命中]', memes)).toBe('[表情: 完全没命中]')
  })

  test('检测与移除指令', () => {
    expect(hasStickerDirective('hi [表情: 猫]')).toBe(true)
    expect(hasStickerDirective('hi [表情包: 开心]')).toBe(true)
    expect(hasStickerDirective('hi')).toBe(false)
    expect(stripStickerDirectives('前[表情: 猫]后')).toBe('前后')
  })
})
