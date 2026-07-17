import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/stores/chat', () => ({
  useChatStore: () => ({
    availableModels: [{ id: 'm1', name: 'Model 1', provider: 'p', contextWindow: 8000 }],
    currentModel: 'm1',
    setModel: vi.fn(),
    fetchAvailableModels: vi.fn(),
  }),
}))

import ModelSelector from '@/components/ModelSelector.vue'

describe('ModelSelector', () => {
  it('removes the global click listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mount(ModelSelector)

    const clickRegistrations = addSpy.mock.calls.filter(([type]) => type === 'click')
    expect(clickRegistrations.length).toBeGreaterThan(0)

    wrapper.unmount()

    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
