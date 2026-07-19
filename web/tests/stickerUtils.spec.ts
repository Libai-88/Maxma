import { describe, expect, it } from 'vitest'
import { detectEmotion, stripStickerDirectives } from '@/composables/stickerUtils'

describe('agent sticker directives', () => {
  it('recognizes the 表情包 directive format', () => {
    expect(detectEmotion('今天真好 [表情包:开心]')).toBe('开心')
  })

  it('removes resolved directives from rendered message text', () => {
    expect(stripStickerDirectives('你好\n[表情包:开心]\n想你了')).toBe('你好\n想你了')
  })

  it('keeps composer sticker tags separate from agent directives', () => {
    const composerTag = '<sticker:/stickers/happy.webp>'
    expect(stripStickerDirectives(`你好 ${composerTag}`)).toContain(composerTag)
  })
})
