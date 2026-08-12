<template>
  <div ref="rootRef" class="chat-view">
    <!-- 后端不可用：provider 加载失败 -->
    <div v-if="providerLoadFailed" class="no-provider-overlay">
      <div class="no-provider-card">
        <div class="no-provider-icon no-provider-icon--warn" v-html="warningIconSvg"></div>
        <h3>无法加载模型配置</h3>
        <p>后端服务可能未就绪，请稍后重试。</p>
        <button class="btn primary" :disabled="providerRetrying" @click="retryLoadProviders">
          {{ providerRetrying ? '重试中...' : '重试' }}
        </button>
      </div>
    </div>
    <!-- 无提供商引导卡片 -->
    <div v-else-if="!hasProviders" class="no-provider-overlay">
      <div class="no-provider-card no-provider-card--enhanced">
        <div class="no-provider-icon no-provider-icon--gear" v-html="gearIconSvg"></div>
        <h3>开始使用 Maxma</h3>
        <p class="no-provider-lead">Maxma 通过「模型提供商」连接到 AI 大模型。只需填一次 API Key，就能开始对话。</p>

        <!-- 快速上手 3 步引导（面向 Novice 画像） -->
        <ol class="no-provider-steps">
          <li>
            <span class="step-no">1</span>
            <span class="step-text">点击下方按钮进入「模型 MODELS」设置页</span>
          </li>
          <li>
            <span class="step-no">2</span>
            <span class="step-text">选择一个提供商（推荐 DeepSeek 性价比高、Qwen 国内免费额度、OpenAI 体验最佳）</span>
          </li>
          <li>
            <span class="step-no">3</span>
            <span class="step-text">填入 API Key 并保存，回到此页即可开始对话</span>
          </li>
        </ol>

        <div class="no-provider-actions">
          <router-link to="/providers" class="btn primary">前往模型设置</router-link>
          <router-link to="/help" class="btn">了解更多</router-link>
        </div>

        <p class="no-provider-note">
          <span aria-hidden="true">💡</span> 不知道选哪个？DeepSeek 注册即送免费额度，OpenAI 兼容 API 都能直接接入。
        </p>
      </div>
    </div>
    <!-- 正常聊天界面 -->
    <template v-else>
    <ChatHeader>
      <template #extra>
        <StatusBadge :connected="connected" :health="health" />
        <button
          class="workbench-toggle-btn"
          :class="{ active: workbench.isOpen }"
          type="button"
          aria-label="工作台"
          :aria-expanded="workbench.isOpen"
          @click="workbench.toggle()"
          title="工作台"
        >
          <span aria-hidden="true">&#9776;</span>
        </button>
        <GlowBorder :blur="6" :duration="3">
          <div class="session-more-menu">
          <button
            ref="moreMenuTrigger"
            class="session-more-trigger"
            type="button"
            aria-label="更多会话操作"
            aria-controls="session-actions-menu"
            :aria-expanded="moreMenuOpen"
            @click="moreMenuOpen = !moreMenuOpen"
          >
            <span aria-hidden="true">···</span>
          </button>
          <div v-if="moreMenuOpen" ref="actionsMenuRef" id="session-actions-menu" class="session-actions-menu" role="menu" aria-label="更多会话操作">
            <div class="session-actions-heading">会话设置</div>
            <!-- GAP-CMD-001：进阶操作统一收敛到斜杠命令（输入 / 查看面板）。
                 私密/自动执行/计划模式/检查点/目标模式入口已由 /private /auto
                 /plan /checkpoint /goal 接管——单一入口降低学习成本。 -->
            <p class="session-action-hint session-action-hint--cmd">💡 输入 <code>/</code> 查看全部命令（如 /goal 完成周报、/plan、/undo）</p>
            <!-- GAP-B1-001：目标状态只读展示（操作统一走 /goal 命令） -->
            <GoalStatusLine v-if="goalState?.goal" :goal="goalState.goal" />
            <!-- MODEL-PARAMS-001：模型参数（输出上限/思考开关）挂载入口——
                 此前 ModelSettingsPanel 从未挂载，max_tokens 后端支持但 UI 孤儿 -->
            <button class="session-action" type="button" role="menuitem" @click="modelSettingsOpen = !modelSettingsOpen">
              <span>模型参数</span>
              <span class="session-action-state">{{ modelSettingsOpen ? '收起' : '展开' }}</span>
            </button>
            <ModelSettingsPanel v-if="modelSettingsOpen" class="session-model-settings" />
            <div v-if="taskTrackerData" class="session-task-status" role="status" aria-label="任务状态">
              <div class="session-task-heading">任务状态</div>
              <TaskTrackerBar :data="taskTrackerData as unknown as TaskTrackerData" />
            </div>
            <SessionPermissionModeControl :session-id="sessionId" />
          </div>
          </div>
        </GlowBorder>
      </template>
    </ChatHeader>

    <div class="chat-workbench-layout">
      <div class="chat-main-column">
        <template v-if="hasMessages">
          <CardSpotlight class="chat-window-host">
            <ChatWindow
            :session-id="sessionId"
            :turns="turns"
            :current-turn="currentTurn"
            :connected="connected"
            :error="error"
            :error-category="errorCategory"
            :error-trace-id="errorTraceId"
            @action="handleToolAction"
            @cite="addCitation"
            @toggle-private="setPrivateMode(!privateMode)"
            @plan-respond="sendPlanResponse"
            @pin="handlePin"
            @retry="handleRetryLast"
            @dismiss-error="dismissError"
          />
        </CardSpotlight>
        </template>
        <WelcomeScreen v-else @start="handleQuickStart" />

        <ChatInput
          v-if="!isSubagent"
          ref="chatInputRef"
        />
        <div v-else class="sub-agent-readonly-bar">
          <span class="sub-agent-readonly-text"><span aria-hidden="true">🔒</span> 子 Agent 会话 — 只读</span>
        </div>
      </div>

      <WorkbenchPanel
        :is-open="workbench.isOpen"
        :active-tab="workbench.activeTab"
        :card-count="workbench.cards.length"
        @close="workbench.close()"
        @set-tab="workbench.setTab"
      >
        <template #reasoning>
          <ReasoningTimeline :turns="allTurns" />
        </template>
        <template #canvas>
          <CanvasContainer
            :cards="workbench.cards"
            @remove="workbench.removeCard"
            @artifact-action="handleArtifactAction"
          />
        </template>
      </WorkbenchPanel>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'ChatView' })
import { api } from '@/api'
import ChatInput from '@/components/ChatInput.vue'
import ModelSettingsPanel from '@/components/ModelSettingsPanel.vue'
import ChatWindow from '@/components/ChatWindow.vue'
import SessionPermissionModeControl from '@/components/SessionPermissionModeControl.vue'
import GoalStatusLine from '@/components/GoalStatusLine.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import TaskTrackerBar, { type TaskTrackerData } from '@/components/TaskTrackerBar.vue'
import WorkbenchPanel from '@/components/workbench/WorkbenchPanel.vue'
import ReasoningTimeline from '@/components/workbench/ReasoningTimeline.vue'
import CanvasContainer from '@/components/workbench/CanvasContainer.vue'
import WelcomeScreen from '@/components/WelcomeScreen.vue'
import ChatHeader from '@/components/ChatHeader.vue'
import warningIconRaw from '@/assets/icons/status/warning.svg?raw'
import gearIconRaw from '@/assets/icons/status/gear.svg?raw'
import { useChat } from '@/composables/useChat'
import { useSelectionQuote } from '@/composables/useSelectionQuote'
import { provideChatInput } from '@/composables/useChatInput'
import { invalidateTurnsCache } from '@/composables/useChat'
import { provideSlashCommands } from '@/composables/useSlashCommandsProvide'
import { SLASH_COMMANDS } from '@/composables/useSlashCommands'
import { useWorkbenchStore } from '@/stores/workbench'
import { useHealthStore } from '@/stores/health'
import { useProviderStore } from '@/stores/provider'
import { useSessionStore } from '@/stores/session'
import { usePersonaStore } from '@/stores/persona'
import { useChatStore } from '@/stores/chat'
import type { ParsedRef, SelectionRef } from '@/utils/references'
import type { ThinkPathId } from '@/utils/thinkPath'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
import { createLogger } from '@/utils/logger'
import { safeGetItem, safeSetItem } from '@/lib/storage'
import CardSpotlight from '@/components/inspira/CardSpotlight.vue'
import GlowBorder from '@/components/inspira/GlowBorder.vue'
import { showError } from '@/lib/toast'

const log = createLogger('ChatView')

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { health } = storeToRefs(useHealthStore())
const {
  connected, isStreaming, turns, currentTurn, error, errorCategory, errorTraceId,
  taskTrackerData, send, cancel, sendUserResponse, sendArtifactAction, sendPlanResponse, sendPlanMode, sendCheckpointAction, removeTurns,
  dismissError,
  privateMode, setPrivateMode, autoApprove, setAutoApprove,
  reconnectExhausted, reconnect,
  goalState, sendGoalAction,
} = useChat(sessionId)

const workbench = useWorkbenchStore()
const moreMenuOpen = ref(false)
const moreMenuTrigger = ref<HTMLButtonElement | null>(null)
const actionsMenuRef = ref<HTMLElement | null>(null)

const hasMessages = computed(() => turns.value.length > 0 || currentTurn.value)

// 状态图标 SVG（剥掉 <?xml?> 声明，与 Icon.vue 处理方式一致）
const warningIconSvg = computed(() => warningIconRaw.replace(/<\?xml[^>]*\?>/, '').trim())
const gearIconSvg = computed(() => gearIconRaw.replace(/<\?xml[^>]*\?>/, '').trim())

const allTurns = computed(() => {
  const result = [...turns.value]
  if (currentTurn.value) {
    result.push(currentTurn.value)
  }
  return result
})

const {
  quoteCandidate,
  quotedSelections,
  commitCandidate,
  removeQuote,
  clearQuotes,
  resetQuotesForSessionSwitch,
} = useSelectionQuote()

// QUOTE-STALE-001：会话切换时清空选区引用，避免 A 会话的引用附带进 B 会话
watch(() => sessionId, () => {
  resetQuotesForSessionSwitch()
})

// 服务端 think_path 能力开关（包成 ref 以便传入 useChatInput）
const thinkPathEnabled = computed(() => health.value?.think_path_enabled === true)

// 持久化 provider/model 选择到 localStorage，刷新后恢复
const SELECTED_PROVIDER_KEY = 'maxma_selected_provider'
const SELECTED_MODEL_KEY = 'maxma_selected_model'
// COMPAT-STORAGE-001：setup 期读取也用安全包装（隐私模式/禁用存储不崩溃）
const selectedProviderId = ref(safeGetItem(SELECTED_PROVIDER_KEY) || '')
const selectedModelName = ref(safeGetItem(SELECTED_MODEL_KEY) || '')

const providerStore = useProviderStore()
const { hasProviders } = storeToRefs(providerStore)
const chatStore = useChatStore()
// ANIM-PAUSE-001：keep-alive 暂停用根元素 ref
const rootRef = ref<HTMLElement | null>(null)
// MODEL-PARAMS-001：会话菜单内模型参数面板展开状态
const modelSettingsOpen = ref(false)

// 后端不可用时的加载失败状态（区分"后端不可用"和"真的无 provider"）
const providerLoadFailed = ref(false)
const providerRetrying = ref(false)

async function loadProvidersWithStatus() {
  await providerStore.loadProviders()
  // loadProviders 内部 catch 了错误，不会抛出
  // 通过 loaded 标志判断是否成功加载过至少一次
  providerLoadFailed.value = !providerStore.loaded && providerStore.allProviders.length === 0
}

async function retryLoadProviders() {
  if (providerRetrying.value) return
  providerRetrying.value = true
  try {
    await loadProvidersWithStatus()
    // 修复 STATE-RECOVERY-001：重试成功后刷新模型列表——此前只重载 provider，
    // availableModels 仍为空 → 模型选择器为空、发送按钮永久禁用（noProvider），
    // 错误卡片消失但聊天仍不可用，只能整页刷新恢复
    await chatStore.fetchAvailableModels()
  } finally {
    providerRetrying.value = false
  }
}

const personaStore = usePersonaStore()

onMounted(async () => {
  personaStore.fetchProfile()
  // 通过全局 store 加载 provider 列表（含重试），消除 ChatView/ChatInput 状态不一致
  await loadProvidersWithStatus()
  // 加载完 providers 后立即获取可用模型列表，填充模型选择器
  await chatStore.fetchAvailableModels()
})

function closeMoreMenu() {
  if (!moreMenuOpen.value) return
  moreMenuOpen.value = false
  moreMenuTrigger.value?.focus()
}

function getMenuItems(): HTMLElement[] {
  if (!actionsMenuRef.value) return []
  return Array.from(actionsMenuRef.value.querySelectorAll('[role="menuitem"]'))
    .filter(el => !el.hasAttribute('disabled')) as HTMLElement[]
}

function focusFirstMenuItem() {
  nextTick(() => {
    const items = getMenuItems()
    items[0]?.focus()
  })
}

function moveMenuFocus(direction: 'next' | 'prev' | 'first' | 'last') {
  const items = getMenuItems()
  if (!items.length) return
  const active = document.activeElement
  let idx = items.findIndex(el => el === active)
  if (idx < 0) idx = 0
  let nextIdx = idx
  if (direction === 'next') {
    nextIdx = (idx + 1) % items.length
  } else if (direction === 'prev') {
    nextIdx = (idx - 1 + items.length) % items.length
  } else if (direction === 'first') {
    nextIdx = 0
  } else if (direction === 'last') {
    nextIdx = items.length - 1
  }
  items[nextIdx].focus()
}

watch(moreMenuOpen, open => {
  if (open) focusFirstMenuItem()
})

function handleMoreMenuPointerdown(event: PointerEvent) {
  const target = event.target
  if (target instanceof Element && !target.closest('.session-more-menu')) closeMoreMenu()
}

function handleMoreMenuKeydown(event: KeyboardEvent) {
  if (!moreMenuOpen.value) return

  if (event.key === 'Escape') {
    event.stopPropagation()
    closeMoreMenu()
    return
  }

  if (!actionsMenuRef.value?.contains(event.target as Node)) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveMenuFocus('next')
      break
    case 'ArrowUp':
      event.preventDefault()
      moveMenuFocus('prev')
      break
    case 'Home':
      event.preventDefault()
      moveMenuFocus('first')
      break
    case 'End':
      event.preventDefault()
      moveMenuFocus('last')
      break
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleMoreMenuPointerdown)
  document.addEventListener('keydown', handleMoreMenuKeydown)
})

// ANIM-PAUSE-001：keep-alive 缓存时暂停 ChatView 子树全部 CSS 动画——
// 导航离开后缓存的欢迎屏动画（Sparkles/Ripple/TextGlitch 等）此前以
// 60fps 继续在不可见页面运行。deactivated 加暂停类，activated 恢复。
onActivated(() => {
  rootRef.value?.classList.remove('view-paused')
  // 恢复 JS 动画（SingularityBackground 等挂载在子树内，由各自组件处理）
  window.dispatchEvent(new CustomEvent('maxma:chat-view-active', { detail: { active: true } }))
})
onDeactivated(() => {
  rootRef.value?.classList.add('view-paused')
  window.dispatchEvent(new CustomEvent('maxma:chat-view-active', { detail: { active: false } }))
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleMoreMenuPointerdown)
  document.removeEventListener('keydown', handleMoreMenuKeydown)
})

// GAP-CMD-001：计划模式状态（会话级，/plan 命令切换）。仅前端状态 + WS
// 下发，刷新后回到默认关闭态（sidecar 会话的 plan 状态与 UI 一致重建）。
const planModeOn = ref(false)

// Ctrl+K 切换私密模式
useGlobalShortcut({ key: 'k', mod: true }, () => { setPrivateMode(!privateMode.value) })

// UX-SHORTCUT-001：Esc 停止生成（桌面应用最常用快捷键之一）。
// 仅在流式输出中生效，避免误触导致输入框等组件行为异常。
useGlobalShortcut({ key: 'Escape' }, () => {
  if (isStreaming.value) {
    cancel()
  }
})

// UX-SHORTCUT-001：Ctrl/Cmd+L 聚焦输入框（App.vue 派发 maxma:focus-input）
useGlobalShortcut({ key: 'l', mod: true, allowInEditable: true }, () => {
  chatInputRef.value?.focusInput?.()
})

function onModelChange(providerId: string, modelName: string) {
  selectedProviderId.value = providerId
  selectedModelName.value = modelName
  // 持久化到 localStorage，刷新后可恢复（存储不可用时静默降级）
  safeSetItem(SELECTED_PROVIDER_KEY, providerId)
  safeSetItem(SELECTED_MODEL_KEY, modelName)
}

// ── ChatInput 状态收敛：创建 useChatInput 实例并 provide 给 ChatInput ──
// 保留实例引用，便于 handleQuickStart 复用 ChatInput 的 providerId/modelName 状态
const chatInputInstance = provideChatInput({
  isStreaming,
  // 修复 NO-PROVIDER-GUARD-001：无可用模型时键盘 Enter 也不可发送
  // （此前 canSend 只看 WS 连接，按钮禁用但 Enter 仍能发出无效轮次）
  canSend: computed(() => connected.value && chatStore.availableModels.length > 0),
  initialProviderId: selectedProviderId,
  initialModelName: selectedModelName,
  thinkPathEnabled,
  quotedSelections,
  quoteCandidate,
  onSend,
  // 修复 CANCEL-FEEDBACK-001：停止失败（WS 断开）时提示用户
  onStop: () => {
    if (!cancel()) {
      window.dispatchEvent(new CustomEvent('maxma:error', {
        detail: { message: '连接已断开，无法停止当前任务' },
      }))
    }
  },
  onModelChange,
  onCommitQuote: commitCandidate,
  onRemoveQuote: removeQuote,
  reconnectExhausted,
  onReconnect: reconnect,
})

const isSubagent = computed(() => {
  return sessions.value.some(
    s => s.session_id === sessionId.value && s.is_subagent
  )
})

// ── 斜杠命令执行器（GAP-CMD-001） ──
// 统一命令体系 → 既有 handler 分发。ChatInput 的 / 命令面板通过
// provide/inject 调用本执行器，返回用户可见反馈文案。
const slashCommandRunner = {
  run: async (name: string, args: string): Promise<string | void> => {
    const sid = sessionId.value
    const ch = chatStore.channels.get(sid)
    switch (name) {
      case 'help': {
        const lines = ['可用斜杠命令：']
        for (const c of SLASH_COMMANDS) {
          lines.push(`· ${c.usage ?? '/' + c.name} — ${c.description}`)
        }
        if (ch) {
          ch.turns.push({
            id: `slash-help-${Date.now()}`,
            userMessage: '',
            refs: [],
            events: [{ kind: 'system', detail: 'slash_help', content: lines.join('\n'), timestamp: Date.now() }],
            memoryEvents: [],
            finalAnswer: null,
          })
        }
        return
      }
      case 'plan': {
        const next = !planModeOn.value
        if (!sendPlanMode(next)) return '计划模式切换失败：连接未就绪'
        planModeOn.value = next
        return next ? '已开启计划模式：Agent 将先规划后执行' : '已关闭计划模式'
      }
      case 'goal': {
        const sub = args.split(/\s+/)[0]?.toLowerCase()
        if (sub === 'pause' || sub === 'resume' || sub === 'drop') {
          if (!sendGoalAction(sub)) return '目标操作失败：连接未就绪'
          return sub === 'pause' ? '目标已暂停' : sub === 'resume' ? '目标已恢复' : '目标已放弃'
        }
        if (!args) return '用法：/goal <目标>（或 /goal pause|resume|drop）'
        if (!sendGoalAction('set', args)) return '目标设置失败：连接未就绪'
        return '目标已设定，Agent 将朝目标推进'
      }
      case 'checkpoint': {
        const action = args.trim().toLowerCase() === 'restore' ? 'restore' : 'save'
        if (!sendCheckpointAction(action)) return '请求失败：连接未就绪'
        return action === 'save' ? '已请求创建检查点，将在下一轮执行' : '已请求回到最近检查点，将在下一轮执行'
      }
      case 'undo': {
        if (isStreaming.value) return '正在生成回复，请等待完成后撤回'
        try {
          const result = await api.undoMessages(sid, 1)
          if ((result.deleted_count ?? 0) > 0) {
            removeTurns(1)
            return '已撤回上一轮'
          }
          return '没有可撤回的对话'
        } catch (e) {
          return '撤回失败：' + (e instanceof Error ? e.message : String(e))
        }
      }
      case 'retry': {
        handleRetryLast()
        return
      }
      case 'compact': {
        try {
          const result = await api.compactSession(sid, 20)
          return result.removed_count > 0
            ? `上下文已压缩：移除 ${result.removed_count} 条消息`
            : '上下文无需压缩'
        } catch (e) {
          return '压缩失败：' + (e instanceof Error ? e.message : String(e))
        }
      }
      case 'clear': {
        try {
          await api.clearSessionMessages(sid)
        } catch (e) {
          return '清空失败：' + (e instanceof Error ? e.message : String(e))
        }
        const target = chatStore.channels.get(sid)
        if (target) {
          target.turns.splice(0, target.turns.length)
          target.currentTurn = null
          target.error = null
          target.errorCategory = null
        }
        chatStore.removeTurnsFromStorage(sid)
        invalidateTurnsCache(sid)
        return '会话已清空'
      }
      case 'private': {
        const next = !privateMode.value
        setPrivateMode(next)
        return next ? '已开启私密模式' : '已关闭私密模式'
      }
      case 'auto': {
        const next = !autoApprove.value
        setAutoApprove(next)
        return next ? '已开启自动执行' : '已切换为逐次确认'
      }
      default:
        return `未知命令：/${name}（输入 /help 查看全部命令）`
    }
  },
}
provideSlashCommands(slashCommandRunner)

const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

function addCitation(ref: ParsedRef) {
  chatInputRef.value?.addRef(ref)
}

function onSend(text: string, refs: ParsedRef[], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId, clientMsgId?: string): boolean {
  // 将选区引用作为 refs 的一部分传给后端
    const quoteRefs: SelectionRef[] = quotedSelections.value.map(q => ({
      type: 'selection',
      label: q.source,
      preview: q.text,
    }))
  // IDEMPOTENCY-001：clientMsgId 透传（重试复用同一幂等 id）
  const sent = send(text, [...refs, ...quoteRefs], providerId, modelName, thinkPathId, clientMsgId)
  // 修复 SEND-FAIL-QUOTES-001：发送失败（WS 断开）时保留选区引用，
  // 用户重连后可直接重发，无需重新选择
  if (sent) clearQuotes()
  return sent
}

/** 持久化 interaction.submitted（ASK-REPEAT-001），跨组件生命周期有效 */
function markInteractionSubmitted(interactionId: string) {
  if (!interactionId) return
  for (const ch of chatStore.channels.values()) {
    for (const turn of [ch.currentTurn, ...ch.turns].filter(Boolean)) {
      if (!turn) continue
      for (const ev of turn.events) {
        if (ev.kind === 'tool' && ev.interaction?.interactionId === interactionId) {
          ev.interaction.submitted = true
        }
      }
    }
  }
}

/** 持久化 interaction.responded（APPROVAL-OPTIMISM-001），审批气泡恢复态 */
function markInteractionResponded(interactionId: string, responded: 'yes' | 'no') {
  if (!interactionId) return
  for (const ch of chatStore.channels.values()) {
    for (const turn of [ch.currentTurn, ...ch.turns].filter(Boolean)) {
      if (!turn) continue
      for (const ev of turn.events) {
        if (ev.kind === 'tool' && ev.interaction?.interactionId === interactionId) {
          ev.interaction.responded = responded
        }
      }
    }
  }
}

function handleToolAction(payload: { action: string; data?: unknown }) {
  if (payload.action === 'user_response') {    const d = payload.data as { interactionId: string; response: string | string[] }
    // 修复 APPROVAL-LOSS-001：WS 断开时发送失败 → 不置 responded 乐观状态，
    // 审批气泡保持可操作，用户重连后可重试
    const ok = sendUserResponse(d.interactionId, d.response)
    if (!ok) {
      log.warn(`审批响应发送失败（WS 未就绪），保持待审批状态 interaction=${d.interactionId}`)
    } else {
      // 持久化 submitted（ASK-REPEAT-001）：AskUserBubble 滚动重建后
      // 本地 submitted 丢失，靠 interaction.submitted 恢复"已提交"态
      markInteractionSubmitted(d.interactionId)
      // 修复 APPROVAL-OPTIMISM-001：审批（yes/no）响应成功时同时持久化
      // responded——ApprovalBubble 不再独立发 set_responded，滚动重建后
      // 靠 interaction.responded 恢复"已批准/已拒绝"态（不重复提交）
      const resp = Array.isArray(d.response) ? d.response[0] : d.response
      if (resp === 'yes' || resp === 'no') {
        markInteractionResponded(d.interactionId, resp)
      }
    }
  } else if (payload.action === 'set_ask_submitted') {
    const d = payload.data as { interactionId: string }
    markInteractionSubmitted(d.interactionId)
  } else if (payload.action === 'set_responded') {
    const d = payload.data as { interactionId: string; responded: 'yes' | 'no' }
    // 持久化审批响应到 interaction 数据中（跨 DynamicScroller 生命周期）
    for (const ch of chatStore.channels.values()) {
      for (const turn of [ch.currentTurn, ...ch.turns].filter(Boolean)) {
        if (!turn) continue
        for (const ev of turn.events) {
          if (ev.kind === 'tool' && ev.interaction?.interactionId === d.interactionId) {
            ev.interaction.responded = d.responded
          }
        }
      }
    }
  } else if (payload.action === 'undo') {
    handleUndo()
  } else if (payload.action === 'regenerate') {
    handleRegenerate(payload.data as { index: number })
  }
}

// ── 重新生成（UX-REGEN-001） ──
// assistant 回复右键"重新生成"：撤回该轮及之后所有轮（后端 undo N 轮），
// 再以同一用户消息重发（新 client_msg_id，幂等不冲突）。与 ChatGPT 的
// 重新生成行为一致：后续对话一并丢弃。
let _regenInFlight = false
async function handleRegenerate(data: { index: number }) {
  if (_regenInFlight || _undoInFlight) return
  if (isStreaming.value) {
    showError('正在生成回复，请等待本轮完成后重试')
    return
  }
  const ch = chatStore.channels.get(sessionId.value)
  if (!ch) return
  const index = typeof data?.index === 'number' ? data.index : -1
  if (index < 0 || index >= ch.turns.length) return
  const message = ch.turns[index].userMessage
  if (!message) return

  const roundsToRemove = ch.turns.length - index
  if (roundsToRemove > 100) {
    showError('对话过长，无法重新生成该轮（最多撤回 100 轮）')
    return
  }
  _regenInFlight = true
  try {
    const result = await api.undoMessages(sessionId.value, roundsToRemove)
    if (result.deleted_count > 0) {
      removeTurns(roundsToRemove)
    } else {
      showError('重新生成失败：无法撤回该轮对话')
      return
    }
  } catch (e) {
    log.error('重新生成-撤回失败:', e)
    showError('重新生成失败: ' + (e instanceof Error ? e.message : String(e)))
    return
  } finally {
    _regenInFlight = false
  }
  // 撤回成功后重发同一用户消息（走 ChatInput 实例，保持当前选中的模型）
  const ok = chatInputInstance.send(message)
  if (!ok) {
    showError('暂时无法发送，请等待连接完成后再试')
  }
}

// ── 错误横幅重试（AG-RETRY-001 / UX-ERROR-ACTION-001） ──
// 失败轮次（后端错误/超时/连接中断）后重发最后一条用户消息。走 ChatInput
// 实例发送会生成新 client_msg_id，不与失败轮次冲突。
function handleRetryLast() {
  if (isStreaming.value) {
    showError('正在生成回复，请等待完成后重试')
    return
  }
  const ch = chatStore.channels.get(sessionId.value)
  const last = ch?.turns[ch.turns.length - 1]
  const message = last?.userMessage
  if (!message) {
    showError('没有可重试的消息')
    return
  }
  const ok = chatInputInstance.send(message)
  if (!ok) {
    showError('暂时无法发送，请等待连接完成后再试')
  }
}

function handlePin(payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }) {
  workbench.addCard(payload)
}

function handleArtifactAction(payload: { artifactId: string; actionId: string; token: string }) {
  if (sendArtifactAction(payload.artifactId, payload.actionId, payload.token)) {
    workbench.markArtifactActionSubmitted(payload.artifactId, payload.actionId)
  }
}

let _undoInFlight = false
async function handleUndo() {
  // 修复 UNDO-DEDUP-001：撤回连点防重（键盘连按 Enter 会连续触发）
  if (_undoInFlight) return
  // UNDO-BUSY-001：流式输出中禁止撤回——后端 undo 从消息列表末尾切轮，
  // 会把 in-flight 轮次的未完成消息一并切掉，运行中回复与上下文不一致；
  // 后端 undo 端点同样有 409 守卫，这里提前拦截并提示。
  if (isStreaming.value) {
    window.dispatchEvent(new CustomEvent('maxma:error', {
      detail: { message: '正在生成回复，请等待本轮完成后撤回' },
    }))
    return
  }
  _undoInFlight = true
  try {
    const result = await api.undoMessages(sessionId.value, 1)
    if (result.deleted_count > 0) {
      removeTurns(1)
    } else {
      // UX-FEEDBACK-001：撤回 0 条（无更多可撤）给出提示，而非静默无反应
      showError('没有可撤回的消息')
    }
  } catch (e) {
    log.error('撤回失败:', e)
    // UX-FEEDBACK-001：失败必须可见（此前仅 log，用户点撤回毫无反应）
    showError('撤回失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    _undoInFlight = false
  }
}

function handleQuickStart(message: string) {
  // 通过 ChatInput 实例的 send 方法发送，确保使用 ChatInput 当前选中的 provider/model，
  // 而非直接调用 onSend（会丢失用户在 ModelSelector 中的选择）
  // 修复 QUICKSTART-FEEDBACK-001：发送失败（WS 未就绪/流式中）给出可见提示，
  // 此前静默丢弃且错误横幅无处显示（空态时 ChatWindow 不渲染）
  const ok = chatInputInstance.send(message)
  if (!ok) {
    window.dispatchEvent(new CustomEvent('maxma:error', {
      detail: { message: '暂时无法发送，请等待连接完成后再试' },
    }))
  }
}
</script>

<style scoped>
.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.sub-agent-readonly-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 24px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.sub-agent-readonly-text {
  font-size: 0.8em;
  color: var(--text-secondary);
}

/* ── 无提供商引导 ── */
.no-provider-overlay {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.no-provider-card {
  text-align: center;
  max-width: 400px;
  padding: 40px 32px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-sm);
}
.no-provider-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  line-height: 0;
}
.no-provider-icon :deep(svg) {
  width: 100%;
  height: 100%;
}
.no-provider-icon--warn { color: var(--status-warn); }
.no-provider-icon--gear { color: var(--text-tertiary); }
.no-provider-card h3 {
  font-size: 1.2em;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--text-primary);
}
.no-provider-card p {
  font-size: 0.95em;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 24px;
}
.btn.primary {
  display: inline-block;
  padding: 10px 24px;
  background: var(--accent);
  color: var(--text-inverse);
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.95em;
  font-weight: 600;
  transition: opacity 0.15s;
}
.btn.primary:hover {
  opacity: 0.85;
}

/* ── 增强版无提供商引导卡片（面向 Novice 画像） ── */
.no-provider-card--enhanced {
  max-width: 480px;
  padding: 36px 32px 28px;
}
.no-provider-lead {
  margin-bottom: 20px !important;
}
.no-provider-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
  text-align: left;
  display: grid;
  gap: 10px;
}
.no-provider-steps li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
}
.no-provider-steps .step-no {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.no-provider-steps .step-text {
  flex: 1;
  font-size: 0.9em;
  color: var(--text-secondary);
  line-height: 1.5;
}
.no-provider-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 16px;
}
.no-provider-actions .btn {
  display: inline-block;
  padding: 10px 18px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 0.9em;
  font-weight: 500;
  transition: opacity 0.15s, border-color 0.15s;
}
.no-provider-actions .btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.no-provider-note {
  font-size: 0.8em !important;
  color: var(--text-tertiary);
  margin: 0 !important;
  line-height: 1.5;
}

.chat-workbench-layout {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* ChatWindow 根元素 .chat-window 依赖 flex:1 伸缩来撑满高度；
   CardSpotlight 默认是 block 容器，会使其高度退化为内容高度，
   消息超出后被 overflow:hidden 裁剪、无法滚动。此处改为 flex column。 */
.chat-window-host {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.chat-main-column {
  flex: 1;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:deep(.chat-input-wrapper) {
  flex: 0 0 auto;
  min-width: 0;
}

.workbench-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border: none;
  background: transparent;
  font-size: 16px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  margin-left: auto;
}

.workbench-toggle-btn:hover {
  background: var(--bg-secondary);
}

.workbench-toggle-btn.active {
  color: var(--accent);
}

.session-more-menu {
  position: relative;
  flex: 0 0 auto;
}

.session-more-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.session-more-trigger:hover,
.session-more-trigger[aria-expanded='true'] {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-secondary);
}

.session-actions-menu {
  position: absolute;
  z-index: 220;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  gap: 4px;
  width: min(300px, calc(100vw - 24px));
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.session-actions-heading {
  padding: 4px 8px 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.session-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 36px;
  padding: 7px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.session-action:hover {
  background: var(--bg-secondary);
}

.session-action-state {
  color: var(--text-secondary);
  font-size: 12px;
}

.session-model-settings {
  border-top: 1px solid var(--border);
  margin-top: 2px;
}

.session-action-hint {
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 1.5;
  padding: 2px 10px 6px;
  border-bottom: 1px solid var(--border);
}

/* GAP-CMD-001：斜杠命令引导行（发现性入口） */
.session-action-hint--cmd {
  border-bottom: none;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  border-radius: 8px;
  margin: 0 2px 6px;
}

.session-action-hint--cmd code {
  font-family: ui-monospace, Consolas, monospace;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  padding: 0 4px;
  border-radius: 4px;
}

.session-task-status {
  display: grid;
  gap: 5px;
  margin: 4px 0 2px;
  padding: 7px 8px 2px;
  border-top: 1px solid var(--border);
}

.session-task-heading {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.session-task-status :deep(.tracker-bar) {
  width: 100%;
  margin-left: 0;
  justify-content: space-between;
}

.session-actions-menu :deep(.permission-mode-control) {
  display: block;
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.session-actions-menu :deep(.permission-trigger) {
  width: 100%;
  justify-content: space-between;
  border: 0;
  background: transparent;
}

.workbench-placeholder {
  color: var(--text-secondary, #999);
  text-align: center;
  padding: 40px 16px;
  font-size: 13px;
}

@media (max-width: 767px) {
  .chat-header :deep(.header-right) {
    flex-wrap: nowrap;
  }
}

@media (max-width: 480px) {
  .chat-header :deep(.header-right) {
    gap: 4px;
  }

  .session-actions-menu {
    right: -4px;
  }
}

/* ANIM-PAUSE-001：ChatView 被 keep-alive 缓存（导航离开）时暂停子树全部
   CSS 动画（含欢迎屏 Sparkles/Ripple/TextGlitch 的 infinite 动画） */
.view-paused,
.view-paused * {
  animation-play-state: paused !important;
  transition: none !important;
}
</style>