export interface StreamTextSnapshot {
  readonly blocks: readonly string[]
  readonly activeText: string
  readonly textBlockVersion: number
}

export function createStreamTextSnapshot(): StreamTextSnapshot {
  return {
    blocks: [],
    activeText: '',
    textBlockVersion: 0,
  }
}

export function appendStreamText(snapshot: StreamTextSnapshot, text: string): StreamTextSnapshot {
  return {
    ...snapshot,
    activeText: snapshot.activeText + text,
  }
}

export function snapshotStreamText(snapshot: StreamTextSnapshot): StreamTextSnapshot {
  if (snapshot.activeText === '') {
    return snapshot
  }

  return {
    blocks: [...snapshot.blocks, snapshot.activeText],
    activeText: '',
    textBlockVersion: snapshot.textBlockVersion + 1,
  }
}

export function completeStreamText(snapshot: StreamTextSnapshot): string[] {
  return snapshot.activeText === ''
    ? [...snapshot.blocks]
    : [...snapshot.blocks, snapshot.activeText]
}
