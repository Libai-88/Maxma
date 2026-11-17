/**
 * web/tests/chatTurns.test.ts — 前端纯函数层的回归测试（P0-2）。
 *
 * 这套测试存在的原因：web 侧此前 **0 个测试文件**，而这些函数每一个都对应
 * 一个真实发生过的线上缺陷（HISTORY-REFS-001 气泡露出 `__refs__` 序列化、
 * THINK-SPLIT-001 思考转圈不消失、approval 按工具名匹配导致审批卡被覆盖、
 * RACE-002 历史恢复并发打爆后端）。它们都是纯计算，可以直接断言。
 *
 * 纪律：这里只测 chatTurns.ts，不 import useChat.ts（那会拉起 store/WS/React）。
 */

import { describe, expect, test } from 'bun:test'
import type { ChatTurn, MemoryToolEvent, ThinkingBlock, ToolCall } from '../src/types/index.ts'
import type { SessionChannel } from '../src/stores/chat.ts'
import {
  backendMessagesToTurns,
  findLastPureThinking,
  findLastThinking,
  findRunningMemoryTool,
  findRunningTool,
  findToolCallByCallId,
  findTurnByBackendId,
  getReconnectDelay,
  isValidSessionId,
  mapLimit,
  migrateLegacyTurn,
  TIME_SUFFIX_RE,
  toolBufferKey,
} from '../src/hooks/chatTurns.ts'

const SID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

function thinking(over: Partial<ThinkingBlock> = {}): ThinkingBlock {
  return { kind: 'thinking', tokens: '', done: false, ...over } as ThinkingBlock
}

function tool(over: Partial<ToolCall> = {}): ToolCall {
  return { kind: 'tool', name: 'bash', status: 'running', input: '', output: null, elapsed: null, ...over } as ToolCall
}

describe('isValidSessionId（RACE-002 前置守卫，后端 uuid4().hex = 32 hex）', () => {
  test('接受 32 位 hex（大小写均可）', () => {
    expect(isValidSessionId(SID)).toBe(true)
    expect(isValidSessionId(SID.toUpperCase())).toBe(true)
    expect(isValidSessionId('0'.repeat(32))).toBe(true)
  })

  test('拒绝 uuid 带连字符的常见误用、长度不符、非 hex', () => {
    expect(isValidSessionId('a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90')).toBe(false)
    expect(isValidSessionId('a'.repeat(31))).toBe(false)
    expect(isValidSessionId('a'.repeat(33))).toBe(false)
    expect(isValidSessionId('g'.repeat(32))).toBe(false)
    expect(isValidSessionId('')).toBe(false)
    expect(isValidSessionId('__pending__')).toBe(false)
  })
})

describe('getReconnectDelay（指数退避 1s→2s→4s…封顶 30s，±25% jitter）', () => {
  test('第 0 次在 750–1250ms，第 3 次在 6s–10s', () => {
    for (let i = 0; i < 50; i++) {
      const d0 = getReconnectDelay(0)
      expect(d0).toBeGreaterThanOrEqual(750)
      expect(d0).toBeLessThanOrEqual(1250)
      const d3 = getReconnectDelay(3)
      expect(d3).toBeGreaterThanOrEqual(6000)
      expect(d3).toBeLessThanOrEqual(10000)
    }
  })

  test('封顶：第 5 次起不再增长，永远落在 22500–37500ms', () => {
    for (let i = 0; i < 50; i++) {
      for (const attempt of [5, 10, 20, 50]) {
        const d = getReconnectDelay(attempt)
        expect(d).toBeGreaterThanOrEqual(22500)
        expect(d).toBeLessThanOrEqual(37500)
      }
    }
  })

  test('带 jitter：同一 attempts 多次取样不完全相同（不返回常量）', () => {
    const samples = new Set(Array.from({ length: 20 }, () => getReconnectDelay(0)))
    expect(samples.size).toBeGreaterThan(1)
  })
})

describe('mapLimit（PERF-HYDRATE-001 限并发）', () => {
  test('结果按下标保序，且并发不超过 limit', async () => {
    let inFlight = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6, 7]
    const out = await mapLimit(items, 3, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1) // 确实是并发而不是串行
  })

  test('limit 大于条目数 / 空数组 都不炸，空数组返回 []', async () => {
    expect(await mapLimit([1], 4, async n => n + 1)).toEqual([2])
    expect(await mapLimit([], 4, async n => n)).toEqual([])
  })

  test('单条抛错会让整体 reject（不吞错）', async () => {
    const p = mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    await expect(p).rejects.toThrow('boom')
  })
})

describe('migrateLegacyTurn（COMPAT/TIME-SUFFIX 迁移）', () => {
  test('新格式（已有 refs 数组）原样保留，只补 memoryEvents', () => {
    const t = { id: 'x', userMessage: '你好', refs: [{ type: 'file', label: 'a', path: 'a.ts' }], events: [] }
    const out = migrateLegacyTurn(t as Record<string, unknown>)
    expect(out.refs).toHaveLength(1)
    expect(out.memoryEvents).toEqual([])
  })

  test('旧格式：剥掉时间尾缀', () => {
    const out = migrateLegacyTurn({ id: 'x', userMessage: '帮我看下这个（2026-11-17 Tue 10:30）' })
    expect(out.userMessage).toBe('帮我看下这个')
    expect(out.refs).toEqual([])
  })

  test('旧格式带 __refs__ 标记：解析出 refs 并只留干净正文', () => {
    const refs = [{ type: 'file', label: 'a.ts', path: 'src/a.ts' }]
    const out = migrateLegacyTurn({
      id: 'x',
      userMessage: `看一下这个\n\n__refs__${JSON.stringify(refs)}__/refs__`,
    })
    expect(out.refs).toEqual(refs as never)
    expect(out.userMessage).toBe('看一下这个')
  })

  test('无尾缀无标记：正文不变，refs 为空', () => {
    const out = migrateLegacyTurn({ id: 'x', userMessage: '原样' })
    expect(out.userMessage).toBe('原样')
    expect(out.refs).toEqual([])
  })
})

describe('backendMessagesToTurns（HISTORY-REFS-001：后端历史 → 轮次）', () => {
  test('一轮 = 1 human + 后续 ai/tool；id 带会话前缀与 human 下标', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: '你好' },
      { role: 'tool', content: 'tool output' },
      { role: 'ai', content: '第一句' },
      { role: 'ai', content: '最后一句' },
      { role: 'human', content: '第二问' },
      { role: 'ai', content: '答' },
    ])
    expect(turns).toHaveLength(2)
    expect(turns[0].id).toBe(`history-${SID}-0`)
    expect(turns[1].id).toBe(`history-${SID}-4`)
    expect(turns[0].userMessage).toBe('你好')
    expect(turns[0].finalAnswer).toBe('最后一句') // 取最后一个非空 ai
    expect(turns[0].events).toEqual([])
    expect(turns[0].memoryEvents).toEqual([])
  })

  test('human 的时间尾缀被剥掉（否则气泡露出 "（2026-…）"）', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: '在吗（2026-11-17 Tue 10:30）' },
      { role: 'ai', content: '在' },
    ])
    expect(turns[0].userMessage).toBe('在吗')
  })

  test('human 的 __refs__ 标记被解析成 refs，chip 不再丢', () => {
    const refs = [{ type: 'file', label: 'a.ts', path: 'src/a.ts' }]
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: `看看这段\n\n__refs__${JSON.stringify(refs)}__/refs__` },
      { role: 'ai', content: '好' },
    ])
    expect(turns[0].refs).toEqual(refs as never)
    expect(turns[0].userMessage).toBe('看看这段')
  })

  test('没有前置 human 的孤儿消息被跳过，不产生空轮次', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'ai', content: '孤儿' },
      { role: 'tool', content: 'x' },
      { role: 'human', content: '问' },
      { role: 'ai', content: '答' },
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].userMessage).toBe('问')
  })

  test('整轮没有任何文字回复 → 给占位，不让用户以为对话被吞掉', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: '跑个命令' },
      { role: 'tool', content: 'output' },
    ])
    expect(turns[0].finalAnswer).toBe('（这一轮处理未生成文字回复，请查看工具执行结果或重新提问。）')
  })

  test('用量按轮汇总：同轮多请求相加，provider/model 取最后一条，时长取最后 ai 时间戳', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: '问', timestamp: 1000 },
      {
        role: 'ai', content: 'a1', provider: 'p1', model: 'm1', timestamp: 1500,
        usage: { input: 10, output: 5, cacheRead: 100 },
      },
      {
        role: 'ai', content: 'a2', provider: 'p2', model: 'm2', timestamp: 4000,
        usage: { input: 20, output: 7, cacheWrite: 30 },
      },
    ])
    const u = turns[0].usage!
    expect(u.inputTokens).toBe(30)
    expect(u.outputTokens).toBe(12)
    expect(u.cacheReadTokens).toBe(100)
    expect(u.cacheWriteTokens).toBe(30)
    expect(u.provider).toBe('p2')
    expect(u.model).toBe('m2')
    expect(u.durationMs).toBe(3000)
    expect(u.requests).toBe(2)
    expect(u.cacheStatus).toBe('observed')
    expect(u.priceStatus).toBeNull()
    expect(u.warmCalls).toBe(0)
  })

  test('无缓存字段 → cacheStatus 为 null；缺 usage 的 ai 消息不产生 usage 块', () => {
    const withUsage = backendMessagesToTurns(SID, [
      { role: 'human', content: '问', timestamp: 0 },
      { role: 'ai', content: '答', usage: { input: 1 }, timestamp: 10 },
    ])
    expect(withUsage[0].usage!.cacheStatus).toBeNull()
    expect(withUsage[0].usage!.cacheReadTokens).toBeNull()
    expect(withUsage[0].usage!.durationMs).toBe(10)

    const noUsage = backendMessagesToTurns(SID, [{ role: 'human', content: '问' }, { role: 'ai', content: '答' }])
    expect(noUsage[0].usage).toBeUndefined()
  })

  test('时间戳缺失时 durationMs 为 null（不臆造 0）', () => {
    const turns = backendMessagesToTurns(SID, [
      { role: 'human', content: '问' },
      { role: 'ai', content: '答', usage: { input: 1 }, timestamp: 10 },
    ])
    expect(turns[0].usage!.durationMs).toBeNull()
  })

  test('空历史 → 空轮次数组', () => {
    expect(backendMessagesToTurns(SID, [])).toEqual([])
  })
})

describe('TIME_SUFFIX_RE 本身', () => {
  test('只匹配结尾的中文括号日期，不动正文中间的时间串', () => {
    expect('问（2026-11-17 Tue 10:30）'.replace(TIME_SUFFIX_RE, '')).toBe('问')
    expect('问（2026-11-17 Tue 10:30）后续'.replace(TIME_SUFFIX_RE, '')).toBe('问（2026-11-17 Tue 10:30）后续')
  })
})

describe('事件扫描 finders（THINK-SPLIT-001 / approval 归属）', () => {
    test('findLastThinking 取最后一个 thinking（含已变成答案块的）', () => {
    const events = [thinking({ tokens: 'a' }), tool(), thinking({ tokens: 'b', becameAnswer: true })]
    expect(findLastThinking(events)!.tokens).toBe('b')
    expect(findLastThinking([tool()])).toBeUndefined()
  })

  test('findLastPureThinking 跳过 becameAnswer 块（否则思考转圈永不消失）', () => {
    const pure = thinking({ tokens: 'pure' })
    const events = [pure, thinking({ tokens: 'answer', becameAnswer: true })]
    expect(findLastPureThinking(events)).toBe(pure)
    expect(findLastPureThinking([thinking({ becameAnswer: true })])).toBeUndefined()
  })

  test('findRunningTool 只认同名且 running，取最后一个', () => {
    const e1 = tool({ name: 'bash', status: 'running', callId: 'c1' })
    const e2 = tool({ name: 'bash', status: 'done', callId: 'c2' })
    const e3 = tool({ name: 'bash', status: 'running', callId: 'c3' })
    expect(findRunningTool([e1, e2, e3], 'bash')).toBe(e3)
    expect(findRunningTool([e1], 'read')).toBeUndefined()
    expect(findRunningTool([e2], 'bash')).toBeUndefined()
  })

  test('findToolCallByCallId 按 id 定位（同轮两次 bash 不会互相覆盖）', () => {
    const first = tool({ name: 'bash', callId: 'c1', status: 'running' })
    const second = tool({ name: 'bash', callId: 'c2', status: 'running' })
    expect(findToolCallByCallId([first, second], 'c1')).toBe(first)
    expect(findToolCallByCallId([first, second], 'c2')).toBe(second)
    expect(findToolCallByCallId([first, second], 'c9')).toBeUndefined()
    expect(findToolCallByCallId([first, second], undefined)).toBeUndefined()
  })

  test('toolBufferKey 按 callId 分开，无 callId 时退化为工具名，键用 \\0 分隔', () => {
    expect(toolBufferKey('s1', 't1', 'bash', 'c1')).toBe('s1\u0000t1\u0000c1')
    expect(toolBufferKey('s1', 't1', 'bash', undefined)).toBe('s1\u0000t1\u0000bash')
  })

  test('findTurnByBackendId 先找 currentTurn，再找历史 turns', () => {
    const ch = {
      turns: [{ id: 'h1', turnId: 't-old' }, { id: 'h2', turnId: 't-both' }],
      currentTurn: { id: 'cur', turnId: 't-both' },
    } as unknown as SessionChannel
    expect(findTurnByBackendId(ch, 't-both')!.id).toBe('cur')
    expect(findTurnByBackendId(ch, 't-old')!.id).toBe('h1')
    expect(findTurnByBackendId(ch, 'nope')).toBeUndefined()

    const noCurrent = { turns: [{ id: 'h1', turnId: 't1' }], currentTurn: null } as unknown as SessionChannel
    expect(findTurnByBackendId(noCurrent, 't1')!.id).toBe('h1')
  })

  test('findRunningMemoryTool 只认同名且 running，取最后一个', () => {
    const mem = (status: MemoryToolEvent['status'], id: string): MemoryToolEvent =>
      ({ kind: 'memory_tool', name: 'remember', status, input: '', output: null, elapsed: null, id } as MemoryToolEvent & { id: string })
    const a = mem('running', '1')
    const b = mem('done', '2')
    const c = mem('running', '3')
    expect(findRunningMemoryTool([a, b, c], 'remember')).toBe(c)
    expect(findRunningMemoryTool([b], 'remember')).toBeUndefined()
    expect(findRunningMemoryTool([a], 'recall')).toBeUndefined()
  })
})

// ChatTurn 形状约束：backendMessagesToTurns 必须补全这些字段（否则 UI 缺字段炸在渲染期）
test('backendMessagesToTurns 的轮次满足 ChatTurn 必需字段', () => {
  const turns = backendMessagesToTurns(SID, [{ role: 'human', content: 'q' }, { role: 'ai', content: 'a' }])
  const t = turns[0] as ChatTurn
  expect(typeof t.id).toBe('string')
  expect(typeof t.userMessage).toBe('string')
  expect(Array.isArray(t.refs)).toBe(true)
  expect(Array.isArray(t.events)).toBe(true)
  expect(Array.isArray(t.memoryEvents)).toBe(true)
  expect(typeof t.finalAnswer).toBe('string')
})
