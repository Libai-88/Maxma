export interface StreamTextSnapshot {
  blocks: readonly string[]
  activeText: string
  textBlockVersion: number
}

/**
 * Captures immutable text blocks at tool boundaries while allowing the current
 * model response to grow independently. Renderers can key on textBlockVersion
 * instead of re-parsing all prior markdown for every streamed token.
 */
export function createStreamTextSnapshot(): StreamTextSnapshot {
  return { blocks: [], activeText: '', textBlockVersion: 0 }
}

export function appendStreamText(
  snapshot: StreamTextSnapshot,
  text: string,
): StreamTextSnapshot {
  if (!text) return snapshot
  return { ...snapshot, activeText: snapshot.activeText + text }
}

export function snapshotStreamText(snapshot: StreamTextSnapshot): StreamTextSnapshot {
  if (!snapshot.activeText) return snapshot
  return {
    blocks: [...snapshot.blocks, snapshot.activeText],
    activeText: '',
    textBlockVersion: snapshot.textBlockVersion + 1,
  }
}

export function completeStreamText(snapshot: StreamTextSnapshot): readonly string[] {
  return snapshot.activeText ? [...snapshot.blocks, snapshot.activeText] : snapshot.blocks
}
