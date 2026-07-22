import { describe, expect, it } from 'vitest'
import { selectWebSocketProtocol } from '@/utils/wsProtocol'

describe('Vite websocket proxy', () => {
  it('echoes the first requested websocket subprotocol', () => {
    expect(selectWebSocketProtocol(new Set(['auth-token']))).toBe('auth-token')
  })
})
