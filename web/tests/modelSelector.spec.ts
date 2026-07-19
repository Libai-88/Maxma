import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { storeState, setModelMock, fetchAvailableModelsMock, chatInputMock } = vi.hoisted(() => ({
  storeState: {
    availableModels: [
      { id: 'local/combo', name: 'combo', provider: '本地', contextWindow: 128000 },
      { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', provider: 'Deepseek', contextWindow: 64000 },
    ],
    currentModel: 'local/combo',
  },
  setModelMock: vi.fn(),
  fetchAvailableModelsMock: vi.fn(),
  chatInputMock: {
    providerId: { value: '本地' },
    modelName: { value: 'combo' },
    onModelChange: vi.fn(),
  },
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    availableModels: storeState.availableModels,
    currentModel: storeState.currentModel,
    setModel: setModelMock,
    fetchAvailableModels: fetchAvailableModelsMock,
  }),
}))

vi.mock('@/composables/useChatInput', () => ({
  useChatInputInjected: () => chatInputMock,
}))

import ModelSelector from '@/components/ModelSelector.vue'
import DsSelect from '@/components/ui/DsSelect.vue'

describe('ModelSelector', () => {
  it('renders one Composer combobox with provider and model in every option label', () => {
    const wrapper = mount(ModelSelector)
    expect(wrapper.find('.composer-model-selector').exists()).toBe(true)
    expect(wrapper.findAll('[role="combobox"]')).toHaveLength(1)
    const dsSelect = wrapper.findComponent(DsSelect)
    expect(dsSelect.exists()).toBe(true)
    expect(dsSelect.props('options')).toEqual([
      {
        value: 'local/combo',
        label: '本地 · combo',
        providerId: '本地',
        modelName: 'combo',
        contextWindow: 128000,
      },
      {
        value: 'deepseek/deepseek-chat',
        label: 'Deepseek · deepseek-chat',
        providerId: 'Deepseek',
        modelName: 'deepseek-chat',
        contextWindow: 64000,
      },
    ])
    expect(dsSelect.props('groupKey')).toBeUndefined()
    expect(dsSelect.props('modelValue')).toBe('local/combo')
    expect(dsSelect.find('.ds-select__input').element.getAttribute('value')).toBe('本地 · combo')
    wrapper.unmount()
  })

  it('maps the selected model id to provider and model for useChatInput', async () => {
    const wrapper = mount(ModelSelector)
    const dsSelect = wrapper.findComponent(DsSelect)
    await dsSelect.vm.$emit('update:modelValue', 'deepseek/deepseek-chat')
    expect(chatInputMock.onModelChange).toHaveBeenCalledWith('Deepseek', 'deepseek-chat')
    expect(setModelMock).toHaveBeenCalledWith('deepseek/deepseek-chat')
    wrapper.unmount()
  })

  it('fetches available models on mount when store has none', () => {
    fetchAvailableModelsMock.mockClear()
    const saved = { ...storeState }
    storeState.availableModels = []
    storeState.currentModel = 'gpt-4o'
    try {
      const wrapper = mount(ModelSelector)
      expect(fetchAvailableModelsMock).toHaveBeenCalled()
      wrapper.unmount()
    } finally {
      storeState.availableModels = saved.availableModels
      storeState.currentModel = saved.currentModel
    }
  })
})
