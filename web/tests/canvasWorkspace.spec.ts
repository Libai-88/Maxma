import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import CanvasTabs from '@/components/workbench/CanvasTabs.vue'
import HtmlSandbox from '@/components/HtmlSandbox.vue'
import { useWorkbenchStore } from '@/stores/workbench'

const STORAGE_KEY = 'maxmahere.canvas-workspace.v1'

describe('Canvas workspace', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('keeps source references while switching and closing tabs', () => {
    const workbench = useWorkbenchStore()
    const first = workbench.addCard({
      type: 'code', title: 'First', content: 'const one = 1', sourceTurnId: 'turn-first',
    })
    const second = workbench.addCard({
      type: 'table', title: 'Second', content: '[]', sourceTurnId: 'turn-second',
    })

    workbench.selectCard(first)
    expect(workbench.activeCard?.sourceTurnId).toBe('turn-first')
    workbench.removeCard(first)

    expect(workbench.activeCardId).toBe(second)
    expect(workbench.activeCard?.sourceTurnId).toBe('turn-second')
    expect(workbench.workspaceTabs).toHaveLength(1)
  })

  it('restores only pinned, non-interactive documents from local storage', () => {
    const initial = useWorkbenchStore()
    const pinned = initial.addCard({
      type: 'markdown', title: 'Notes', content: '# kept', sourceTurnId: 'turn-notes',
    })
    const unpinned = initial.addCard({
      type: 'json', title: 'Temporary', content: '{"remove":true}', sourceTurnId: 'turn-temp',
    })
    initial.toggleCardPin(unpinned)

    setActivePinia(createPinia())
    const restored = useWorkbenchStore()
    expect(restored.cards).toHaveLength(1)
    expect(restored.cards[0]).toMatchObject({ id: pinned, sourceTurnId: 'turn-notes', pinned: true })
    expect(restored.activeCardId).toBe(pinned)
  })

  it('drops malformed persisted values rather than rendering unknown content', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      cards: [{ id: 'bad', type: 'script', title: 'Bad', content: 'x', createdAt: 1 }],
      activeCardId: 'bad',
    }))
    setActivePinia(createPinia())

    expect(useWorkbenchStore().cards).toEqual([])
  })
})

describe('CanvasTabs', () => {
  const tabs = [
    { id: 'canvas-tab-a', cardId: 'a', title: 'Code', type: 'code' as const, pinned: true, sourceTurnId: 'turn-a' },
    { id: 'canvas-tab-b', cardId: 'b', title: 'Preview', type: 'html' as const, pinned: false },
  ]

  it('selects, pins, and closes only the requested tab', async () => {
    const wrapper = mount(CanvasTabs, { props: { tabs, activeCardId: 'a' } })
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await wrapper.get('[aria-label="固定 Preview"]').trigger('click')
    await wrapper.get('[aria-label="关闭 Code"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['b']])
    expect(wrapper.emitted('toggle-pin')).toEqual([['b']])
    expect(wrapper.emitted('close')).toEqual([['a']])
  })
})

describe('HtmlSandbox', () => {
  it('keeps previews in an opaque-origin iframe without parent access', () => {
    const wrapper = mount(HtmlSandbox, { props: { html: '<script>parent.document.body.textContent = "bad"</script>' } })
    expect(wrapper.get('iframe').attributes('sandbox')).toBe('allow-scripts allow-modals')
    expect(wrapper.get('iframe').attributes('sandbox')).not.toContain('allow-same-origin')
  })
})
