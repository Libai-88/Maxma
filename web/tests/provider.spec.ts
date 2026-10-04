import { describe, expect, it } from 'vitest'
import { isLocalProvider } from '@/utils/provider'

describe('isLocalProvider', () => {
  it('recognizes supported local runtimes without credentials', () => {
    expect(isLocalProvider('ollama', 'http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalProvider('lm-studio', 'http://localhost:1234/v1')).toBe(true)
  })

  it('does not treat remote endpoints as local', () => {
    expect(isLocalProvider('openai', 'https://api.openai.com/v1')).toBe(false)
    expect(isLocalProvider('custom', 'https://example.com/v1')).toBe(false)
  })
})
