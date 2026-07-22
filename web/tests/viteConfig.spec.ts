// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import viteConfig from '../vite.config'

function resolveDevConfig() {
  return typeof viteConfig === 'function'
    ? viteConfig({ command: 'serve', mode: 'development' })
    : viteConfig
}

afterEach(() => {
  vi.unstubAllEnvs()
})

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

  it('binds the dev server to loopback and uses IPv4 loopback proxy targets', () => {
    const resolved = resolveDevConfig()
    const proxy = resolved.server?.proxy

    expect(resolved.server?.host).toBe('127.0.0.1')
    expect(proxy?.['/api']).toBe('http://127.0.0.1:8000')
    expect(proxy?.['/ws']).toMatchObject({ target: 'ws://127.0.0.1:8000' })
  })

  it('uses MAXMA_WEB_PORT for the Vite server when set', () => {
    vi.stubEnv('MAXMA_WEB_PORT', '6123')
    vi.stubEnv('VITE_MAXMA_WEB_PORT', '6234')

    expect(resolveDevConfig().server?.port).toBe(6123)
  })

  it('uses VITE_MAXMA_WEB_PORT when MAXMA_WEB_PORT is unset', () => {
    vi.stubEnv('MAXMA_WEB_PORT', '')
    vi.stubEnv('VITE_MAXMA_WEB_PORT', '6234')

    expect(resolveDevConfig().server?.port).toBe(6234)
  })

  it('defaults the bare Vite dev server to port 5173', () => {
    vi.stubEnv('MAXMA_WEB_PORT', '')
    vi.stubEnv('VITE_MAXMA_WEB_PORT', '')

    expect(resolveDevConfig().server?.port).toBe(5173)
  })

  it('allows Tauri loopback images in both production HTML entrypoints', () => {
    for (const entry of ['index.html', 'quick-chat.html']) {
      const html = readFileSync(resolve(process.cwd(), entry), 'utf8')
      expect(html).toContain("img-src 'self' http://localhost:* http://127.0.0.1:* data: blob:")
    }
  })
})
