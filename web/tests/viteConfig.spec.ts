// @vitest-environment node

import { describe, expect, it } from 'vitest'
import viteConfig from '../vite.config'

describe('Vite runtime configuration', () => {
  it('uses a relative production base and keeps the browser API and websocket proxies', () => {
    const resolved = typeof viteConfig === 'function'
      ? viteConfig({ command: 'build', mode: 'production' })
      : viteConfig
    const proxy = resolved.server?.proxy

    expect(resolved.base).toBe('./')
    expect(proxy?.['/api']).toBeDefined()
    expect(proxy?.['/ws']).toMatchObject({ ws: true })
  })
})
