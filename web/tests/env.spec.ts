import { describe, expect, it } from 'vitest'
import { getWsBase } from '@/utils/env'

describe('getWsBase', () => {
  it('uses the Vite websocket proxy in a browser', () => {
    expect(getWsBase()).toBe('')
  })
})
