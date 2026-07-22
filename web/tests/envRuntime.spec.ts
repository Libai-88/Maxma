import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mocks.fetch }))

describe('Tauri runtime port discovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
    mocks.invoke.mockReset()
    mocks.fetch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('uses the discovered Tauri port for absolute API requests', async () => {
    mocks.invoke.mockResolvedValue(8123)
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'runtime-token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [] }) } as Response)

    const { api } = await import('@/api')
    await api.listProviders()

    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8123/api/auth/token')
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8123/api/providers')
  })

  it('uses a relative API base in the browser', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

    const { getApiBase } = await import('@/utils/env')

    expect(getApiBase()).toBe('/api')
  })

  it('uses the browser host and /ws path for WebSockets', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__

    const { getWsBase } = await import('@/utils/env')

    expect(`${getWsBase()}/ws/chat/session-id`).toBe(`ws://${window.location.host}/ws/chat/session-id`)
  })

  it('uses the discovered Tauri port for WebSockets', async () => {
    mocks.invoke.mockResolvedValue(8123)

    const { ensurePortLoaded, getWsBase } = await import('@/utils/env')
    await ensurePortLoaded()

    expect(getWsBase()).toBe('ws://127.0.0.1:8123')
  })

  it('retains the discovered port while the sidecar is still starting', async () => {
    mocks.invoke.mockResolvedValue(8123)
    mocks.fetch
      .mockRejectedValueOnce(new Error('sidecar is still starting'))
      .mockResolvedValueOnce({ ok: true } as Response)

    const { waitForBackend } = await import('@/utils/env')
    const waiting = waitForBackend(2, 1000)
    await vi.runAllTimersAsync()

    await expect(waiting).resolves.toBe(true)
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8123/api/health')
  })
})
