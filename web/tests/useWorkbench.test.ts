/** useWorkbench composable 单元测试 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbench } from '../src/composables/useWorkbench'
import type { CanvasCard } from '../src/types/workbench'

describe('useWorkbench', () => {
  let wb: ReturnType<typeof useWorkbench>

  beforeEach(() => {
    wb = useWorkbench()
    wb.clearCards()
    wb.close()
  })

  describe('panel state', () => {
    it('starts closed', () => {
      expect(wb.isOpen.value).toBe(false)
    })

    it('opens panel', () => {
      wb.open()
      expect(wb.isOpen.value).toBe(true)
    })

    it('closes panel', () => {
      wb.open()
      wb.close()
      expect(wb.isOpen.value).toBe(false)
    })

    it('toggles panel', () => {
      wb.toggle()
      expect(wb.isOpen.value).toBe(true)
      wb.toggle()
      expect(wb.isOpen.value).toBe(false)
    })

    it('defaults to reasoning tab', () => {
      expect(wb.activeTab.value).toBe('reasoning')
    })

    it('switches tab', () => {
      wb.setTab('canvas')
      expect(wb.activeTab.value).toBe('canvas')
      wb.setTab('reasoning')
      expect(wb.activeTab.value).toBe('reasoning')
    })
  })

  describe('canvas cards', () => {
    it('starts with empty cards', () => {
      expect(wb.cards.value).toEqual([])
    })

    it('adds a card', () => {
      wb.addCard({
        type: 'code',
        title: 'Test Code',
        content: 'print("hello")',
      })
      expect(wb.cards.value).toHaveLength(1)
      expect(wb.cards.value[0].title).toBe('Test Code')
      expect(wb.cards.value[0].id).toBeTruthy()
      expect(wb.cards.value[0].createdAt).toBeGreaterThan(0)
    })

    it('removes a card by id', () => {
      wb.addCard({ type: 'summary', title: 'Card 1', content: 'content' })
      wb.addCard({ type: 'summary', title: 'Card 2', content: 'content' })
      const firstId = wb.cards.value[0].id
      wb.removeCard(firstId)
      expect(wb.cards.value).toHaveLength(1)
      expect(wb.cards.value[0].title).toBe('Card 2')
    })

    it('clears all cards', () => {
      wb.addCard({ type: 'code', title: 'A', content: '' })
      wb.addCard({ type: 'code', title: 'B', content: '' })
      wb.clearCards()
      expect(wb.cards.value).toEqual([])
    })

    it('does not crash when removing non-existent id', () => {
      wb.removeCard('nonexistent')
      expect(wb.cards.value).toEqual([])
    })

    it('auto-opens panel when adding card', () => {
      expect(wb.isOpen.value).toBe(false)
      wb.addCard({ type: 'code', title: 'Test', content: '' })
      expect(wb.isOpen.value).toBe(true)
      expect(wb.activeTab.value).toBe('canvas')
    })
  })

  describe('reasoning timeline', () => {
    it('builds empty timeline from empty turns', () => {
      const entries = wb.buildReasoningTimeline([])
      expect(entries).toEqual([])
    })

    it('builds timeline from a turn with thinking + tool', () => {
      const turn = {
        id: 'turn-1',
        userMessage: 'test',
        refs: [],
        events: [
          { kind: 'thinking', tokens: 'thinking...', done: true, becameAnswer: false },
          { kind: 'tool', name: 'run_python', input: 'print(1)', output: '1', elapsed: 100, status: 'done' as const },
        ],
        finalAnswer: 'The answer is 1',
      }
      const entries = wb.buildReasoningTimeline([turn])
      expect(entries).toHaveLength(3) // thinking + tool + answer
      expect(entries[0].kind).toBe('thinking')
      expect(entries[1].kind).toBe('tool')
      expect(entries[1].toolName).toBe('run_python')
      expect(entries[1].status).toBe('done')
      expect(entries[1].elapsed).toBe(100)
      expect(entries[2].kind).toBe('answer')
    })

    it('skips consumed thinking blocks', () => {
      const turn = {
        id: 'turn-1',
        userMessage: 'test',
        refs: [],
        events: [
          { kind: 'thinking', tokens: 'consumed', done: true, becameAnswer: false, consumed: true },
          { kind: 'thinking', tokens: 'visible', done: true, becameAnswer: false },
        ],
        finalAnswer: null,
      }
      const entries = wb.buildReasoningTimeline([turn])
      expect(entries).toHaveLength(1)
      expect(entries[0].label).toBe('visible')
    })

    it('limits to last 3 turns', () => {
      const turns = Array.from({ length: 5 }, (_, i) => ({
        id: `turn-${i}`,
        userMessage: `msg ${i}`,
        refs: [],
        events: [],
        finalAnswer: `answer ${i}`,
      }))
      const entries = wb.buildReasoningTimeline(turns)
      // Only last 3 turns should be included
      const answerEntries = entries.filter(e => e.kind === 'answer')
      expect(answerEntries).toHaveLength(3)
      expect(answerEntries[0].label).toBe('answer 2')
    })
  })
})
