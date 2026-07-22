import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  createPinia: vi.fn(() => ({})),
  waitForBackend: vi.fn(),
}))

vi.mock('vue', () => ({ createApp: mocks.createApp }))
vi.mock('pinia', () => ({ createPinia: mocks.createPinia }))
vi.mock('@/App.vue', () => ({ default: {} }))
vi.mock('@/router', () => ({ default: {} }))
vi.mock('@/utils/env', () => ({ waitForBackend: mocks.waitForBackend }))

describe('main startup failure', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = '<div id="app-loading"></div><div id="app"></div>'
    mocks.waitForBackend.mockReset()
    mocks.createApp.mockReset()
    mocks.createApp.mockReturnValue({
      config: {},
      mount: vi.fn(),
      use: vi.fn(function (this: unknown) { return this }),
    })
  })

  it('waits for the backend before mounting', async () => {
    let release: (ready: boolean) => void = () => undefined
    mocks.waitForBackend.mockReturnValue(new Promise<boolean>(resolve => { release = resolve }))

    const importing = import('@/main')
    await vi.waitFor(() => expect(mocks.waitForBackend).toHaveBeenCalled())
    const app = mocks.createApp.mock.results[0]?.value

    expect(app.mount).not.toHaveBeenCalled()
    expect(document.getElementById('app-loading')).not.toBeNull()

    release(true)
    await importing
    await vi.waitFor(() => expect(app.mount).toHaveBeenCalledWith('#app'))
    expect(document.getElementById('app-loading')).toBeNull()
  })

  it('removes the loading overlay and leaves a readable backend error', async () => {
    mocks.waitForBackend.mockResolvedValue(false)

    await import('@/main')
    await vi.waitFor(() => expect(document.getElementById('app-loading')).toBeNull())

    expect(document.getElementById('app')?.textContent).toMatch(/backend|后端/i)
    expect(mocks.createApp.mock.results[0]?.value.mount).not.toHaveBeenCalled()
  })
})
