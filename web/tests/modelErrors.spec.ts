import { describe, expect, it } from 'vitest'
import { userFacingModelError } from '@/utils/modelErrors'

describe('userFacingModelError', () => {
  it('explains OpenCode free-tier rejections in Chinese', () => {
    expect(userFacingModelError(
      '403: {"type":"FreeTierError","message":"OpenCode\'s free tier can only be used from within OpenCode"}',
      { model_name: 'mimo-v2.6-flash' },
    )).toContain('mimo-v2.6-flash')
  })

  it('explains free-quota exhaustion (429) with a recovery path (FREE-QUOTA-429-001)', () => {
    const message = userFacingModelError(
      'Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to ...',
      { model_name: 'mimo-v2.6-flash-free' },
    )
    expect(message).toContain('额度已用完')
    expect(message).toContain('可稍后重试')
    // 不再把英文原文直接抛给用户
    expect(message).not.toBe('Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to ...')
  })

  it('429 与 free 不同时出现的普通限流不做免费渠道映射', () => {
    const original = '429: rate limit exceeded for provider openai'
    expect(userFacingModelError(original, { model_name: 'gpt-x' })).toBe(original)
  })

  it('preserves unrelated model errors', () => {
    expect(userFacingModelError('模型请求超时', { model_name: 'space-bunny' })).toBe('模型请求超时')
  })
})
