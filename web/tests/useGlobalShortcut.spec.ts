import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'

function mountShortcut(callback: () => void, allowInEditable = false) {
  return mount(defineComponent({
    setup() {
      useGlobalShortcut({ key: 'n', mod: true, allowInEditable }, callback)
      return () => null
    },
  }))
}

describe('useGlobalShortcut', () => {
  it('runs a matching shortcut and prevents the browser default', () => {
    const callback = vi.fn()
    const wrapper = mountShortcut(callback)
    const event = new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true })

    document.dispatchEvent(event)

    expect(callback).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('ignores IME composition and editable controls by default', () => {
    const callback = vi.fn()
    const wrapper = mountShortcut(callback)
    const input = document.createElement('input')
    document.body.appendChild(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', ctrlKey: true, cancelable: true }))

    expect(callback).not.toHaveBeenCalled()
    input.remove()
    wrapper.unmount()
  })

  it('can opt into a global command while an editor is focused', () => {
    const callback = vi.fn()
    const wrapper = mountShortcut(callback, true)
    const input = document.createElement('input')
    document.body.appendChild(input)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))

    expect(callback).toHaveBeenCalledOnce()
    input.remove()
    wrapper.unmount()
  })

  it('removes the document listener when its owner unmounts', () => {
    const callback = vi.fn()
    const wrapper = mountShortcut(callback)
    wrapper.unmount()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, cancelable: true }))
    expect(callback).not.toHaveBeenCalled()
  })
})
