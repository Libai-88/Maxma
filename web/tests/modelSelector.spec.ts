import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const { storeState, setModelMock, fetchAvailableModelsMock } = vi.hoisted(() => ({
  storeState: {
    availableModels: [
      { id: 'm1', name: 'Model 1', provider: 'p', contextWindow: 8000 },
      { id: 'm2', name: 'Model 2', provider: 'p', contextWindow: 128000 },
    ],
    currentModel: 'm1',
  },
  setModelMock: vi.fn(),
  fetchAvailableModelsMock: vi.fn(),
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    availableModels: storeState.availableModels,
    currentModel: storeState.currentModel,
    setModel: setModelMock,
    fetchAvailableModels: fetchAvailableModelsMock,
  }),
}))

import ModelSelector from '@/components/ModelSelector.vue'
import DsSelect from '@/components/ui/DsSelect.vue'

describe('ModelSelector', () => {
  it('mounts and renders DsSelect with options from store', () => {
    const wrapper = mount(ModelSelector)
    const dsSelect = wrapper.findComponent(DsSelect)
    expect(dsSelect.exists()).toBe(true)
    // options 平铺所有 availableModels，含 provider 与 contextWindow（供 groupKey 分组与 ctx 显示）
    expect(dsSelect.props('options')).toEqual([
      { value: 'm1', label: 'Model 1', provider: 'p', contextWindow: 8000 },
      { value: 'm2', label: 'Model 2', provider: 'p', contextWindow: 128000 },
    ])
    // 按 provider 分组
    expect(dsSelect.props('groupKey')).toBe('provider')
    // 当前选中值绑定 store.currentModel
    expect(dsSelect.props('modelValue')).toBe('m1')
    // input 显示选中 model 的 name
    expect(dsSelect.find('.ds-select__input').element.getAttribute('value')).toBe('Model 1')
    wrapper.unmount()
  })

  it('calls store.setModel when DsSelect emits update:modelValue', async () => {
    const wrapper = mount(ModelSelector)
    const dsSelect = wrapper.findComponent(DsSelect)
    await dsSelect.vm.$emit('update:modelValue', 'm2')
    expect(setModelMock).toHaveBeenCalledWith('m2')
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
