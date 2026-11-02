/**
 * WS 事件收发契约回归锁（WS-EVENT-SINK-001）。
 *
 * ## 被修掉的缺陷
 *
 * `web/src/composables/useChat.ts` 的入站事件 `switch (event.type)` **没有 `default`
 * 分支**，而 `web/src/types/index.ts` 的 `ServerEvent` 联合里声明了
 * `workflow_step_start` / `workflow_step_end` / `workflow_step_error` /
 * `workflow_completed` 四个类型。后端 `routes/workflows.ts` 经 `server.ts` 的
 * `broadcastEvent` 真的在广播它们，前端一条都不接：类型面宣称接得住、快照全绿、
 * 页面照开，UI 只是永远少一块。上游改名同样会以这种"静默空白"的方式落地。
 *
 * 出站侧同一类问题：`ClientMessage` 联合只覆盖后端 `CLIENT_MESSAGE_TYPES`
 * 白名单 16 项中的 6 项，其余 10 项以无类型对象字面量发出，字段拼错零提示，
 * 而白名单外的 type 会被后端静默丢弃。
 *
 * ## 本测试锁什么
 *
 * 1. **不变式（结构性）**：`ServerEvent` 联合的每个成员都必须在
 *    `SERVER_EVENT_HANDLER_TYPES` 登记，且在 `useChat.ts` 里有真实分支
 *    （`case '…'` 或 `event.type === '…'`）；事件 switch 必须保留 `default`。
 *    往联合里加类型而不写分支 → 红；删掉 `default` → 红。
 * 2. **出站对账（结构性）**：`ClientMessage` 联合覆盖的 type 集合与后端
 *    `CLIENT_MESSAGE_TYPES` 白名单**完全相等**。两边都从源码读取，前端不维护
 *    第二份手写清单。
 * 3. **唯一出口（结构性）**：`useChat.ts` 里 `ws.send(JSON.stringify(` 只允许
 *    出现在 `sendClientMessage` 内部——所有出站帧都过类型检查。
 * 4. **行为**：未知入站事件必须（a）不抛错、（b）不改动任何通道状态、
 *    （c）经 logger 发出一次 dev 可见告警、（d）同一类型不刷屏、
 *    （e）不影响后续已登记事件的处理。
 * 5. **诚实性**：`llm_usage` 不在前端联合里（后端每条路径都 return，永不转发），
 *    `workflow_*` 也不在（前端零消费者）。恢复条件见 types/index.ts 的注释。
 *
 * 风格：结构性断言读源文本并先剥注释（对齐 tests/agentTasksGating.spec.ts、
 * tests/jetHubCapabilityGating.spec.ts——只在注释里提一句不算数）；
 * 行为性断言真的调用 `handleEventForChannel` / `sendClientMessage`。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { SERVER_EVENT_HANDLER_TYPES, handleEventForChannel, sendClientMessage } from '@/composables/useChat'
import { useChatStore } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 读源码并归一化：剥注释 + 把 CRLF 折成 LF。
 * 本仓 .ts 多为 CRLF，剥注释会在行首留下孤立的 \r（`^\s*` 把上一行的
 * `\r\n` 当空白吃掉），正则因此匹配不上——归一化后所有断言与平台无关。
 */
function readSource(rel: string): string {
  return stripComments(readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n'))
}

const USECHAT_SRC = readSource('../src/composables/useChat.ts')
const TYPES_SRC = readSource('../src/types/index.ts')
const CHAT_WS_SRC = readSource('../../bun-backend/src/routes/chat-ws.ts')

// ── 源码解析工具 ─────────────────────────────────────────

/**
 * 取 `export type <unionName> = …` 联合里列出的成员接口名。
 * 只扫联合声明自身的连续 `| Name` 行，不越界到下一个声明。
 */
function unionMemberNames(src: string, unionName: string): string[] {
  const start = src.indexOf(`export type ${unionName} =`)
  if (start < 0) throw new Error(`源码里找不到 export type ${unionName} =`)
  const names: string[] = []
  for (const line of src.slice(start).split('\n').slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^\|\s*([A-Za-z0-9_]+)$/.exec(trimmed)
    if (match) {
      names.push(match[1]!)
      continue
    }
    break // 联合结束
  }
  return names
}

/** 取接口 `<name>` 自己的判别字段字面量：`type: 'literal'`。 */
function discriminantOf(src: string, name: string): string {
  const start = src.indexOf(`export interface ${name} {`)
  if (start < 0) throw new Error(`源码里找不到 export interface ${name}`)
  const match = /^\s*type:\s*'([a-z_]+)',?$/m.exec(src.slice(start, start + 3000))
  if (!match) throw new Error(`interface ${name} 没有 type: '…' 判别字段`)
  return match[1]!
}

/** 联合成员接口对应的判别字面量集合。 */
function unionTypeLiterals(src: string, unionName: string): string[] {
  return unionMemberNames(src, unionName).map(name => discriminantOf(src, name))
}

/** `SERVER_EVENT_HANDLER_TYPES` 的键（源码侧解析，与运行时导出互为对账）。 */
function registryKeys(src: string): string[] {
  const marker = 'SERVER_EVENT_HANDLER_TYPES: Record<ServerEvent[\'type\'], true> = {'
  const start = src.indexOf(marker)
  if (start < 0) throw new Error('useChat.ts 里找不到 SERVER_EVENT_HANDLER_TYPES 的 Record 声明')
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}([a-z_]+):\s*true,$/gm)].map(m => m[1]!)
}

/** 事件被真实处理的路径：switch 的 `case '…'` 或入口的 `event.type === '…'`。 */
function handledTypeLiterals(src: string): Set<string> {
  const found = new Set<string>()
  for (const m of src.matchAll(/\bcase\s+'([a-z_]+)'/g)) found.add(m[1]!)
  for (const m of src.matchAll(/\bevent\.type\s*===\s*'([a-z_]+)'/g)) found.add(m[1]!)
  return found
}

/** 后端入站白名单 `CLIENT_MESSAGE_TYPES` 的条目。 */
function backendClientMessageTypes(src: string): string[] {
  const start = src.indexOf('const CLIENT_MESSAGE_TYPES = new Set([')
  if (start < 0) throw new Error('chat-ws.ts 里找不到 CLIENT_MESSAGE_TYPES')
  const body = src.slice(start, src.indexOf('])', start))
  return [...body.matchAll(/"([a-z_]+)"/g)].map(m => m[1]!)
}

const sorted = (items: string[]): string[] => [...items].sort()

// ── 1. 不变式：声明了就必须能处理 ─────────────────────────

describe('ServerEvent 联合 ↔ 前端处理分支（WS-EVENT-SINK-001 核心不变式）', () => {
  const declared = unionTypeLiterals(TYPES_SRC, 'ServerEvent')
  const handled = handledTypeLiterals(USECHAT_SRC)
  const registered = registryKeys(USECHAT_SRC)

  it('联合非空，且成员数与判别字面量数一致（防止解析器静默漏读）', () => {
    expect(declared.length).toBeGreaterThan(20)
    expect(unionMemberNames(TYPES_SRC, 'ServerEvent').length).toBe(declared.length)
    expect(new Set(declared).size).toBe(declared.length)
  })

  it('每个声明的 ServerEvent 成员都有真实处理分支（不存在"声明了但被丢弃"的类型）', () => {
    const unhandled = declared.filter(t => !handled.has(t))
    expect(unhandled, `这些类型在 ServerEvent 联合里声明，但 useChat.ts 没有任何分支：${unhandled.join(', ')}`).toEqual([])
  })

  it('每个声明的成员都登记在 SERVER_EVENT_HANDLER_TYPES，且登记项不多不少', () => {
    expect(sorted(registered)).toEqual(sorted(declared))
  })

  it('每个登记项都对应真实分支（防止只在清单里挂名而没有处理器）', () => {
    const phantom = registered.filter(t => !handled.has(t))
    expect(phantom, `SERVER_EVENT_HANDLER_TYPES 登记了但 useChat.ts 无分支：${phantom.join(', ')}`).toEqual([])
  })

  it('运行时导出的清单与源码解析结果一致（清单本身是唯一真相源）', () => {
    expect(sorted(Object.keys(SERVER_EVENT_HANDLER_TYPES))).toEqual(sorted(declared))
  })

  it('事件 switch 保留 default 兜底分支（删掉即红）', () => {
    const switchAt = USECHAT_SRC.indexOf('switch (event.type) {')
    expect(switchAt, '找不到事件 switch').toBeGreaterThan(-1)
    const after = USECHAT_SRC.slice(switchAt)
    const defaultAt = after.search(/^\s*default:\s*\{/m)
    expect(defaultAt, '事件 switch 没有 default 分支——未知事件会静默丢弃').toBeGreaterThan(-1)
    // default 必须在 switch 自身作用域内：case 体缩进 4 空格，其闭合是 `    }`；
    // switch 的闭合是顶格缩进 2 空格的 `  }`，default 必须落在它之前。
    const switchClose = after.indexOf('\n  }')
    expect(switchClose).toBeGreaterThan(defaultAt)
  })

  it('default 分支调用自我宣告，而不是空 break（空兜底等于没兜）', () => {
    expect(USECHAT_SRC).toMatch(/function warnUnknownInboundEvent\(/)
    const switchAt = USECHAT_SRC.indexOf('switch (event.type) {')
    const after = USECHAT_SRC.slice(switchAt)
    const defaultAt = after.search(/^\s*default:\s*\{/m)
    const block = after.slice(defaultAt, defaultAt + 600)
    expect(block).toMatch(/warnUnknownInboundEvent\(/)
  })

  it('入口守卫按登记清单拦截未知类型（无活跃轮次时也不会被更早的 return 吞掉）', () => {
    expect(USECHAT_SRC).toMatch(/_knownInboundEventTypes\s*=\s*new Set<string>\(Object\.keys\(SERVER_EVENT_HANDLER_TYPES\)\)/)
    const routerAt = USECHAT_SRC.indexOf('export function handleEventForChannel')
    expect(routerAt).toBeGreaterThan(-1)
    const gateAt = USECHAT_SRC.indexOf('_knownInboundEventTypes.has(', routerAt)
    const channelLookupAt = USECHAT_SRC.indexOf('const ch = getChatStore().channels.get(sid)', routerAt)
    expect(gateAt, 'handleEventForChannel 里找不到未知类型入口守卫').toBeGreaterThan(-1)
    expect(channelLookupAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(channelLookupAt)
  })

  // ── 元测试：证明上面的对账真的会红（防止解析器退化成永真断言）──
  // 缺陷的本质是"声明了但没人接"这件事**无人察觉**。若对账逻辑本身坏了，
  // 整份测试会永远绿。这里往源码副本里注入原始缺陷，断言对账必须抓到它。
  it('变异：往联合里加一个无分支的类型 → 对账必须抓到（原始缺陷的形状）', () => {
    const mutated = TYPES_SRC.replace(
      'export type ServerEvent =',
      'export interface SinkMutationEvent {\n  type: \'sink_mutation\'\n  payload: { x: number }\n}\n\nexport type ServerEvent =\n  | SinkMutationEvent',
    )
    expect(mutated).not.toBe(TYPES_SRC)
    const mutatedDeclared = unionTypeLiterals(mutated, 'ServerEvent')
    expect(mutatedDeclared).toContain('sink_mutation')
    // 无分支 → 红
    expect(mutatedDeclared.filter(t => !handled.has(t))).toContain('sink_mutation')
    // 未登记 → 与清单对账也红
    expect(sorted(registryKeys(USECHAT_SRC))).not.toEqual(sorted(mutatedDeclared))
  })

  it('变异：删掉 default 分支 → default 断言必须抓到', () => {
    const switchAt = USECHAT_SRC.indexOf('switch (event.type) {')
    const after = USECHAT_SRC.slice(switchAt)
    const defaultAt = after.search(/^\s*default:\s*\{/m)
    expect(defaultAt).toBeGreaterThan(-1)
    const defaultEnd = after.indexOf('\n    }', defaultAt)
    expect(defaultEnd).toBeGreaterThan(defaultAt)
    const withoutDefault = USECHAT_SRC.slice(0, switchAt) + after.slice(0, defaultAt) + after.slice(defaultEnd + '\n    }'.length)
    const afterMutated = withoutDefault.slice(withoutDefault.indexOf('switch (event.type) {'))
    expect(afterMutated.search(/^\s*default:\s*\{/m)).toBe(-1)
  })

})

// ── 2. 诚实性：不再声明前端接不住的类型 ───────────────────

describe('联合不再谎报未接通的表面', () => {
  const declared = unionTypeLiterals(TYPES_SRC, 'ServerEvent')

  it('workflow_* 不在前端联合里（后端确实广播，但 web/src 零消费者）', () => {
    for (const t of ['workflow_step_start', 'workflow_step_end', 'workflow_step_error', 'workflow_completed']) {
      expect(declared, `${t} 又回到 ServerEvent 联合了，但前端仍没有它`).not.toContain(t)
    }
    // 后端仍在广播：删除是"承认没接"，不是"后端不发了"。若后端停发，本断言
    // 会红并提醒重新核对两侧，而不是留下无人察觉的漂移。
    const WORKFLOWS_SRC = readSource('../../bun-backend/src/routes/workflows.ts')
    expect(WORKFLOWS_SRC).toMatch(/const EV_STEP_START = "workflow_step_start"/)
    expect(WORKFLOWS_SRC).toMatch(/eventSink\(sessionId, EV_COMPLETED/)
  })

  it('llm_usage 不在前端联合里，且后端每条路径都 return（只落台账，永不转发）', () => {
    expect(declared).not.toContain('llm_usage')
    const caseAt = CHAT_WS_SRC.indexOf('case "llm_usage": {')
    expect(caseAt, '后端 llm_usage 分支不见了——本测试的结论需重新核对').toBeGreaterThan(-1)
    const doneAt = CHAT_WS_SRC.indexOf('case "done"', caseAt)
    expect(doneAt).toBeGreaterThan(caseAt)
    const block = CHAT_WS_SRC.slice(caseAt, doneAt)
    expect(block).not.toMatch(/\bsend\(\s*"llm_usage"/)
    expect(block).toMatch(/return;/)
  })
})

// ── 3. 出站：ClientMessage ↔ 后端白名单 ──────────────────

describe('ClientMessage 联合 ↔ 后端 CLIENT_MESSAGE_TYPES 白名单', () => {
  const frontend = unionTypeLiterals(TYPES_SRC, 'ClientMessage')
  const backend = backendClientMessageTypes(CHAT_WS_SRC)

  it('两侧都解析到 16 项（解析器没漏读）', () => {
    expect(backend).toHaveLength(16)
    expect(frontend).toHaveLength(16)
    expect(new Set(backend).size).toBe(16)
    expect(new Set(frontend).size).toBe(16)
  })

  it('前端联合与后端白名单完全相等（多发被吞 / 漏声明失去类型检查，都算红）', () => {
    expect(sorted(frontend)).toEqual(sorted(backend))
  })

  it('变异：后端白名单多一项而前端没跟上 → 对账必须抓到', () => {
    const mutated = CHAT_WS_SRC.replace('"task_review",', '"task_review",\n  "sink_mutation_msg",')
    expect(mutated).not.toBe(CHAT_WS_SRC)
    expect(sorted(frontend)).not.toEqual(sorted(backendClientMessageTypes(mutated)))
  })

  it('变异：前端联合漏一项 → 对账必须抓到', () => {
    const mutated = TYPES_SRC.replace(/^ {2}\| SteerMessage\r?\n/m, '')
    expect(mutated).not.toBe(TYPES_SRC)
    expect(sorted(unionTypeLiterals(mutated, 'ClientMessage'))).not.toEqual(sorted(backend))
  })

  it('前端没有把后端清单复制成第二份手写真相源', () => {
    // 剥注释后，useChat.ts 的真实代码里不得出现 CLIENT_MESSAGE_TYPES
    expect(USECHAT_SRC).not.toMatch(/CLIENT_MESSAGE_TYPES/)
  })

  it('所有出站帧走 sendClientMessage 这个唯一出口（不再有裸 ws.send 对象字面量）', () => {
    const rawSends = [...USECHAT_SRC.matchAll(/ws\.send\(JSON\.stringify\(/g)].length
    expect(rawSends, '除 sendClientMessage 内部那一处外，不应再有裸 ws.send 序列化').toBe(1)
    expect(USECHAT_SRC).toMatch(/export function sendClientMessage\(ws: WebSocket, message: ClientMessage\): void \{\s+ws\.send\(JSON\.stringify\(message\)\)/)
  })
})

// ── 4. 行为：未知事件可见、无害、不刷屏 ───────────────────

describe('未知入站事件的真实行为', () => {
  const SID = 'a'.repeat(32)
  function setup() {
    useChatStore().getOrCreateChannel(SID)
    useSessionStore().sessionId = SID
    return useChatStore().channels.get(SID)!
  }

  function spyOnWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('未知类型：不抛错、不改动通道状态，且发出一次 dev 可见告警', () => {
    const warnSpy = spyOnWarn()
    const ch = setup()
    ch.isStreaming = true
    ch.streamPhase = 'streaming'

    handleEventForChannel(SID, { type: 'sink_unknown_alpha', payload: { run_id: 'r-1' } } as never)

    expect(ch.isStreaming).toBe(true)
    expect(ch.streamPhase).toBe('streaming')
    expect(ch.error).toBeNull()
    expect(ch.turns).toHaveLength(0)
    expect(ch.currentTurn).toBeNull()

    const messages = warnSpy.mock.calls.map(c => c.join(' '))
    expect(messages.filter(m => m.includes('sink_unknown_alpha'))).toHaveLength(1)
    expect(messages.find(m => m.includes('sink_unknown_alpha'))).toContain('未处理的入站事件类型')
  })

  it('同一未知类型重复到达只警告一次（不淹没 devtools），后续已登记事件照常处理', () => {
    const warnSpy = spyOnWarn()
    const ch = setup()
    for (let i = 0; i < 50; i++) {
      handleEventForChannel(SID, { type: 'sink_unknown_beta', payload: { i } } as never)
    }
    expect(warnSpy.mock.calls.filter(c => c.join(' ').includes('sink_unknown_beta'))).toHaveLength(1)

    // 状态机未被污染：正常事件链路仍然工作
    ch.currentTurn = {
      id: 'turn-1', userMessage: 'hi', refs: [], events: [], memoryEvents: [], finalAnswer: null,
    }
    ch.isStreaming = true
    handleEventForChannel(SID, { type: 'answer', payload: { content: '正常回复', turn_id: 'turn-1' } })
    expect(ch.currentTurn.finalAnswer).toBe('正常回复')
  })

  it('未知类型在无活跃轮次时同样会宣告（这正是 workflow_* 被静默丢弃的场景）', () => {
    const warnSpy = spyOnWarn()
    const ch = setup()
    expect(ch.currentTurn).toBeNull()
    handleEventForChannel(SID, { type: 'workflow_step_start', payload: { run_id: 'r-1', step_id: 's-1' } } as never)
    expect(warnSpy.mock.calls.map(c => c.join(' ')).some(m => m.includes('workflow_step_start'))).toBe(true)
  })

  it('已登记类型绝不会被入口守卫拦下（pong 仍更新心跳时间戳）', () => {
    const warnSpy = spyOnWarn()
    const ch = setup()
    ch._lastPongAt = 0
    handleEventForChannel(SID, { type: 'pong', payload: {} })
    expect(ch._lastPongAt).toBeGreaterThan(0)
    expect(warnSpy.mock.calls.map(c => c.join(' ')).some(m => m.includes('未处理的入站事件类型'))).toBe(false)
  })

  it('sendClientMessage 把类型化消息原样序列化到 socket', () => {
    const sent: string[] = []
    const fakeSocket = { send: (data: string) => { sent.push(data) } } as unknown as WebSocket

    sendClientMessage(fakeSocket, { type: 'cancel', payload: {} })
    sendClientMessage(fakeSocket, { type: 'goal_action', payload: { action: 'set', objective: '目标', token_budget: 1000 } })
    sendClientMessage(fakeSocket, { type: 'ping' })

    expect(sent.map(s => JSON.parse(s) as Record<string, unknown>)).toEqual([
      { type: 'cancel', payload: {} },
      { type: 'goal_action', payload: { action: 'set', objective: '目标', token_budget: 1000 } },
      { type: 'ping' },
    ])
  })
})
