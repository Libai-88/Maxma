import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getToken: vi.fn(() => 'stale-token'),
  getApiBase: vi.fn(() => '/api'),
  tauriFetch: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: { request: mocks.request },
  getToken: mocks.getToken,
  request: mocks.request,
}))

vi.mock('@/utils/env', () => ({
  getApiBase: mocks.getApiBase,
  tauriFetch: mocks.tauriFetch,
}))

import { api } from '@/api'
import { useMemoryStore } from '@/stores/memory'
import { usePersonaStore } from '@/stores/persona'
import { useToolsStore } from '@/stores/tools'

describe('runtime-safe direct API consumers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.request.mockReset()
    mocks.getToken.mockClear()
    mocks.getApiBase.mockClear()
    mocks.tauriFetch.mockReset()
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/persona/profile') return { name: 'Runtime Maxma' }
      if (path === '/memory') return [{ id: 'fact-1' }]
      if (path === '/tools') return [{ name: 'tool-1', category: 'test' }]
      return {}
    })
  })

  it('exposes the authenticated runtime request wrapper on api', () => {
    expect(api.request).toBe(mocks.request)
  })

  it('routes persona, memory, and tools stores through api.request', async () => {
    await usePersonaStore().fetchProfile()
    await useMemoryStore().fetchFacts()
    await useToolsStore().fetchTools()

    expect(mocks.request).toHaveBeenCalledWith('/persona/profile')
    expect(mocks.request).toHaveBeenCalledWith('/memory')
    expect(mocks.request).toHaveBeenCalledWith('/tools')
    expect(mocks.tauriFetch).not.toHaveBeenCalled()
    expect(mocks.getApiBase).not.toHaveBeenCalled()
    expect(mocks.getToken).not.toHaveBeenCalled()
  })

  it('keeps SkillsView free of direct unauthenticated transport calls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/SkillsView.vue'), 'utf8')

    expect(source).toContain("import { api } from '@/api'")
    expect(source).toContain('api.request(')
    expect(source).not.toContain('getToken')
    expect(source).not.toContain('getApiBase')
    expect(source).not.toContain('tauriFetch')
  })
})
