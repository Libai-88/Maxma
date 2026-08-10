// 防御性测试：模型/后端返回异常内容时，前端事件处理必须不崩溃、不脏状态
// 覆盖维度12（模型异常内容）+ 维度11（工具失败后继续）
import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { handleEventForChannel } from '@/composables/useChat'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'

function setup(sid = 'test-session') {
  useChatStore().getOrCreateChannel(sid)
  useSessionStore().sessionId = sid
  return useChatStore().channels.get(sid)!
}

/** 模拟 send() 之后的状态：currentTurn 由前端发送时创建（无 turn_start 事件） */
function startTurn(ch: ReturnType<typeof setup>, id: string) {
  ch.currentTurn = { id, userMessage: '测试消息', refs: [], events: [], memoryEvents: [], finalAnswer: null }
  ch.isStreaming = true
}

describe('robustness — 异常/畸形事件防御', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('未知事件类型不崩溃且不影响后续事件', () => {
    const ch = setup()
    // 未知/未来事件类型
    handleEventForChannel('test-session', { type: 'totally_unknown_event', payload: { x: 1 } } as never)
    expect(ch.isStreaming).toBe(false)
    expect(ch.turns.length).toBe(0)
    // 后续正常事件仍能处理（send 创建 turn → answer 完整链路）
    startTurn(ch, 't1')
    handleEventForChannel('test-session', {
      type: 'answer',
      payload: { content: '正常回复', turn_id: 't1' },
    })
    expect(ch.currentTurn).not.toBeNull()
    expect(ch.currentTurn?.finalAnswer).toBe('正常回复')
  })

  it('payload 为 null/字符串/数组时不崩溃', () => {
    const ch = setup()
    // payload 缺失
    handleEventForChannel('test-session', { type: 'context_usage' } as never)
    // payload 为字符串
    handleEventForChannel('test-session', { type: 'token', payload: 'oops-not-object' } as never)
    // payload 为数组
    handleEventForChannel('test-session', { type: 'tool_start', payload: [1, 2, 3] } as never)
    expect(ch.turns.length).toBe(0)
  })

  it('超大 tool 输出不崩溃', () => {
    const ch = setup()
    startTurn(ch, 't-big')
    const big = 'x'.repeat(500_000)
    handleEventForChannel('test-session', {
      type: 'tool_start',
      payload: { turn_id: 't-big', tool_name: 'bash', input: big },
    })
    handleEventForChannel('test-session', {
      type: 'tool_end',
      payload: { turn_id: 't-big', tool_name: 'bash', output: big, elapsed: 1.2 },
    })
    expect(ch.currentTurn?.events.filter(e => e.kind === 'tool').length).toBe(1)
  })

  it('tool_error 后 done 仍能正常 finalize（工具失败不阻塞 Agent 结束）', () => {
    const ch = setup()
    startTurn(ch, 't-err')
    handleEventForChannel('test-session', {
      type: 'tool_start',
      payload: { turn_id: 't-err', tool_name: 'fetch', input: 'https://x' },
    })
    handleEventForChannel('test-session', {
      type: 'tool_error',
      payload: { turn_id: 't-err', tool_name: 'fetch', error: 'connection refused' },
    })
    expect(ch.currentTurn?.events.find(e => e.kind === 'tool')?.status).toBe('error')
    // Agent 失败后仍返回回复
    handleEventForChannel('test-session', { type: 'answer', payload: { content: '网络不可用，我换个方式', turn_id: 't-err' } })
    handleEventForChannel('test-session', { type: 'done', payload: { turn_id: 't-err' } })
    expect(ch.isStreaming).toBe(false)
    expect(ch.currentTurn).toBeNull()
    expect(ch.turns.length).toBe(1)
    expect(ch.turns[0].finalAnswer).toContain('网络不可用')
  })

  it('空内容回复正常 finalize（不产生空 turn 或异常）', () => {
    const ch = setup()
    startTurn(ch, 't-empty')
    handleEventForChannel('test-session', { type: 'answer', payload: { content: '', turn_id: 't-empty' } })
    handleEventForChannel('test-session', { type: 'done', payload: { turn_id: 't-empty' } })
    expect(ch.isStreaming).toBe(false)
    expect(ch.currentTurn).toBeNull()
  })

  it('深嵌套 JSON tool 输出（JSON.stringify 爆栈场景）不崩溃', () => {
    const ch = setup()
    startTurn(ch, 't-deep')
    // 构造 2000 层深嵌套对象（真实场景来自 WS JSON.parse，已是对象形态）
    let deep: unknown = 'leaf'
    for (let i = 0; i < 2000; i++) deep = { level: i, next: deep }
    // 事件处理应吞掉任何序列化异常，不向外抛（ws.onmessage 的 try-catch 兜底）
    expect(() => handleEventForChannel('test-session', {
      type: 'tool_end',
      payload: { turn_id: 't-deep', tool_name: 'python', output: deep },
    } as never)).not.toThrow()
  })

  it('ask_user 深嵌套 tool_input stringify 爆栈时降级不丢事件', () => {
    const ch = setup()
    startTurn(ch, 't-ask-deep')
    let deep: unknown = 'leaf'
    for (let i = 0; i < 5000; i++) deep = { level: i, next: deep }
    expect(() => handleEventForChannel('test-session', {
      type: 'ask_user',
      payload: { tool_name: 'bash', tool_input: deep, question: '允许执行吗', mode: 'approval', interaction_id: 'i1' },
    } as never)).not.toThrow()
    // 事件不应丢失：占位 tool event 仍被创建
    expect(ch.currentTurn?.events.some(e => e.kind === 'tool')).toBe(true)
  })

  it('token 字段缺失/非字符串时不拼接 undefined', () => {
    const ch = setup()
    startTurn(ch, 't-undefined')
    handleEventForChannel('test-session', { type: 'token', payload: { token: undefined } } as never)
    handleEventForChannel('test-session', { type: 'token', payload: { token: 123 } } as never)
    handleEventForChannel('test-session', { type: 'token', payload: { token: '正常' } })
    const think = ch.currentTurn?.events.find(e => e.kind === 'thinking')
    expect(think?.tokens).toBe('正常')
    expect(think?.tokens).not.toContain('undefined')
  })

  it('TURN-OWNERSHIP：已终结轮次的迟到事件被丢弃，不污染新轮', () => {
    const ch = setup()
    // 旧轮：turn_start 由 send 创建 → done 设置 _lastDoneTurnId
    startTurn(ch, 'old-turn')
    handleEventForChannel('test-session', {
      type: 'tool_start',
      payload: { turn_id: 'old-turn', tool_name: 'bash', input: 'ls' },
    })
    handleEventForChannel('test-session', { type: 'done', payload: { turn_id: 'old-turn', cancelled: true } })
    expect(ch._lastDoneTurnId).toBe('old-turn')
    expect(ch.isStreaming).toBe(false)

    // 新轮开始（send 后状态）
    startTurn(ch, 'new-turn')
    // 旧轮的迟到事件（cancel RPC 生效前已序列化）：必须被丢弃
    handleEventForChannel('test-session', {
      type: 'tool_end',
      payload: { turn_id: 'old-turn', tool_name: 'bash', output: 'ghost output', elapsed: 1 },
    })
    handleEventForChannel('test-session', {
      type: 'error',
      payload: { turn_id: 'old-turn', code: 'AGENT_ERROR', message: '迟到的错误' },
    })
    // 新轮不被污染：无幽灵工具卡片、流式状态未被误杀
    expect(ch.currentTurn?.events.filter(e => e.kind === 'tool').length).toBe(0)
    expect(ch.isStreaming).toBe(true)
    // 新轮正常事件仍被处理
    handleEventForChannel('test-session', { type: 'token', payload: { token: '新轮内容', turn_id: 'new-turn' } })
    expect(ch.currentTurn?.events.find(e => e.kind === 'thinking')?.tokens).toBe('新轮内容')
  })
})
