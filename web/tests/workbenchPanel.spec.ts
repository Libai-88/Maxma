import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import WorkbenchPanel from '@/components/workbench/WorkbenchPanel.vue'

describe('WorkbenchPanel', () => {
  afterEach(() => {
    document.body.querySelectorAll('[data-workbench-root]').forEach(node => node.remove())
  })

  it('renders as a page-level dialog without taking a flex column in the chat layout', async () => {
    const wrapper = mount(WorkbenchPanel, {
      attachTo: document.body,
      props: { isOpen: true, activeTab: 'reasoning', cardCount: 0 },
      slots: {
        reasoning: h('div', { 'data-test': 'reasoning-slot' }, 'timeline'),
      },
    })

    await nextTick()

    const root = document.body.querySelector('[data-workbench-root]')
    expect(root).toBeTruthy()
    expect(root?.querySelector('[role="dialog"]')).toBeTruthy()
    expect(root?.querySelector('[data-test="reasoning-slot"]')?.textContent).toBe('timeline')
    expect(root?.querySelector('.workbench-scrim')).toBeTruthy()
    expect(wrapper.find('.workbench-panel').exists()).toBe(false)

    wrapper.unmount()
  })

  it('emits close for escape and scrim clicks while keeping tab events intact', async () => {
    const wrapper = mount(WorkbenchPanel, {
      attachTo: document.body,
      props: { isOpen: true, activeTab: 'canvas', cardCount: 2 },
      slots: {
        canvas: defineComponent({ render: () => h('div', 'canvas') }),
      },
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    document.querySelector<HTMLElement>('.workbench-scrim')?.click()
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(2)
    expect(document.body.querySelector('.tab-badge')?.textContent).toBe('2')
    wrapper.unmount()
  })
})
