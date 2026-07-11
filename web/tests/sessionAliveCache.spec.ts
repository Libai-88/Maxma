import { describe, expect, it } from 'vitest'
import { MAX_ALIVE_SESSIONS, SessionAliveCache } from '@/composables/sessionAliveCache'

describe('SessionAliveCache', () => {
  it('keeps the five most recently touched sessions', () => {
    const cache = new SessionAliveCache()
    for (let index = 0; index < MAX_ALIVE_SESSIONS; index++) {
      expect(cache.touch(`session-${index}`)).toBeNull()
    }

    expect(cache.touch('session-5')).toBe('session-0')
    expect(cache.ids()).toEqual(['session-1', 'session-2', 'session-3', 'session-4', 'session-5'])
  })

  it('uses LRU order when an existing session is revisited', () => {
    const cache = new SessionAliveCache(2)
    cache.touch('first')
    cache.touch('second')
    cache.touch('first')

    expect(cache.touch('third')).toBe('second')
    expect(cache.ids()).toEqual(['first', 'third'])
  })

  it('preserves scroll position without retaining message content', () => {
    const cache = new SessionAliveCache()
    cache.touch('session-a')
    cache.rememberScroll('session-a', 240)

    expect(cache.restoreScroll('session-a')).toBe(240)
    expect(cache.restoreScroll('unknown')).toBeNull()
  })

  it('does not evict protected sessions', () => {
    const cache = new SessionAliveCache(2)
    cache.touch('streaming')
    cache.touch('idle')

    expect(cache.touch('new', { scrollTop: 0 }, id => id !== 'streaming')).toBe('idle')
    expect(cache.ids()).toEqual(['streaming', 'new'])
  })
})
