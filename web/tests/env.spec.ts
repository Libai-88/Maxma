import { describe, expect, it, vi } from 'vitest'
import { getApiBase, getWsBase } from '@/utils/env'

describe('getWsBase', () => {
  it('uses same-origin API and WebSocket endpoints in a browser', () => {
    expect(`${getApiBase()}/health`).toBe('/api/health')
    expect(`${getWsBase()}/ws/chat/session-id`).toBe(`ws://${window.location.host}/ws/chat/session-id`)
  })

  it('uses wss for a browser page served over HTTPS', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', host: 'secure.example.test' } })

    expect(getWsBase()).toBe('wss://secure.example.test')
  })
})
