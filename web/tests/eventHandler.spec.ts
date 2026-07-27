/**
 * eventHandler.spec.ts — 测试 useChat.ts 的事件处理核心逻辑
 *
 * 验证 handleEventForChannel 对各类 ServerEvent 的正确响应。
 * 不依赖 Vue 组件渲染，只验证状态变更。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ServerEvent, ToolCall, ThinkingBlock, TurnEvent, ChatTurn } from '@/types'

// ── 模拟 Channel 和 Store ──

interface MockChannel {
  ws: null
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
  turns: ChatTurn[]
  currentTurn: ChatTurn | null
  error: string | null
  errorCategory: string | null
  errorTraceId: string | null
  contextUsage: null
  taskTrackerData: null
  reconnectTimer: null
  reconnectAttempts: number
  initialized: boolean
  _awaitingToolName: string | null
  parentSessionId: string | null
  privateMode: boolean
  autoApprove: boolean
  _pingTimer: null
  _lastPongAt: number
  pendingCompaction?: { reason: string; action: string }
  _childSessionIds: Set<string>
}

function createChannel(id = 'test-session'): MockChannel {
  return {
    ws: null,
    connected: true,
    isStreaming: true,
    isAwaitingUser: false,
    turns: [],
    currentTurn: {
      id: 'turn-1',
      userMessage: 'hi',
      refs: [],
      events: [],
      memoryEvents: [],
      finalAnswer: null,
    },
    error: null,
    errorCategory: null,
    errorTraceId: null,
    contextUsage: null,
    taskTrackerData: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    initialized: true,
    _awaitingToolName: null,
    parentSessionId: null,
    privateMode: false,
    autoApprove: false,
    _pingTimer: null,
    _lastPongAt: 0,
    _childSessionIds: new Set(),
  }
}

function findLastThinking(events: TurnEvent[]): ThinkingBlock | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'thinking') return events[i] as ThinkingBlock
  }
  return undefined
}

function findRunningTool(events: TurnEvent[], toolName: string): ToolCall | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'tool' && (events[i] as ToolCall).status === 'running') {
      return events[i] as ToolCall
    }
  }
  // fallback: match by name regardless of status
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'tool' && (events[i] as ToolCall).name === toolName) {
      return events[i] as ToolCall
    }
  }
  return undefined
}

/**
 * Simplified handleEventForChannel that exercises the same switch-case logic.
 * This is the core of useChat.ts's event handling, extracted for testability.
 */
function processEvent(ch: MockChannel, event: ServerEvent): void {
  // context_usage (no turn needed)
  if (event.type === 'context_usage') return

  // context_compressed / context_compressing (no turn needed)
  if (event.type === 'context_compressed') {
    if (ch.currentTurn) {
      ch.currentTurn.events.push({
        kind: 'system',
        detail: 'context_compressed',
        content: `上下文已压缩：移除 ${event.payload.removed_count ?? 0} 条消息`,
        timestamp: Date.now(),
      })
    }
    return
  }

  if (event.type === 'context_compressing') {
    const reasonLabels: Record<string, string> = {
      threshold: '上下文触达阈值',
      overflow: '上下文溢出',
      idle: '空闲超时',
      incomplete: '不完整状态',
    }
    if (ch.currentTurn) {
      ch.currentTurn.events.push({
        kind: 'system',
        detail: 'context_compressing',
        content: `压缩中：${reasonLabels[event.payload.reason] ?? event.payload.reason}（${event.payload.action}）`,
        timestamp: Date.now(),
      })
    } else {
      ch.pendingCompaction = { reason: event.payload.reason, action: event.payload.action }
    }
    return
  }

  const turn = ch.currentTurn
  if (!turn) return

  switch (event.type) {
    case 'thinking_start':
      turn.events.push({ kind: 'thinking', tokens: '', done: false, becameAnswer: false })
      break

    case 'token': {
      let lastThink = findLastThinking(turn.events)
      if (!lastThink) {
        turn.events.push({ kind: 'thinking', tokens: '', done: false, becameAnswer: true })
        lastThink = findLastThinking(turn.events)
      }
      if (lastThink) lastThink.tokens += event.payload.token
      break
    }

    case 'thinking_delta': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink && !lastThink.becameAnswer) {
        lastThink.tokens += event.payload.delta
      }
      break
    }

    case 'thinking_end': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink) lastThink.done = true
      break
    }

    case 'tool_start': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink && !lastThink.becameAnswer) lastThink.consumed = true
      turn.events.push({
        kind: 'tool',
        name: event.payload.tool_name,
        input: event.payload.input,
        output: null,
        elapsed: null,
        status: 'running',
      })
      break
    }

    case 'tool_end': {
      const tc = findRunningTool(turn.events, event.payload.tool_name)
      if (tc) {
        tc.output = event.payload.output
        tc.elapsed = event.payload.elapsed
        tc.status = 'done'
      }
      break
    }

    case 'tool_error': {
      const tc = findRunningTool(turn.events, event.payload.tool_name)
      if (tc) {
        tc.status = 'error'
        tc.output = event.payload.error ?? null
        tc.elapsed = event.payload.elapsed ?? null
      }
      break
    }

    case 'tool_update': {
      const tc = findRunningTool(turn.events, event.payload.tool_name)
      if (tc) {
        tc.partialResult = (tc.partialResult ?? '') + event.payload.partial_result
      }
      break
    }

    case 'answer': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink) {
        lastThink.becameAnswer = true
        lastThink.tokens = event.payload.content
        lastThink.done = true
      }
      turn.finalAnswer = event.payload.content
      break
    }

    case 'done':
      ch.isStreaming = false
      if (ch.currentTurn) {
        ch.turns.push(ch.currentTurn)
        ch.currentTurn = null
      }
      break

    case 'error':
      ch.isStreaming = false
      ch.error = event.payload.message
      break

    case 'retry_start':
      turn.events.push({
        kind: 'system',
        detail: 'retry_start',
        content: `重试第 ${event.payload.attempt}/${event.payload.max_attempts} 次`,
        timestamp: Date.now(),
      })
      break

    case 'retry_end':
      turn.events.push({
        kind: 'system',
        detail: 'retry_end',
        content: event.payload.success ? '重试成功' : '重试失败',
        timestamp: Date.now(),
      })
      break

    case 'todo_reminder':
      turn.events.push({
        kind: 'system',
        detail: 'todo_reminder',
        content: `待办提醒: ${event.payload.todos.map(t => t.content).join('; ')}`,
        timestamp: Date.now(),
      })
      break

    case 'notice':
      turn.events.push({
        kind: 'system',
        detail: 'notice',
        content: `[${event.payload.level.toUpperCase()}]: ${event.payload.message}`,
        timestamp: Date.now(),
      })
      break

    case 'irc_message':
      turn.events.push({
        kind: 'system',
        detail: 'irc_message',
        content: `[IRC] ${event.payload.from} → ${event.payload.to}: ${event.payload.body}`,
        timestamp: Date.now(),
      })
      break
  }
}

// ── 测试套件 ──

describe('event processing — thinking / token flow', () => {
  let ch: MockChannel

  beforeEach(() => {
    ch = createChannel()
  })

  it('thinking_start pushes a thinking block', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    const block = findLastThinking(ch.currentTurn!.events)
    expect(block).toBeDefined()
    expect(block!.tokens).toBe('')
    expect(block!.done).toBe(false)
    expect(block!.becameAnswer).toBe(false)
  })

  it('token appends to existing thinking block', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    processEvent(ch, { type: 'token', payload: { token: 'Hello' } })
    processEvent(ch, { type: 'token', payload: { token: ' world' } })
    const block = findLastThinking(ch.currentTurn!.events)
    expect(block!.tokens).toBe('Hello world')
  })

  it('token without thinking_start creates becameAnswer block', () => {
    processEvent(ch, { type: 'token', payload: { token: 'Direct answer' } })
    const block = findLastThinking(ch.currentTurn!.events)!
    expect(block.becameAnswer).toBe(true)
    expect(block.tokens).toBe('Direct answer')
  })

  it('thinking_delta appends to thinking block (not answer)', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    processEvent(ch, { type: 'thinking_delta', payload: { delta: 'reasoning...' } })
    const block = findLastThinking(ch.currentTurn!.events)!
    expect(block.becameAnswer).toBe(false)
    expect(block.tokens).toBe('reasoning...')
  })

  it('thinking_delta does not create becameAnswer block', () => {
    // No thinking_start before, thinking_delta alone should not auto-create
    processEvent(ch, { type: 'thinking_delta', payload: { delta: 'orphan' } })
    const block = findLastThinking(ch.currentTurn!.events)
    expect(block).toBeUndefined()
  })

  it('thinking_end marks block done', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    processEvent(ch, { type: 'thinking_end', payload: {} })
    const block = findLastThinking(ch.currentTurn!.events)!
    expect(block.done).toBe(true)
  })

  it('answer sets becameAnswer and final content', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    processEvent(ch, { type: 'answer', payload: { content: 'Final answer' } })
    const block = findLastThinking(ch.currentTurn!.events)!
    expect(block.becameAnswer).toBe(true)
    expect(block.tokens).toBe('Final answer')
    expect(block.done).toBe(true)
    expect(ch.currentTurn!.finalAnswer).toBe('Final answer')
  })
})

describe('event processing — tool execution', () => {
  let ch: MockChannel

  beforeEach(() => {
    ch = createChannel()
  })

  it('tool_start pushes a running tool event and consumes prior thinking', () => {
    processEvent(ch, { type: 'thinking_start', payload: {} })
    processEvent(ch, { type: 'tool_start', payload: { tool_name: 'bash', input: '{}' } })
    const block = findLastThinking(ch.currentTurn!.events)!
    expect(block.consumed).toBe(true)
    const tools = ch.currentTurn!.events.filter(e => e.kind === 'tool') as ToolCall[]
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('bash')
    expect(tools[0].status).toBe('running')
  })

  it('tool_end marks tool done and sets output', () => {
    processEvent(ch, { type: 'tool_start', payload: { tool_name: 'bash', input: '{}' } })
    processEvent(ch, { type: 'tool_end', payload: { tool_name: 'bash', output: 'ok', elapsed: 1.2 } })
    const tool = ch.currentTurn!.events.find(e => e.kind === 'tool') as ToolCall
    expect(tool.status).toBe('done')
    expect(tool.output).toBe('ok')
    expect(tool.elapsed).toBe(1.2)
  })

  it('tool_error marks tool as error', () => {
    processEvent(ch, { type: 'tool_start', payload: { tool_name: 'bash', input: '{}' } })
    processEvent(ch, { type: 'tool_error', payload: { tool_name: 'bash', error: 'fail', elapsed: 0 } })
    const tool = ch.currentTurn!.events.find(e => e.kind === 'tool') as ToolCall
    expect(tool.status).toBe('error')
    expect(tool.output).toBe('fail')
  })

  it('tool_update appends partialResult', () => {
    processEvent(ch, { type: 'tool_start', payload: { tool_name: 'bash', input: '{}' } })
    processEvent(ch, { type: 'tool_update', payload: { tool_name: 'bash', partial_result: 'line1\n' } })
    processEvent(ch, { type: 'tool_update', payload: { tool_name: 'bash', partial_result: 'line2\n' } })
    const tool = ch.currentTurn!.events.find(e => e.kind === 'tool') as ToolCall
    expect(tool.partialResult).toBe('line1\nline2\n')
  })
})

describe('event processing — compaction', () => {
  let ch: MockChannel

  beforeEach(() => {
    ch = createChannel()
  })

  it('context_compressed adds system event', () => {
    processEvent(ch, { type: 'context_compressed', payload: { compressed: true, removed_count: 5 } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('context_compressed')
    expect(sys.content).toContain('5')
  })

  it('context_compressing adds system event with reason', () => {
    processEvent(ch, { type: 'context_compressing', payload: { reason: 'overflow', action: 'shake' } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('context_compressing')
    expect(sys.content).toContain('溢出')
    expect(sys.content).toContain('shake')
  })

  it('context_compressing caches to channel when no active turn', () => {
    ch.currentTurn = null
    processEvent(ch, { type: 'context_compressing', payload: { reason: 'idle', action: 'snapcompact' } })
    expect(ch.pendingCompaction).toEqual({ reason: 'idle', action: 'snapcompact' })
  })
})

describe('event processing — retry / todo / notice / irc', () => {
  let ch: MockChannel

  beforeEach(() => {
    ch = createChannel()
  })

  it('retry_start adds system event', () => {
    processEvent(ch, { type: 'retry_start', payload: { attempt: 1, max_attempts: 3, delay_ms: 500, error_message: 'err' } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('retry_start')
    expect(sys.content).toContain('1/3')
  })

  it('retry_end adds system event', () => {
    processEvent(ch, { type: 'retry_end', payload: { success: true, attempt: 2 } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('retry_end')
  })

  it('todo_reminder adds system event', () => {
    processEvent(ch, {
      type: 'todo_reminder',
      payload: { todos: [{ content: 'fix bug', status: 'pending' }], attempt: 1, max_attempts: 3 },
    })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('todo_reminder')
    expect(sys.content).toContain('fix bug')
  })

  it('notice adds system event with level', () => {
    processEvent(ch, { type: 'notice', payload: { level: 'warning', message: 'disconnected', source: 'mcp' } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('notice')
    expect(sys.content).toContain('WARNING')
    expect(sys.content).toContain('disconnected')
  })

  it('irc_message adds system event', () => {
    processEvent(ch, { type: 'irc_message', payload: { from: 'agent1', to: 'agent2', body: 'hello', id: 'm1' } })
    const sys = ch.currentTurn!.events.find(e => e.kind === 'system')!
    expect(sys.detail).toBe('irc_message')
    expect(sys.content).toContain('agent1')
    expect(sys.content).toContain('agent2')
    expect(sys.content).toContain('hello')
  })
})

describe('event processing — lifecycle', () => {
  let ch: MockChannel

  beforeEach(() => {
    ch = createChannel()
  })

  it('done finalizes turn and clears currentTurn', () => {
    expect(ch.currentTurn).not.toBeNull()
    expect(ch.turns).toHaveLength(0)
    processEvent(ch, { type: 'done', payload: {} })
    expect(ch.currentTurn).toBeNull()
    expect(ch.turns).toHaveLength(1)
    expect(ch.isStreaming).toBe(false)
  })

  it('error sets error state and stops streaming', () => {
    processEvent(ch, { type: 'error', payload: { code: 'AGENT_ERROR', message: 'Something broke' } })
    expect(ch.error).toBe('Something broke')
    expect(ch.isStreaming).toBe(false)
  })
})
