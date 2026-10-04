import { describe, expect, it } from 'vitest'
import { userFacingModelError } from '@/utils/modelErrors'

describe('userFacingModelError', () => {
  it('explains OpenCode free-tier rejections in Chinese', () => {
    expect(userFacingModelError(
      '403: {"type":"FreeTierError","message":"OpenCode\'s free tier can only be used from within OpenCode"}',
      { model_name: 'mimo-v2.6-flash' },
    )).toContain('mimo-v2.6-flash')
  })

  it('preserves unrelated model errors', () => {
    expect(userFacingModelError('模型请求超时', { model_name: 'space-bunny' })).toBe('模型请求超时')
  })
})
