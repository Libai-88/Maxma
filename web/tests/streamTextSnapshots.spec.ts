import { describe, expect, it } from 'vitest'
import {
  appendStreamText,
  completeStreamText,
  createStreamTextSnapshot,
  snapshotStreamText,
} from '@/composables/streamTextSnapshots'

describe('stream text snapshots', () => {
  it('seals completed text at a tool boundary and increments the block version', () => {
    const initial = appendStreamText(createStreamTextSnapshot(), 'First answer.')
    const sealed = snapshotStreamText(initial)
    const afterTool = appendStreamText(sealed, 'Second answer.')

    expect(sealed).toEqual({ blocks: ['First answer.'], activeText: '', textBlockVersion: 1 })
    expect(completeStreamText(afterTool)).toEqual(['First answer.', 'Second answer.'])
  })

  it('does not create empty blocks for adjacent tool calls', () => {
    const initial = createStreamTextSnapshot()
    expect(snapshotStreamText(initial)).toBe(initial)
  })
})
