import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore, normalizeContextUsage } from '@/stores/chat'

// Mock api module
vi.mock('@/api', () => ({
  api: {
    listProviders: vi.fn(),
  },
}))

import { api } from '@/api'

const mockApi = vi.mocked(api)

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('fetchAvailableModels (loadModels)', () => {
    it('loads models from enabled providers with api keys', async () => {
      mockApi.listProviders.mockResolvedValue([
        {
          id: 'openai',
          enabled: true,
          api_key: 'sk-test',
          models: ['gpt-4o', 'gpt-4o-mini'],
          context_window: 128000,
        },
        {
          id: 'anthropic',
          enabled: true,
          api_key: 'sk-ant',
          models: ['claude-sonnet-4-20250514'],
          context_window: 200000,
        },
      ] as any)

      const store = useChatStore()
      await store.fetchAvailableModels()

      expect(store.availableModels).toHaveLength(3)
      expect(store.availableModels[0]).toEqual({
        id: 'openai/gpt-4o',
        provider: 'openai',
        name: 'gpt-4o',
        contextWindow: 128000,
      })
      expect(store.availableModels[2]).toEqual({
        id: 'anthropic/claude-sonnet-4-20250514',
        provider: 'anthropic',
        name: 'claude-sonnet-4-20250514',
        contextWindow: 200000,
      })
    })

    it('skips disabled providers', async () => {
      mockApi.listProviders.mockResolvedValue([
        { id: 'openai', enabled: false, api_key: 'sk-test', models: ['gpt-4o'] },
        { id: 'anthropic', enabled: true, api_key: 'sk-ant', models: ['claude-sonnet-4-20250514'] },
      ] as any)

      const store = useChatStore()
      await store.fetchAvailableModels()

      expect(store.availableModels).toHaveLength(1)
      expect(store.availableModels[0].provider).toBe('anthropic')
    })

    it('skips providers without api_key', async () => {
      mockApi.listProviders.mockResolvedValue([
        { id: 'openai', enabled: true, api_key: '', models: ['gpt-4o'] },
        { id: 'local', enabled: true, api_key: '  ', models: ['llama'] },
      ] as any)

      const store = useChatStore()
      await store.fetchAvailableModels()

      expect(store.availableModels).toHaveLength(0)
    })

    it('handles api failure gracefully', async () => {
      mockApi.listProviders.mockRejectedValue(new Error('Network error'))

      const store = useChatStore()
      await store.fetchAvailableModels()

      // Should not throw, models remain empty
      expect(store.availableModels).toHaveLength(0)
    })

    it('handles providers response wrapped in object', async () => {
      mockApi.listProviders.mockResolvedValue({
        providers: [
          { id: 'openai', enabled: true, api_key: 'sk-x', models: ['gpt-4o'], context_window: 128000 },
        ],
      } as any)

      const store = useChatStore()
      await store.fetchAvailableModels()

      expect(store.availableModels).toHaveLength(1)
      expect(store.availableModels[0].id).toBe('openai/gpt-4o')
    })
  })

  describe('context usage tracking', () => {
    it('has default context usage', () => {
      const store = useChatStore()

      expect(store.contextUsage.estimatedTokens).toBe(0)
      expect(store.contextUsage.maxTokens).toBe(128000)
      expect(store.contextUsage.percentage).toBe(0)
      expect(store.contextUsage.messageCount).toBe(0)
      expect(store.contextUsage.modelName).toBe('')
    })

    it('updates context usage with snake_case payload', () => {
      const store = useChatStore()
      store.updateContextUsage({
        estimated_tokens: 5000,
        max_tokens: 128000,
        message_count: 10,
        model_name: 'gpt-4o',
      } as any)

      expect(store.contextUsage.estimatedTokens).toBe(5000)
      expect(store.contextUsage.maxTokens).toBe(128000)
      expect(store.contextUsage.messageCount).toBe(10)
      expect(store.contextUsage.modelName).toBe('gpt-4o')
    })

    it('computes percentage from tokens when not provided', () => {
      const store = useChatStore()
      store.updateContextUsage({
        estimated_tokens: 64000,
        max_tokens: 128000,
      } as any)

      expect(store.contextUsage.percentage).toBeCloseTo(50, 1)
    })

    it('clamps percentage to 0-100', () => {
      const store = useChatStore()
      store.updateContextUsage({
        estimated_tokens: 200000,
        max_tokens: 128000,
      } as any)

      expect(store.contextUsage.percentage).toBeLessThanOrEqual(100)
    })

    it('converts fractional percentage (< 1) to whole percentage', () => {
      const store = useChatStore()
      store.updateContextUsage({ percentage: 0.42 } as any)

      expect(store.contextUsage.percentage).toBeCloseTo(42, 1)
    })
  })

  describe('normalizeContextUsage (unit)', () => {
    it('normalizes snake_case payload', () => {
      const result = normalizeContextUsage({
        estimated_tokens: 1000,
        max_tokens: 64000,
        message_count: 5,
        model_name: 'claude-sonnet-4-20250514',
      })

      expect(result.estimatedTokens).toBe(1000)
      expect(result.maxTokens).toBe(64000)
      expect(result.messageCount).toBe(5)
      expect(result.modelName).toBe('claude-sonnet-4-20250514')
    })

    it('normalizes camelCase payload', () => {
      const result = normalizeContextUsage({
        estimatedTokens: 2000,
        maxTokens: 32000,
        messageCount: 8,
        modelName: 'gpt-4o-mini',
      })

      expect(result.estimatedTokens).toBe(2000)
      expect(result.maxTokens).toBe(32000)
      expect(result.messageCount).toBe(8)
      expect(result.modelName).toBe('gpt-4o-mini')
    })

    it('handles null/undefined payload gracefully', () => {
      const result = normalizeContextUsage(null)

      expect(result.estimatedTokens).toBe(0)
      expect(result.maxTokens).toBe(128000)
      expect(result.percentage).toBe(0)
    })

    it('preserves previous maxTokens when incoming is smaller (same model)', () => {
      const previous = {
        estimatedTokens: 100,
        maxTokens: 200000,
        percentage: 0,
        messageCount: 1,
        modelName: 'gpt-4o',
      }
      const result = normalizeContextUsage(
        { estimated_tokens: 200, max_tokens: 128000, model_name: 'gpt-4o' },
        previous,
      )

      // maxTokens should stay at 200000 since incoming is smaller and model unchanged
      expect(result.maxTokens).toBe(200000)
    })

    it('updates maxTokens on model change', () => {
      const previous = {
        estimatedTokens: 100,
        maxTokens: 128000,
        percentage: 0,
        messageCount: 1,
        modelName: 'gpt-4o',
      }
      const result = normalizeContextUsage(
        { estimated_tokens: 200, max_tokens: 200000, model_name: 'claude-sonnet-4-20250514' },
        previous,
      )

      expect(result.maxTokens).toBe(200000)
      expect(result.modelName).toBe('claude-sonnet-4-20250514')
    })
  })

  describe('compaction state', () => {
    it('channel starts without pendingCompaction', () => {
      const store = useChatStore()
      const channel = store.getOrCreateChannel('sess-1')

      expect(channel.pendingCompaction).toBeUndefined()
    })

    it('can set pendingCompaction on a channel', () => {
      const store = useChatStore()
      const channel = store.getOrCreateChannel('sess-1')
      channel.pendingCompaction = { reason: 'context_overflow', action: 'summarize' }

      const retrieved = store.getOrCreateChannel('sess-1')
      expect(retrieved.pendingCompaction).toEqual({ reason: 'context_overflow', action: 'summarize' })
    })

    it('pendingCompaction is isolated per session', () => {
      const store = useChatStore()
      const ch1 = store.getOrCreateChannel('sess-1')
      const ch2 = store.getOrCreateChannel('sess-2')

      ch1.pendingCompaction = { reason: 'manual', action: 'truncate' }

      expect(ch2.pendingCompaction).toBeUndefined()
    })
  })

  describe('model and parameter setters', () => {
    it('setModel updates currentModel', () => {
      const store = useChatStore()
      store.setModel('anthropic/claude-sonnet-4-20250514')

      expect(store.currentModel).toBe('anthropic/claude-sonnet-4-20250514')
    })

    it('setTemperature clamps between 0 and 2', () => {
      const store = useChatStore()

      store.setTemperature(1.5)
      expect(store.temperature).toBe(1.5)

      store.setTemperature(-1)
      expect(store.temperature).toBe(0)

      store.setTemperature(5)
      expect(store.temperature).toBe(2)
    })

    it('setMaxTokens clamps between 256 and 256000', () => {
      const store = useChatStore()

      store.setMaxTokens(8192)
      expect(store.maxTokens).toBe(8192)

      store.setMaxTokens(100)
      expect(store.maxTokens).toBe(256)

      store.setMaxTokens(999999)
      expect(store.maxTokens).toBe(256000)
    })

    it('toggleThinking sets thinkingEnabled', () => {
      const store = useChatStore()
      expect(store.thinkingEnabled).toBe(false)

      store.toggleThinking(true)
      expect(store.thinkingEnabled).toBe(true)

      store.toggleThinking(false)
      expect(store.thinkingEnabled).toBe(false)
    })
  })

  describe('channel management', () => {
    it('getOrCreateChannel creates a new channel', () => {
      const store = useChatStore()
      const channel = store.getOrCreateChannel('new-session')

      expect(channel.connected).toBe(false)
      expect(channel.isStreaming).toBe(false)
      expect(channel.turns).toEqual([])
      expect(channel.currentTurn).toBeNull()
      expect(channel.error).toBeNull()
    })

    it('getOrCreateChannel returns existing channel', () => {
      const store = useChatStore()
      const ch1 = store.getOrCreateChannel('sess-1')
      ch1.connected = true

      const ch2 = store.getOrCreateChannel('sess-1')
      expect(ch2.connected).toBe(true)
    })

    it('removeChannel deletes the channel', () => {
      const store = useChatStore()
      store.getOrCreateChannel('sess-1')
      store.removeChannel('sess-1')

      // Getting it again creates a fresh one
      const fresh = store.getOrCreateChannel('sess-1')
      expect(fresh.connected).toBe(false)
    })

    it('removeTurnsFromStorage removes localStorage entry', () => {
      const store = useChatStore()
      localStorage.setItem('maxma_turns_sess-1', JSON.stringify([{ id: '1' }]))

      store.removeTurnsFromStorage('sess-1')

      expect(localStorage.getItem('maxma_turns_sess-1')).toBeNull()
    })

    it('loadTurnsFromStorage returns parsed turns', () => {
      const store = useChatStore()
      const turns = [{ id: 't1', role: 'user' }]
      localStorage.setItem('maxma_turns_sess-1', JSON.stringify(turns))

      const loaded = store.loadTurnsFromStorage('sess-1')
      expect(loaded).toEqual(turns)
    })

    it('loadTurnsFromStorage returns null for missing key', () => {
      const store = useChatStore()
      expect(store.loadTurnsFromStorage('nonexistent')).toBeNull()
    })
  })
})
