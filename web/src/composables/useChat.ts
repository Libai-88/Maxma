import { computed, watch, onUnmounted, ref, type Ref } from 'vue'
import type { ClientMessage, ServerEvent, ChatTurn, ToolCall, ThinkingBlock, TurnEvent, ContextUsage, AskUserEvent, ArtifactEvent, PlanProposedEvent, PlanStepStartEvent, PlanStepEndEvent, PlanStepErrorEvent, PlanCompletedEvent, DeferredSubagentSubmittedEvent, MemoryToolEvent, MemoryToolStartEvent, MemoryToolEndEvent, MemoryToolErrorEvent, MemoryStartEvent, MemoryDoneEvent } from '@/types'
import type { ThinkPathId } from '@/utils/thinkPath'
import { useChatStore, TURNS_KEY_PREFIX } from '@/stores/chat'
import { useSessionStore } from '@/stores/session'
import { buildFlatMessage, buildTimestamp, parseReferences } from '@/utils/references'
import type { ParsedRef } from '@/utils/references'
import { getToken, ensureTokenLoaded, resetToken, api } from '@/api'
import { ensurePortLoaded, waitForBackend, getWsBase, generateUUID, tauriFetch } from '@/utils/env'
import { chatSessionAliveCache } from '@/composables/sessionAliveCache'
import { useWorkbenchStore } from '@/stores/workbench'
import { detectEmotion, getStickerUrl } from './stickerUtils'

/** 追踪当前 useChat 实例创建的子会话 ID，用于组件卸载时清理孤儿 WS。 */
const _childSessionIds = new Set<string>()
/** 匹配旧格式尾缀（用于 localStorage 迁移） */
const TIME_SUFFIX_RE = /（\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}）$/

/** 将旧格式 turn（userMessage 含 __refs__ 和时间尾缀）迁移为新格式 */
function migrateLegacyTurn(turn: any): ChatTurn {
  if (Array.isArray(turn.refs)) {
    return { memoryEvents: [], ...turn } as ChatTurn
  }
  // 旧格式：从 userMessage 中提取 refs 和时间尾缀
  const prevMsg = (turn.userMessage ?? '') as string
  const { cleanText, refs } = parseReferences(prevMsg || '')
  const text = refs.length > 0 ? cleanText : prevMsg.replace(TIME_SUFFIX_RE, '')
  return { ...turn, userMessage: text, refs, memoryEvents: [] }
}

// 从 localStorage 恢复所有会话的消息缓存（页面刷新后仍保留）
function loadAllTurnsFromStorage(): Map<string, ChatTurn[]> {
  const map = new Map<string, ChatTurn[]>()
  const keysFound: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(TURNS_KEY_PREFIX)) {
      keysFound.push(key)
      const sid = key.slice(TURNS_KEY_PREFIX.length)
      try {
        const raw = localStorage.getItem(key) || '[]'
        const data = JSON.parse(raw)
        if (Array.isArray(data)) {
          const migrated = data.map(migrateLegacyTurn)
          console.log(`[useChat:load] 从 localStorage 加载会话 ${sid}: ${data.length} 条 turn (迁移 ${migrated.length}), 序列化长度 ${raw.length}`)
          map.set(sid, migrated)
        } else {
          console.warn(`[useChat:load] 键 ${key} 的数据不是数组，跳过`)
        }
      } catch (e) {
        console.error(`[useChat:load] 解析 localStorage 键 ${key} 失败:`, e)
      }
    }
  }
  console.log(`[useChat:load] localStorage 中共 ${keysFound.length} 个 ${TURNS_KEY_PREFIX}* 键, 恢复 ${map.size} 个会话的缓存`)
  return map
}

function saveTurnsToStorage(sid: string, data: ChatTurn[]) {
  const key = TURNS_KEY_PREFIX + sid
  const tryWrite = () => {
    const serialized = JSON.stringify(data)
    const size = new Blob([serialized]).size
    localStorage.setItem(key, serialized)
    return size
  }
  try {
    const size = tryWrite()
    console.log(`[useChat:save] 保存会话 ${sid} 到 localStorage: ${data.length} 条 turn, 约 ${(size / 1024).toFixed(1)} KB, key=${key}`)
  } catch (e) {
    // 修复：配额超限后无清理 → 后续所有保存全部静默失败，用户无感知地丢失持久化。
    // 策略：删除其他会话中最早（按 localStorage 键的写入顺序近似）的缓存，腾出空间后重试一次。
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      console.warn(`[useChat:save] localStorage 配额超限，尝试清理其他会话缓存后重试 (key=${key})`)
      // 收集除当前 sid 外的所有 turns 缓存键，按"最近未使用"策略删除最旧的
      const otherKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(TURNS_KEY_PREFIX) && k !== key) {
          otherKeys.push(k)
        }
      }
      // 删除一半最旧的缓存（最多保留一半），按键在 localStorage 中的顺序（近似 FIFO）
      const toEvict = otherKeys.slice(0, Math.max(1, Math.ceil(otherKeys.length / 2)))
      for (const k of toEvict) {
        localStorage.removeItem(k)
        const evictedSid = k.slice(TURNS_KEY_PREFIX.length)
        turnsCache.delete(evictedSid)
        console.warn(`[useChat:save] 配额压力下清理会话 ${evictedSid} 的缓存`)
      }
      // 重试一次
      try {
        const size = tryWrite()
        console.log(`[useChat:save] 清理后重试成功: 会话 ${sid}, ${data.length} 条 turn, 约 ${(size / 1024).toFixed(1)} KB`)
      } catch (e2) {
        console.error(`[useChat:save] 清理后仍无法保存会话 ${sid} (key=${key}):`, e2)
        // 最后手段：移除当前会话自己的缓存键，避免留下部分写入的脏数据
        try { localStorage.removeItem(key) } catch { /* ignore */ }
      }
    } else {
      console.error(`[useChat:save] 保存会话 ${sid} 到 localStorage 失败 (key=${key}):`, e)
      let total = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k) total += k.length + (localStorage.getItem(k) || '').length
      }
      console.warn(`[useChat:save] localStorage 当前总估算用量: ${(total * 2 / 1024).toFixed(1)} KB`)
    }
  }
}

export function disconnectSession(sid: string) {
  const chatStore = useChatStore()
  const ch = chatStore.channels.get(sid)
  if (!ch) return
  if (ch.reconnectTimer) {
    clearTimeout(ch.reconnectTimer)
    ch.reconnectTimer = null
  }
  // 清理心跳 ping 定时器（修复 R-005）
  if (ch._pingTimer) {
    clearInterval(ch._pingTimer)
    ch._pingTimer = null
  }
  if (ch.ws) {
    ch.ws.onclose = null
    ch.ws.close()
    ch.ws = null
  }
  ch.connected = false
  ch.initialized = false
  chatStore.removeChannel(sid)
  chatSessionAliveCache.remove(sid)
}

// Lazy store accessors — Pinia 在模块加载时尚未安装，只能在运行时调用
function getChatStore() { return useChatStore() }
function getSessionStore() { return useSessionStore() }

const refreshSessions = () => getSessionStore().refreshSessions().catch(() => {/* 保留现有列表，静默失败 */})
const switchSession = (id: string) => getSessionStore().switchSession(id)
// 模块级缓存：首次 import 时从 localStorage 恢复所有会话的历史消息
// （修复：此前为 new Map()，导致 loadAllTurnsFromStorage 成为死代码，
//   页面刷新后 turnsCache 为空，旧会话点击后无历史显示）
const turnsCache = loadAllTurnsFromStorage()

// ── SessionChannel 定义 ────────────────────────────────────

interface SessionChannel {
  ws: WebSocket | null
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
  turns: ChatTurn[]
  currentTurn: ChatTurn | null
  error: string | null
  errorCategory: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled' | null
  errorTraceId: string | null
  contextUsage: ContextUsage | null
  taskTrackerData: Record<string, unknown> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempts: number  // 重连次数，用于计算退避延迟
  initialized: boolean
  _awaitingToolName: string | null
  parentSessionId: string | null  // sub-agent 用：完成时切回主会话
  privateMode: boolean
  autoApprove: boolean
  _pingTimer: ReturnType<typeof setInterval> | null  // 心跳 ping 定时器
}

// Lazy export — 运行时才访问 Store（Pinia 在模块加载时尚未安装）
export function getAllSessionStatuses() { return getChatStore().allSessionStatuses }

function getOrCreateChannel(sid: string): SessionChannel {
  return getChatStore().getOrCreateChannel(sid) as SessionChannel
}

function persistTurns(sid: string) {
  const ch = getChatStore().channels.get(sid)
  if (!ch) {
    console.warn(`[useChat:persist] 跳过保存 sid="${sid}": 通道不存在`)
    return
  }
  const snapshot = [...ch.turns]
  console.log(`[useChat:persist] 持久化会话 ${sid}: ${snapshot.length} 条 turn`)
  turnsCache.set(sid, snapshot)
  saveTurnsToStorage(sid, snapshot)
}

// ── WebSocket 生命周期（每 Session 独立管理） ──────────────

/** 会话 ID 格式验证：由后端 uuid.uuid4().hex 生成（32 位 hex） */
const SID_RE = /^[0-9a-f]{32}$/i

function isValidSessionId(sid: string): boolean {
  return SID_RE.test(sid)
}

/** 计算指数退避延迟（毫秒）：1s → 2s → 4s → 8s → ... → 最大 30s，附加 ±25% jitter 防止 thundering herd */
function getReconnectDelay(attempts: number): number {
  const base = 1000
  const maxDelay = 30000
  const raw = Math.min(base * Math.pow(2, attempts), maxDelay)
  // ±25% jitter：最终延迟在 0.75x ~ 1.25x 之间随机
  const jitter = 0.75 + Math.random() * 0.5
  return Math.round(raw * jitter)
}

/** 最大重连次数，超过后停止重连 */
const MAX_RECONNECT_ATTEMPTS = 20

/** 检查通道是否仍有效（未被关闭/移除），防止 await 间隙操作失效。 */
function isChannelStillValid(sid: string): boolean {
  const ch = getChatStore().channels.get(sid)
  return !!ch && ch.initialized
}

async function connectSession(sid: string) {
  if (!isValidSessionId(sid)) {
    console.error(`[useChat] 拒绝连接：非法的 sessionId "${sid}"`)
    return
  }
  const ch = getOrCreateChannel(sid)
  // 防止重复连接：如果已有 OPEN 或 CONNECTING 的 WS，跳过
  if (ch.ws && (ch.ws.readyState === WebSocket.OPEN || ch.ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  // 确保端口已加载（Tauri 环境下 sidecar 端口可能不是默认 8000）
  await ensurePortLoaded()
  if (!isChannelStillValid(sid)) return

  // 等待后端就绪（PyInstaller onefile 启动可能需要数秒，孤儿 sidecar 被清理后
  // 新 sidecar 需要时间启动）。waitForBackend 在后端已就绪时立即返回，仅在后端
  // 未启动时重试等待，避免前端在后端启动期间反复失败。
  // 修复 R-003：检查 waitForBackend 返回值，后端未就绪时放弃本次连接并调度重连。
  const backendReady = await waitForBackend()
  if (!isChannelStillValid(sid)) return
  if (!backendReady) {
    console.warn(`[useChat] 后端未就绪 (sid=${sid}), 延迟重连`)
    const ch = getOrCreateChannel(sid)
    ch.error = '连接失败：后端服务未就绪'
    ch.connected = false
    if (ch.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = getReconnectDelay(ch.reconnectAttempts)
      ch.reconnectAttempts++
      ch.reconnectTimer = setTimeout(() => {
        connectSession(sid).catch(err => {
          console.error(`[useChat] 重连失败 (sid=${sid}):`, err)
        })
      }, delay)
    }
    return
  }

  // 确保 Token 已加载（桌面应用运行时获取）
  await ensureTokenLoaded()
  if (!isChannelStillValid(sid)) return

  const token = getToken()
  if (!token) {
    const ch = getChatStore().channels.get(sid)
    if (!ch) return
    ch.connected = false
    ch.error = '连接失败：未能获取认证令牌'
    if (ch.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return
    }
    const delay = getReconnectDelay(ch.reconnectAttempts)
    ch.reconnectAttempts++
    ch.reconnectTimer = setTimeout(() => connectSession(sid), delay)
    return
  }
  // 最终校验：通道在 await 后可能已被移除
  if (!isChannelStillValid(sid)) return
  const chFinal = getOrCreateChannel(sid)
  // 防止 await 间隙其它调用已创建 WS
  if (chFinal.ws && (chFinal.ws.readyState === WebSocket.OPEN || chFinal.ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  const url = `${getWsBase()}/ws/chat/${sid}`
  chFinal.ws = new WebSocket(url, [token])
  const ws = chFinal.ws  // 本地引用，避免后续代码重复解引用

    ws.onopen = () => {
      chFinal.connected = true
      chFinal.reconnectAttempts = 0  // 连接成功，重置退避计数
      chFinal.error = null  // 清除连接错误状态
      if (chFinal.reconnectTimer) {
        clearTimeout(chFinal.reconnectTimer)
        chFinal.reconnectTimer = null
      }
      console.log(`[useChat] WS connected: session=${sid}`)
      // 修复 R-005：启动心跳 ping 定时器，每 30s 发送 ping 检测静默断开。
      // 浏览器 TCP keepalive 默认超时过长（可达 2h+），靠 close 事件触发重连
      // 在网络异常断开时无法及时恢复。应用层心跳确保 in-flight 连接
      // 在 30s + RTT 内被检测到失效并发起重连。
      if (chFinal._pingTimer) clearInterval(chFinal._pingTimer)
      chFinal._pingTimer = setInterval(() => {
        const ch = getChatStore().channels.get(sid)
        if (ch?.ws && ch.ws.readyState === WebSocket.OPEN) {
          ch.ws.send(JSON.stringify({ type: 'ping' }))
        } else {
          // 连接已断开，清除定时器
          const chInner = getChatStore().channels.get(sid)
          if (chInner?._pingTimer) {
            clearInterval(chInner._pingTimer)
            chInner._pingTimer = null
          }
        }
      }, 30000)
    // 修复：重连后若上一轮 currentTurn 仍卡住（WS 中断时未收到 done/error），
    // 必须清理否则 isStreaming 永久为 true，且中断的轮次数据会因下次 send 被覆盖而丢失。
    // 后端 WS 断开时已 cancel agent_task，所以这个 currentTurn 永远等不到 done 事件。
    if (chFinal.isStreaming && chFinal.currentTurn) {
      const interrupted = chFinal.currentTurn
      console.warn(`[useChat] 重连检测到中断的轮次 (turn.id=${interrupted.id}), 推入 turns 并重置状态`)
      // 保留已生成的部分内容（用户能看到中断点），标记未完成
      if (!interrupted.finalAnswer) {
        interrupted.finalAnswer = '（连接中断，回复未完成）'
      }
      chFinal.turns.push(interrupted)
      chFinal.currentTurn = null
      chFinal.isStreaming = false
      chFinal.isAwaitingUser = false
      chFinal._awaitingToolName = null
      if (!chFinal.privateMode) {
        persistTurns(sid)
      }
    }
  }

  ws.onclose = (event) => {
    chFinal.connected = false
    // 清理心跳 ping 定时器（修复 R-005）
    if (chFinal._pingTimer) {
      clearInterval(chFinal._pingTimer)
      chFinal._pingTimer = null
    }
    // 认证失败（Token 过期/轮换）— 刷新 Token 后重连
    if (event.code === 4001) {
      console.log(`[useChat] WS auth failure (4001), refreshing token...`)
      resetToken()  // 强制下次请求重新获取 Token
    }
    // 正常关闭（code 1000）— 不重连，视为有意断开
    if (event.code === 1000) {
      console.log(`[useChat] WS normal close (1000), session=${sid}, not reconnecting`)
      return
    }
    // 超过最大重连次数，停止重连
    if (chFinal.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[useChat] WS 已达最大重连次数 (${MAX_RECONNECT_ATTEMPTS})，停止重连`)
      chFinal.error = '连接失败：已达最大重连次数，请刷新页面重试'
      return
    }
    // 指数退避重连
    const delay = getReconnectDelay(chFinal.reconnectAttempts)
    chFinal.reconnectAttempts++
    // 握手失败（code 1006 异常关闭，未收到任何 close frame）降级为 debug，
    // 避免在 sidecar 未启动时污染控制台（浏览器自身仍会打印资源加载 error，无法抑制）
    const logFn = event.code === 1006 ? console.debug : console.log
    logFn(`[useChat] WS closed: session=${sid}, code=${event.code}, reconnecting in ${delay}ms (attempt ${chFinal.reconnectAttempts})`)
    // 修复 R-002：捕获重连 timer 中 connectSession 的未处理 rejection
    chFinal.reconnectTimer = setTimeout(() => {
      connectSession(sid).catch(err => {
        console.error(`[useChat] 重连失败 (sid=${sid}):`, err)
        const ch = getChatStore().channels.get(sid)
        if (ch && !ch.error) {
          ch.error = `重连失败：${err instanceof Error ? err.message : String(err)}`
        }
      })
    }, delay)
  }

  ws.onerror = () => {
    // onerror 后通常会触发 onclose，退避重连在 onclose 中处理
    // 握手阶段失败（readyState 仍为 CONNECTING）降级为 debug，避免 sidecar 未启动时噪声
    if (ws.readyState === WebSocket.CONNECTING) {
      console.debug(`[useChat] WS handshake error (CONNECTING): session=${sid}`)
    } else {
      console.warn(`[useChat] WS error: session=${sid}`)
    }
  }

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg: ServerEvent = JSON.parse(event.data)
      console.log('[useChat] WS event received:', msg.type, 'session:', sid, msg.type === 'ask_user' ? {
        tool_name: (msg as AskUserEvent).payload.tool_name,
        interaction_id: (msg as AskUserEvent).payload.interaction_id,
      } : '')
      handleEventForChannel(sid, msg)
    } catch (e) {
      console.error('[useChat] WS message parse/handle error:', e)
    }
  }
}

export function ensureConnected(sid: string) {
  if (!sid) {
    console.warn(`[useChat:ensureConnected] 跳过空 sid`)
    return
  }
  if (!isValidSessionId(sid)) {
    console.error(`[useChat:ensureConnected] 拒绝连接：非法的 sessionId "${sid}"`)
    return
  }
  const ch = getOrCreateChannel(sid)
  if (ch.initialized) {
    console.log(`[useChat:ensureConnected] 会话 ${sid} 已初始化, 跳过`)
    return
  }
  console.log(`[useChat:ensureConnected] 初始化会话 ${sid} 的 WebSocket 连接`)
  ch.initialized = true
  // 修复 R-002：捕获 connectSession 的未处理 rejection，设置错误状态
  connectSession(sid).catch(err => {
    console.error(`[useChat] connectSession 失败 (sid=${sid}):`, err)
    const ch = getChatStore().channels.get(sid)
    if (ch) {
      ch.error = `连接失败：${err instanceof Error ? err.message : String(err)}`
      ch.connected = false
    }
  })
}

// ── 事件路由 ──────────────────────────────────────────────

function handleEventForChannel(sid: string, event: ServerEvent) {
  const ch = getChatStore().channels.get(sid)
  if (!ch) return

  // context_usage 可以在无活跃轮次时接收（如连接初始化）
  if (event.type === 'context_usage') {
    const p = event.payload as ContextUsage
    ch.contextUsage = p
    getChatStore().updateContextUsage({
      estimatedTokens: p.estimated_tokens ?? 0,
      maxTokens: p.max_tokens ?? 128000,
      percentage: p.percentage ?? 0,
      messageCount: p.message_count ?? 0,
      modelName: p.model_name ?? '',
    })
    return
  }

  // context_compressed：上下文压缩完成通知（可能在无活跃轮次时到达，如手动压缩）
  if (event.type === 'context_compressed') {
    const payload = event.payload
    // 更新上下文用量占比（后端 context_usage_after 为 0-1 浮点数，转为百分比）
    if (payload.context_usage_after !== undefined && ch.contextUsage) {
      ch.contextUsage = {
        ...ch.contextUsage,
        usage_percent: Math.round(payload.context_usage_after * 1000) / 10,
      }
    }
    // 在当前 turn 事件流中追加压缩通知
    if (ch.currentTurn) {
      ch.currentTurn.events.push({
        kind: 'system',
        detail: 'context_compressed',
        content: `上下文已压缩：移除 ${payload.removed_count ?? 0} 条消息` +
          (payload.summary_preview ? `，摘要：${payload.summary_preview}` : ''),
        timestamp: Date.now(),
      })
    }
    return
  }

  // sub_session_created 可能在任何时候到达（主 Agent 调用 call_sub_agent）
  if (event.type === 'sub_session_created') {
    const subId = event.payload.sub_session_id
    const parentId = event.payload.parent_session_id
    void refreshSessions()
    ensureConnected(subId)

    // 追踪子会话，用于组件卸载时清理孤儿 WS
    _childSessionIds.add(subId)

    // 初始化子会话的 currentTurn，否则子 Agent 推送的所有事件都被丢弃
    const subCh = getOrCreateChannel(subId)
    subCh.parentSessionId = parentId
    subCh.isStreaming = true
    subCh.currentTurn = {
      id: generateUUID(),
      userMessage: event.payload.task || '(子 Agent 任务)',
      refs: [],
      events: [],
      memoryEvents: [],
      finalAnswer: null,
    }

    void switchSession(subId)
    return
  }

  // Deferred mode deliberately sends only an opaque ID. The card resolves the
  // browser-safe run projection lazily instead of caching task/scope details.
  if (event.type === 'deferred_subagent_submitted') {
    const submitted = event as DeferredSubagentSubmittedEvent
    const runId = submitted.payload.run_id
    if (ch.currentTurn && runId && !ch.currentTurn.deferredRunIds?.includes(runId)) {
      ch.currentTurn.deferredRunIds = [...(ch.currentTurn.deferredRunIds ?? []), runId]
    }
    return
  }

  // memory_tool_* / memory_start / memory_done 可能在 done 事件之后到达（currentTurn 已清空），
  // 必须在 const turn = ch.currentTurn 守卫之前处理，通过 turn_id 自行查找目标。
  if (event.type === 'memory_start' || event.type === 'memory_tool_start' || event.type === 'memory_tool_end'
    || event.type === 'memory_tool_error' || event.type === 'memory_done') {
    handleMemoryToolEvent(ch, sid, event)
    return
  }

  const turn = ch.currentTurn
  if (!turn) return

  switch (event.type) {
    case 'thinking_start':
      turn.events.push({ kind: 'thinking', tokens: '', done: false, becameAnswer: false })
      break

    case 'token': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink) {
        lastThink.tokens += event.payload.token
      }
      break
    }

    case 'thinking_end': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink) {
        lastThink.done = true
      }
      break
    }

    case 'tool_start': {
      console.log(`[useChat] tool_start: "${event.payload.tool_name}"`, { input: event.payload.input, session: sid })
      // 标记上一个 thinking 块为 consumed（工具调用前的中间思考，UI 不渲染）
      const lastThink = findLastThinking(turn.events)
      if (lastThink && !lastThink.becameAnswer) {
        lastThink.consumed = true
      }
      // ApprovalToolNode 场景：ask_user(approval) 事件先到达时已创建占位 tool event，
      // 此时 tool_start 到达应更新该 event 的 input（后端 tool_start 携带的 input 更准确），
      // 而不是重复 push 一个新的 tool event。
      const existingApprovalTool = findRunningTool(turn.events, event.payload.tool_name)
      if (existingApprovalTool && existingApprovalTool.interaction?.mode === 'approval') {
        console.log('[useChat] tool_start: 复用已存在的 approval 占位 tool event，更新 input')
        existingApprovalTool.input = event.payload.input
        break
      }
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
        if (event.payload.tool_data) {
          tc.toolData = event.payload.tool_data
          if (event.payload.tool_name === 'task_tracker' && event.payload.tool_data) {
            ch.taskTrackerData = event.payload.tool_data as Record<string, unknown>
          }
        }
        console.log(`[useChat] tool_end: "${event.payload.tool_name}"`, {
          output_len: (event.payload.output || '').length,
          output_preview: (event.payload.output || '').slice(0, 100),
          has_tool_data: !!event.payload.tool_data,
          elapsed: event.payload.elapsed,
          session: sid,
        })
      }
      // ask_user 工具执行完毕 → 用户已回应，回到工作态
      if (ch.isAwaitingUser && event.payload.tool_name === ch._awaitingToolName) {
        ch.isAwaitingUser = false
        ch._awaitingToolName = null
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

    case 'answer': {
      const lastThink = findLastThinking(turn.events)
      if (lastThink) {
        lastThink.becameAnswer = true
        lastThink.tokens = event.payload.content
      }
      turn.finalAnswer = event.payload.content
      // Emotion → sticker matching
      if (event.payload?.content) {
        const emotion = detectEmotion(event.payload.content)
        if (emotion) {
          // Fire-and-forget: fetch a sticker for this emotion, don't block message display.
          // 必须使用 tauriFetch：Tauri WebView2 不允许从 tauri://localhost 向 http:// 发起
          // 原生 fetch，会静默失败导致 stickerUrl 永远为空。与红队 R3 #1 修复的 store bug 同模式。
          tauriFetch(getStickerUrl(emotion))
            .then((r) => {
              if (!r.ok) {
                console.warn('[useChat] sticker fetch non-ok response:', r.status)
                return null
              }
              return r.json()
            })
            .then((data) => {
              if (data?.path) {
                turn.stickerUrl = `/api/stickers/${data.path}`
              }
            })
            .catch((err) => console.warn('[useChat] sticker fetch failed:', err))
        }
      }
      break
    }

    case 'done':
      ch.isAwaitingUser = false
      ch._awaitingToolName = null
      if (event.payload.context_usage) {
        ch.contextUsage = event.payload.context_usage
      }
      // 存储后端 turn_id，用于关联后台记忆 consumer 的事件
      if (ch.currentTurn && (event.payload as Record<string, unknown>).turn_id) {
        ch.currentTurn.turnId = (event.payload as Record<string, unknown>).turn_id as string
        console.log(`[ltm-fe] turnId set on turn.id=${ch.currentTurn.id}: ${ch.currentTurn.turnId}`)
      }
      if (ch.currentTurn) {
        const turnToFinalize = ch.currentTurn
        const lastThink = findLastThinking(turnToFinalize.events)
        const trackBecame = lastThink?.becameAnswer
        console.log(`[useChat:done] 会话 ${sid}: becameAnswer=${trackBecame}, events=${turnToFinalize.events.length}, finalAnswer=${turnToFinalize.finalAnswer?.slice(0, 50) ?? 'null'}`)
        ch.turns.push(turnToFinalize)
        if (ch.currentTurn?.id === turnToFinalize.id) {
          ch.currentTurn = null
        }
        ch.isStreaming = false
        if (!ch.privateMode) {
          persistTurns(sid)
        }
        void refreshSessions()  // 轮次结束，刷新会话列表以更新 message_count
      } else {
        console.warn(`[useChat:done] 会话 ${sid} 的 done 事件到达时 currentTurn 为 null`)
        ch.isStreaming = false
      }
      // 子 Agent 完成 → 自动切回主会话
      if (ch.parentSessionId) {
        setTimeout(() => switchSession(ch.parentSessionId!), 500)
      }
      break

    case 'error':
      ch.isAwaitingUser = false
      ch._awaitingToolName = null
      ch.error = event.payload.message
      ch.errorCategory = event.payload.category ?? null
      ch.errorTraceId = event.payload.trace_id ?? null
      ch.isStreaming = false
      console.warn(`[useChat] error: ${event.payload.code} (${event.payload.category ?? 'unknown'})`, event.payload.message)
      break

    case 'pong':
      break

    case 'ask_user': {
      const ae = event as AskUserEvent
      const mode = ae.payload.mode
      ch.isAwaitingUser = true
      ch._awaitingToolName = ae.payload.tool_name
      console.log('[useChat] received ask_user event:', {
        tool_name: ae.payload.tool_name,
        question: ae.payload.question?.slice(0, 50),
        mode,
        interaction_id: ae.payload.interaction_id,
        session: sid,
      })
      let runningTool = findRunningTool(turn.events, ae.payload.tool_name)
      console.log('[useChat] findRunningTool result:', runningTool ? {
        name: runningTool.name,
        status: runningTool.status,
        has_interaction: !!runningTool.interaction,
      } : 'NOT FOUND')
      // ApprovalToolNode 场景：ask_user 事件先于 tool_start 到达（工具尚未执行，等待审批），
      // 此时 runningTool 不存在，需先创建一个 running 状态的 tool event 承载 interaction 数据，
      // 待用户批准后 ApprovalToolNode 才执行工具，后续 tool_start/tool_end 会通过 findRunningTool
      // 找到这个已存在的 event 并填充 output/elapsed。
      if (!runningTool && mode === 'approval') {
        console.log('[useChat] approval mode: runningTool 不存在，创建占位 tool event 承载 interaction')
        turn.events.push({
          kind: 'tool',
          name: ae.payload.tool_name,
          input: ae.payload.tool_input ? JSON.stringify(ae.payload.tool_input, null, 2) : '',
          output: null,
          elapsed: null,
          status: 'running',
        })
        runningTool = findRunningTool(turn.events, ae.payload.tool_name)
      }
      if (runningTool) {
        runningTool.interaction = {
          question: ae.payload.question,
          mode,
          options: ae.payload.options,
          interactionId: ae.payload.interaction_id,
          submitted: false,
          code: ae.payload.code,
          detail: ae.payload.detail,
          // 审批模式特有字段
          risk_level: mode === 'approval' ? ae.payload.risk_level : undefined,
          tool_input: mode === 'approval' ? ae.payload.tool_input : undefined,
        }
      }
      break
    }

    case 'artifact': {
      // Artifacts are only accepted by the strict store guard and only shown
      // for the active session, preventing a background session from moving
      // a user's workbench focus.
      if (sid === getSessionStore().sessionId) {
        useWorkbenchStore().addArtifact((event as ArtifactEvent).payload)
      }
      break
    }

    case 'plan_proposed': {
      const pe = event as PlanProposedEvent
      console.log('[useChat] received plan_proposed:', {
        plan_id: pe.payload.plan_id,
        steps: pe.payload.steps.length,
        session: sid,
      })
      // 将计划卡片附加到当前正在执行的 turn（不是已完成的 turn）
      const targetTurn = ch.currentTurn
      if (targetTurn) {
        targetTurn.planCard = {
          planId: pe.payload.plan_id,
          steps: pe.payload.steps,
          planText: pe.payload.plan_text,
          status: 'pending',
          currentStepIndex: -1,
          stepStatuses: {},
          failureCount: 0,
          replanCount: 0,
        }
      }
      break
    }

    case 'plan_step_start': {
      const se = event as PlanStepStartEvent
      const targetTurn = ch.currentTurn
      if (targetTurn?.planCard) {
        targetTurn.planCard.status = 'running'
        targetTurn.planCard.currentStepIndex = se.payload.step_index
        if (!targetTurn.planCard.stepStatuses) targetTurn.planCard.stepStatuses = {}
        targetTurn.planCard.stepStatuses[String(se.payload.step_index)] = 'running'
        if (se.payload.tool_hint && targetTurn.planCard.toolHints) {
          targetTurn.planCard.toolHints[String(se.payload.step_index)] = se.payload.tool_hint
        } else if (se.payload.tool_hint) {
          targetTurn.planCard.toolHints = { [String(se.payload.step_index)]: se.payload.tool_hint }
        }
      }
      break
    }

    case 'plan_step_end': {
      const se = event as PlanStepEndEvent
      const targetTurn = ch.currentTurn
      if (targetTurn?.planCard) {
        if (!targetTurn.planCard.stepStatuses) targetTurn.planCard.stepStatuses = {}
        targetTurn.planCard.stepStatuses[String(se.payload.step_index)] = se.payload.status
      }
      break
    }

    case 'plan_step_error': {
      const se = event as PlanStepErrorEvent
      const targetTurn = ch.currentTurn
      if (targetTurn?.planCard) {
        if (!targetTurn.planCard.stepStatuses) targetTurn.planCard.stepStatuses = {}
        targetTurn.planCard.stepStatuses[String(se.payload.step_index)] = 'failed'
        targetTurn.planCard.failureCount = (targetTurn.planCard.failureCount || 0) + 1
        if (se.payload.replanning) {
          targetTurn.planCard.status = 'replanning'
          targetTurn.planCard.replanCount = (targetTurn.planCard.replanCount || 0) + 1
        } else if (se.payload.skipped) {
          targetTurn.planCard.stepStatuses[String(se.payload.step_index)] = 'skipped'
        } else {
          targetTurn.planCard.status = 'failed'
        }
      }
      break
    }

    case 'plan_completed': {
      const ce = event as PlanCompletedEvent
      const targetTurn = ch.currentTurn
      if (targetTurn?.planCard) {
        targetTurn.planCard.status = 'approved'  // 保持已确认状态
        targetTurn.planCard.currentStepIndex = ce.payload.summary.total_steps
        if (ce.payload.summary.statuses) {
          targetTurn.planCard.stepStatuses = { ...ce.payload.summary.statuses }
        }
        targetTurn.planCard.failureCount = ce.payload.summary.failure_count
        targetTurn.planCard.replanCount = ce.payload.summary.replan_count
      }
      break
    }

  }
}

/** 后台记忆 consumer 事件处理（在 done 后 currentTurn=null 时也能通过 turn_id 找到目标）。 */
function handleMemoryToolEvent(ch: SessionChannel, sid: string, event: ServerEvent): void {
  if (event.type === 'memory_start') {
    const me = event as MemoryStartEvent
    console.log(`[ltm-fe] memory_start session=${sid} turn_id=${me.payload.turn_id}`)
    const targetTurn = findTurnByBackendId(ch, me.payload.turn_id)
    if (!targetTurn) { console.log(`[ltm-fe] NO turn found for ${me.payload.turn_id}`); return }
    if (!targetTurn.memoryEvents) targetTurn.memoryEvents = []
    targetTurn.memoryEvents.push({
      kind: 'memory_tool', name: 'memory_processing', input: '', output: null, elapsed: null, status: 'running',
    })
    return
  }
  if (event.type === 'memory_tool_start') {
    const me = event as MemoryToolStartEvent
    if (me.payload.tool_name === 'read_memories') return  // 纯读取不显示
    console.log(`[ltm-fe] memory_tool_start session=${sid} turn_id=${me.payload.turn_id} tool=${me.payload.tool_name}`)
    const targetTurn = findTurnByBackendId(ch, me.payload.turn_id)
    if (!targetTurn) { console.log(`[ltm-fe] NO turn found for ${me.payload.turn_id}`); return }
    targetTurn.memoryEvents?.push({
      kind: 'memory_tool', name: me.payload.tool_name, input: me.payload.input,
      output: null, elapsed: null, status: 'running',
    })
    return
  }
  if (event.type === 'memory_tool_end') {
    const me = event as MemoryToolEndEvent
    if (me.payload.tool_name === 'read_memories') return  // 纯读取不显示
    console.log(`[ltm-fe] memory_tool_end session=${sid} turn_id=${me.payload.turn_id} tool=${me.payload.tool_name}`)
    const targetTurn = findTurnByBackendId(ch, me.payload.turn_id)
    if (!targetTurn) { console.log(`[ltm-fe] NO turn`); return }
    const mt = findRunningMemoryTool(targetTurn.memoryEvents ?? [], me.payload.tool_name)
    if (mt) { mt.output = me.payload.output; mt.elapsed = me.payload.elapsed; mt.status = 'done' }
    if (ch.turns.includes(targetTurn as ChatTurn)) persistTurns(sid)
    return
  }
  if (event.type === 'memory_tool_error') {
    const me = event as MemoryToolErrorEvent
    if (me.payload.tool_name === 'read_memories') return  // 纯读取不显示
    const targetTurn = findTurnByBackendId(ch, me.payload.turn_id)
    if (!targetTurn) return
    const mt = findRunningMemoryTool(targetTurn.memoryEvents ?? [], me.payload.tool_name)
    if (mt) mt.status = 'error'
    if (ch.turns.includes(targetTurn as ChatTurn)) persistTurns(sid)
    return
  }
  if (event.type === 'memory_done') {
    const me = event as MemoryDoneEvent
    console.log(`[ltm-fe] memory_done session=${sid} turn_id=${me.payload.turn_id}`)
    const targetTurn = findTurnByBackendId(ch, me.payload.turn_id)
    if (!targetTurn) { console.log(`[ltm-fe] NO turn`); return }
    // 移除「处理中」占位条目
    const realEvents = (targetTurn.memoryEvents ?? []).filter(e => e.name !== 'memory_processing')
    targetTurn.memoryEvents = realEvents
    if (realEvents.length === 0) {
      targetTurn.memoryEvents = [{
        kind: 'memory_tool', name: 'memory_review', input: '', output: '', elapsed: null, status: 'done',
      }]
      console.log(`[ltm-fe] added memory_review`)
    }
    if (ch.turns.includes(targetTurn as ChatTurn)) persistTurns(sid)
    return
  }
}

// ── useChat composable ─────────────────────────────────────

export function useChat(sessionId: Ref<string>) {
  // 若 sessionId 为空，创建占位通道，等 watch 触发时再连接
  const activeChannelRef = ref(getOrCreateChannel(sessionId.value || '__pending__'))
  const activeChannel = computed(() => activeChannelRef.value)

  // 暴露给 ChatView 的响应式属性（指向当前 Session 通道）
  const connected = computed(() => activeChannel.value.connected)
  const isStreaming = computed(() => activeChannel.value.isStreaming)
  const turns = computed(() => activeChannel.value.turns)
  const currentTurn = computed(() => activeChannel.value.currentTurn)
  const error = computed(() => activeChannel.value.error)
  const errorCategory = computed(() => activeChannel.value.errorCategory)
  const errorTraceId = computed(() => activeChannel.value.errorTraceId)
  const contextUsage = computed(() => activeChannel.value.contextUsage)
  const taskTrackerData = computed(() => activeChannel.value.taskTrackerData)

  const privateMode = computed(() => activeChannel.value.privateMode)
  const autoApprove = computed(() => activeChannel.value.autoApprove)

  function setPrivateMode(val: boolean) {
    activeChannel.value.privateMode = val
  }

  function setAutoApprove(val: boolean) {
    activeChannel.value.autoApprove = val
    const ch = activeChannel.value
    if (ch.ws && ch.ws.readyState === WebSocket.OPEN) {
      ch.ws.send(JSON.stringify({
        type: 'update_auto_approve',
        payload: { auto_approve: val }
      }))
    }
  }

  // 从后端加载历史消息并转换为 ChatTurn[]（localStorage 无缓存时的回退方案）
  // const 会话从 YAML 文件读取，普通会话从 checkpointer 读取
  async function loadHistoryFromBackend(sid: string, ch: SessionChannel) {
    // 防御：空 sessionId 或占位符 sessionId 不加载
    if (!sid || sid === '__pending__') {
      console.log(`[useChat:loadHistory] 跳过空/占位 sessionId: "${sid}"`)
      return
    }
    try {
      const res = await api.getMessages(sid)
      if (!res.messages || res.messages.length === 0) {
        console.log(`[useChat:loadHistory] 会话 ${sid} 后端无历史消息`)
        return
      }
      // 后端返回 [{role, content}]，按 human 分组配对成 ChatTurn
      // 一轮对话 = 1 个 human + 后续所有非 human 消息（ai/tool），直到下一个 human
      // 修复：此前只看 human/ai 相邻配对，含工具调用的回复（human → ai(tool_calls) → tool → ai(final)）会丢失
      const turns: ChatTurn[] = []
      let i = 0
      while (i < res.messages.length) {
        const msg = res.messages[i]
        if (msg.role === 'human') {
          // 开始一轮新对话
          const turn: ChatTurn = {
            id: `history-${sid}-${i}`,
            userMessage: msg.content,
            refs: [],
            events: [],
            memoryEvents: [],
            finalAnswer: null,
          }
          i++
          // 收集后续所有非 human 消息（ai/tool），直到下一个 human
          const aiContents: string[] = []
          while (i < res.messages.length && res.messages[i].role !== 'human') {
            const m = res.messages[i]
            if (m.role === 'ai' && m.content) {
              // 收集非空 ai 消息内容，最后一个非空 ai 消息作为 finalAnswer
              aiContents.push(m.content)
            }
            // tool 消息跳过（历史回看不需要显示工具调用细节）
            i++
          }
          // 最后一个非空 ai 消息作为 finalAnswer
          turn.finalAnswer = aiContents.length > 0 ? aiContents[aiContents.length - 1] : null
          // 兜底：如果 finalAnswer 为空（如 agent 被取消、工具失败后图直接结束），
          // 设置占位提示，避免用户感知为"整轮对话被吞掉"
          if (!turn.finalAnswer) {
            turn.finalAnswer = '（这一轮处理未生成文字回复，请查看工具执行结果或重新提问。）'
          }
          turns.push(turn)
        } else {
          // 非 human 消息但没有前置 human（异常情况），跳过
          i++
        }
      }
      if (turns.length > 0) {
        console.log(`[useChat:loadHistory] 从后端加载会话 ${sid}: ${turns.length} 条 turn`)
        ch.turns.push(...turns)
        turnsCache.set(sid, turns)
        saveTurnsToStorage(sid, turns)
      }
    } catch (e) {
      console.warn(`[useChat:loadHistory] 加载会话 ${sid} 历史失败:`, e)
    }
  }

  // Keep at most five inactive sessions alive. Streaming and approval-waiting
  // sessions are protected so a cache eviction never cancels user-visible work.
  watch(
    sessionId,
    async (newId, oldId) => {
      console.log(`[useChat:watch] sessionId 变化: "${oldId}" → "${newId}"`)
      if (oldId) {
        console.log(`[useChat:watch] 在切换前持久化旧会话 "${oldId}"`)
        persistTurns(oldId)
      }
      const evictedSessionId = newId
        ? chatSessionAliveCache.touch(newId, { scrollTop: 0 }, (candidateId) => {
          const candidate = getChatStore().channels.get(candidateId)
          return !candidate?.isStreaming && !candidate?.isAwaitingUser
        })
        : null
      if (evictedSessionId) {
        persistTurns(evictedSessionId)
        disconnectSession(evictedSessionId)
      }
      activeChannelRef.value = getOrCreateChannel(newId)
      ensureConnected(newId)
      // 恢复新会话的消息缓存（页面刷新场景）
      const cached = turnsCache.get(newId)
      const ch = getOrCreateChannel(newId)
      if (cached) {
        console.log(`[useChat:watch] 找到会话 ${newId} 的缓存: ${cached.length} 条 turn, 通道已有 ${ch.turns.length} 条`)
        if (ch.turns.length === 0) {
          console.log(`[useChat:watch] 恢复缓存: 将 ${cached.length} 条 turn 推入通道`)
          ch.turns.push(...cached)
          console.log(`[useChat:watch] 恢复后通道 turns.length = ${ch.turns.length}`)
        } else {
          console.log(`[useChat:watch] 跳过恢复: 通道已有数据`)
        }
      } else {
        console.log(`[useChat:watch] 未找到会话 ${newId} 的缓存, sessionId="${sessionId.value}"`)
        const available = Array.from(turnsCache.keys())
        console.log(`[useChat:watch] turnsCache 可用键:`, available.length ? available : '(空)')
        // 回退：从后端加载历史消息（const 会话从 YAML，普通会话从 checkpointer）
        // 修复：此前前端从未调用 /sessions/{id}/messages，导致 localStorage 无缓存时
        // 旧会话点击后无历史显示
        if (ch.turns.length === 0) {
          await loadHistoryFromBackend(newId, ch)
        }
      }
    },
    { immediate: true }
  )

  onUnmounted(() => {
    // 组件真正卸载时（非 keep-alive deactivated）断开当前会话的 WS。
    // 注意：keep-alive 场景下切换路由触发的是 onDeactivated 而非 onUnmounted，
    // 所以 ChatView 被 keep-alive 缓存时，WS 不会被关闭，流式回复可以继续。
    // 只断开当前会话的 WS，而非全部，避免影响到 keep-alive 缓存的其他会话。
    const sid = sessionId.value
    if (sid) {
      disconnectSession(sid)
    }
    // 清理子会话孤儿 WS（sub_session_created 创建的）
    for (const childId of _childSessionIds) {
      if (childId !== sid) {
        disconnectSession(childId)
      }
    }
    _childSessionIds.clear()
    chatSessionAliveCache.clear()
    // 组件卸载时释放内存中的 turns 缓存（localStorage 中的持久化数据保留）
    turnsCache.clear()
  })

  function send(text: string, refs: ParsedRef[] = [], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId): boolean {
    const ch = activeChannel.value
    if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[useChat:send] WebSocket 未就绪, readyState=${ch.ws?.readyState}, session=${sessionId.value}`)
      return false
    }
    ch.isStreaming = true
    ch.error = null

    const timestamp = buildTimestamp()
    const flatMsg = buildFlatMessage(text, timestamp, refs)

    const turn: ChatTurn = {
      id: generateUUID(),
      userMessage: text,
      refs,
      events: [],
      memoryEvents: [],
      finalAnswer: null,
    }
    ch.currentTurn = turn

    const cs = getChatStore()
    const payload: ClientMessage = {
      type: 'chat',
      payload: {
        message: flatMsg,
        private: ch.privateMode,
        auto_approve: ch.autoApprove,
        provider_id: providerId,
        model_name: modelName,
        temperature: cs.temperature,
        max_tokens: cs.maxTokens,
        ...(thinkPathId ? { think_path_id: thinkPathId } : {}),
      },
    }
    ch.ws.send(JSON.stringify(payload))
    return true
  }

  function cancel() {
    const ch = activeChannel.value
    if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return
    const payload: ClientMessage = { type: 'cancel', payload: {} }
    ch.ws.send(JSON.stringify(payload))
  }

  function sendUserResponse(interactionId: string, response: string | string[]) {
    const ch = activeChannel.value
    if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return
    const payload: ClientMessage = {
      type: 'user_response',
      payload: { interaction_id: interactionId, response },
    }
    ch.ws.send(JSON.stringify(payload))
  }

  function sendArtifactAction(artifactId: string, actionId: string, token: string): boolean {
    const ch = activeChannel.value
    if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return false
    const payload: ClientMessage = {
      type: 'artifact_action',
      payload: { artifact_id: artifactId, action_id: actionId, token },
    }
    ch.ws.send(JSON.stringify(payload))
    return true
  }

  function sendPlanResponse(planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string) {
    const ch = activeChannel.value
    if (!ch.ws || ch.ws.readyState !== WebSocket.OPEN) return
    // 更新 planCard 状态 — 必须用 currentTurn（plan_proposed 也写在这里）
    const currentTurn = ch.currentTurn
    if (currentTurn?.planCard && currentTurn.planCard.planId === planId) {
      currentTurn.planCard.status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'modified'
    }
    const msg: Record<string, unknown> = {
      type: 'plan_response',
      payload: { plan_id: planId, action },
    }
    if (modifiedPlan) {
      (msg.payload as Record<string, unknown>).modified_plan = modifiedPlan
    }
    ch.ws.send(JSON.stringify(msg))
  }

  /** 从当前会话的 turns 列表中移除最后 count 条轮次（撤回后的前端同步）。 */
  function removeTurns(count: number) {
    const ch = getOrCreateChannel(sessionId.value)
    if (ch.turns.length === 0) return
    const actual = Math.min(count, ch.turns.length)
    ch.turns.splice(ch.turns.length - actual, actual)
    if (!ch.privateMode) {
      persistTurns(sessionId.value)
    }
    void refreshSessions()
  }

  return {
    connected, isStreaming, turns, currentTurn, error, errorCategory, errorTraceId,
    contextUsage, taskTrackerData,
    send, cancel, sendUserResponse, sendArtifactAction, sendPlanResponse, removeTurns,
    privateMode, setPrivateMode,
    autoApprove, setAutoApprove,
  }
}



function findLastThinking(events: TurnEvent[]): ThinkingBlock | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'thinking') {
      return events[i] as ThinkingBlock
    }
  }
  return undefined
}

function findRunningTool(events: TurnEvent[], toolName: string): ToolCall | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'tool' && e.name === toolName && e.status === 'running') {
      return e as ToolCall
    }
  }
  return undefined
}

/** 通过后端 turn_id 查找 turn（先在 currentTurn 中找，再在 turns 中找）。 */
function findTurnByBackendId(ch: SessionChannel, turnId: string): ChatTurn | undefined {
  if (ch.currentTurn?.turnId === turnId) return ch.currentTurn
  return ch.turns.find(t => t.turnId === turnId)
}

/** 在 memoryEvents 中查找指定工具名的 running 状态事件。 */
function findRunningMemoryTool(events: MemoryToolEvent[], toolName: string): MemoryToolEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.name === toolName && e.status === 'running') return e
  }
  return undefined
}
