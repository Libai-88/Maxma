export const MAX_ALIVE_SESSIONS = 5

export interface SessionViewport {
  scrollTop: number
}

/**
 * Tracks the small set of chat sessions that may retain an in-memory view.
 * It deliberately stores no message content; the chat store remains the source
 * of truth for persisted, redacted UI data.
 */
export class SessionAliveCache {
  private readonly entries = new Map<string, SessionViewport>()

  constructor(private readonly maxSize = MAX_ALIVE_SESSIONS) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new RangeError('maxSize must be a positive integer')
    }
  }

  touch(
    sessionId: string,
    viewport: SessionViewport = { scrollTop: 0 },
    canEvict: (candidateId: string) => boolean = () => true,
  ): string | null {
    const existing = this.entries.get(sessionId)
    this.entries.delete(sessionId)
    this.entries.set(sessionId, existing ?? viewport)

    if (this.entries.size <= this.maxSize) return null
    for (const candidateId of this.entries.keys()) {
      if (candidateId !== sessionId && canEvict(candidateId)) {
        this.entries.delete(candidateId)
        return candidateId
      }
    }
    return null
  }

  rememberScroll(sessionId: string, scrollTop: number): void {
    const viewport = this.entries.get(sessionId)
    if (!viewport) return
    viewport.scrollTop = Math.max(0, scrollTop)
  }

  restoreScroll(sessionId: string): number | null {
    return this.entries.get(sessionId)?.scrollTop ?? null
  }

  remove(sessionId: string): void {
    this.entries.delete(sessionId)
  }

  clear(): void {
    this.entries.clear()
  }

  has(sessionId: string): boolean {
    return this.entries.has(sessionId)
  }

  ids(): string[] {
    return Array.from(this.entries.keys())
  }
}

export const chatSessionAliveCache = new SessionAliveCache()
