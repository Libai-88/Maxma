import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ContextUsageBadge from '@/components/ContextUsageBadge.vue'
import { handleEventForChannel } from '@/composables/useChat'
import { useChatStore } from '@/stores/chat'

describe('context usage events', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('normalizes 0-1 and 0-100 percentages and updates the badge', async () => {
    useChatStore().getOrCreateChannel('context-session')
    handleEventForChannel('context-session', {
      type: 'context_usage',
      payload: {
        estimated_tokens: 16000,
        max_tokens: 128000,
        percentage: 0.125,
        message_count: 3,
        model_name: 'combo',
      },
    })

    const store = useChatStore()
    expect(store.contextUsage).toMatchObject({
      estimatedTokens: 16000,
      maxTokens: 128000,
      percentage: 12.5,
      messageCount: 3,
      modelName: 'combo',
    })

    const wrapper = mount(ContextUsageBadge)
    expect(wrapper.find('.usage-pct').text()).toBe('12.5%')

    handleEventForChannel('context-session', {
      type: 'context_usage',
      payload: { percentage: 1 },
    })
    expect(useChatStore().contextUsage.percentage).toBe(1)

    handleEventForChannel('context-session', {
      type: 'context_usage',
      payload: {
        estimated_tokens: 32000,
        max_tokens: 128000,
        percentage: 25,
        message_count: 5,
        model_name: 'combo',
      },
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.usage-pct').text()).toBe('25.0%')
    wrapper.unmount()
  })

  it('keeps done usage visible and updates it after compression without dropping fields', () => {
    useChatStore().getOrCreateChannel('context-session')
    handleEventForChannel('context-session', {
      type: 'done',
      payload: {
        context_usage: {
          estimated_tokens: 6400,
          max_tokens: 128000,
          percentage: 5,
          message_count: 4,
          model_name: 'combo',
        },
      },
    })

    const store = useChatStore()
    expect(store.contextUsage).toMatchObject({
      estimatedTokens: 6400,
      maxTokens: 128000,
      percentage: 5,
      messageCount: 4,
      modelName: 'combo',
    })

    handleEventForChannel('context-session', {
      type: 'context_compressed',
      payload: {
        compressed: true,
        current_tokens: 3200,
        usage_percent: 0.025,
      },
    })
    expect(store.contextUsage).toMatchObject({
      estimatedTokens: 3200,
      maxTokens: 128000,
      percentage: 2.5,
      messageCount: 4,
      modelName: 'combo',
    })

    handleEventForChannel('context-session', {
      type: 'context_compressed',
      payload: { compressed: true, removed_count: 1, current_tokens: 1600, usage_percent: 1.25 },
    })
    expect(store.contextUsage).toMatchObject({
      estimatedTokens: 1600,
      percentage: 1.25,
      messageCount: 4,
      modelName: 'combo',
    })

    handleEventForChannel('context-session', {
      type: 'done',
      payload: {
        current_tokens: 800,
        usage_percent: 0.5,
        message_count: 6,
        model_name: 'combo',
      } as never,
    })
    expect(store.contextUsage).toMatchObject({
      estimatedTokens: 800,
      percentage: 50,
      messageCount: 6,
    })
  })
})
