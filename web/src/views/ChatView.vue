<template>
  <div class="chat-view">
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
            <button class="session-action" type="button" role="menuitem" :aria-pressed="privateMode" @click="togglePrivateMode">
              <span>私密模式</span>
              <span class="session-action-state">{{ privateMode ? '已开启' : '已关闭' }}</span>
            </button>
            <button class="session-action" type="button" role="menuitem" :aria-pressed="autoApprove" @click="toggleAutoApprove">
              <span>自动执行</span>
              <span class="session-action-state">{{ autoApprove ? '已开启' : '需确认' }}</span>
            </button>
            <div v-if="taskTrackerData" class="session-task-status" role="status" aria-label="任务状态">
              <div class="session-task-heading">任务状态</div>
              <TaskTrackerBar :data="taskTrackerData as unknown as TaskTrackerData" />
            </div>
            <SessionPermissionModeControl :session-id="sessionId" />
          </div>
        </div>
      </template>
    </ChatHeader>

    <div class="chat-workbench-layout">
      <div class="chat-main-column">
        <template v-if="hasMessages">
          <ChatWindow
            :session-id="sessionId"
            :turns="turns"
            :current-turn="currentTurn"
            :error="error"
            :error-category="errorCategory"
            :error-trace-id="errorTraceId"
            @action="handleToolAction"
            @cite="addCitation"
            @toggle-private="setPrivateMode(!privateMode)"
            @plan-respond="sendPlanResponse"
            @pin="handlePin"
          />
          <WorkflowCard v-if="!isSubagent" :session-id="sessionId" />
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
import ChatWindow from '@/components/ChatWindow.vue'
import SessionPermissionModeControl from '@/components/SessionPermissionModeControl.vue'
import WorkflowCard from '@/components/WorkflowCard.vue'
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
import { useWorkbenchStore } from '@/stores/workbench'
import { useHealthStore } from '@/stores/health'
import { useProviderStore } from '@/stores/provider'
import { useSessionStore } from '@/stores/session'
import { usePersonaStore } from '@/stores/persona'
import type { ParsedRef, SelectionRef } from '@/utils/references'
import type { ThinkPathId } from '@/utils/thinkPath'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { health } = storeToRefs(useHealthStore())
const {
  connected, isStreaming, turns, currentTurn, error, errorCategory, errorTraceId,
  taskTrackerData, send, cancel, sendUserResponse, sendArtifactAction, sendPlanResponse, removeTurns,
  privateMode, setPrivateMode, autoApprove, setAutoApprove
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
} = useSelectionQuote()

// 服务端 think_path 能力开关（包成 ref 以便传入 useChatInput）
const thinkPathEnabled = computed(() => health.value?.think_path_enabled === true)

// 持久化 provider/model 选择到 localStorage，刷新后恢复
const SELECTED_PROVIDER_KEY = 'maxma_selected_provider'
const SELECTED_MODEL_KEY = 'maxma_selected_model'
const selectedProviderId = ref(localStorage.getItem(SELECTED_PROVIDER_KEY) || '')
const selectedModelName = ref(localStorage.getItem(SELECTED_MODEL_KEY) || '')

const providerStore = useProviderStore()
const { hasProviders } = storeToRefs(providerStore)

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
  } finally {
    providerRetrying.value = false
  }
}

const personaStore = usePersonaStore()

onMounted(async () => {
  personaStore.fetchProfile()
  // 通过全局 store 加载 provider 列表（含重试），消除 ChatView/ChatInput 状态不一致
  await loadProvidersWithStatus()
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

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleMoreMenuPointerdown)
  document.removeEventListener('keydown', handleMoreMenuKeydown)
})

function togglePrivateMode() {
  setPrivateMode(!privateMode.value)
  closeMoreMenu()
}

function toggleAutoApprove() {
  setAutoApprove(!autoApprove.value)
  closeMoreMenu()
}

// Ctrl+K 切换私密模式
useGlobalShortcut({ key: 'k', mod: true }, () => { setPrivateMode(!privateMode.value) })

function onModelChange(providerId: string, modelName: string) {
  selectedProviderId.value = providerId
  selectedModelName.value = modelName
  // 持久化到 localStorage，刷新后可恢复
  localStorage.setItem(SELECTED_PROVIDER_KEY, providerId)
  localStorage.setItem(SELECTED_MODEL_KEY, modelName)
}

// ── ChatInput 状态收敛：创建 useChatInput 实例并 provide 给 ChatInput ──
// 保留实例引用，便于 handleQuickStart 复用 ChatInput 的 providerId/modelName 状态
const chatInputInstance = provideChatInput({
  isStreaming,
  canSend: connected,
  initialProviderId: selectedProviderId,
  initialModelName: selectedModelName,
  thinkPathEnabled,
  quotedSelections,
  quoteCandidate,
  onSend,
  onStop: cancel,
  onModelChange,
  onCommitQuote: commitCandidate,
  onRemoveQuote: removeQuote,
})

const isSubagent = computed(() => {
  return sessions.value.some(
    s => s.session_id === sessionId.value && s.is_subagent
  )
})

const chatInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

function addCitation(ref: ParsedRef) {
  chatInputRef.value?.addRef(ref)
}

function onSend(text: string, refs: ParsedRef[], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId): boolean {
  // 将选区引用作为 refs 的一部分传给后端
    const quoteRefs: SelectionRef[] = quotedSelections.value.map(q => ({
      type: 'selection',
      label: q.source,
      preview: q.text,
    }))
  const sent = send(text, [...refs, ...quoteRefs], providerId, modelName, thinkPathId)
  clearQuotes()
  return sent
}

function handleToolAction(payload: { action: string; data?: unknown }) {
  if (payload.action === 'user_response') {
    const d = payload.data as { interactionId: string; response: string | string[] }
    sendUserResponse(d.interactionId, d.response)
  } else if (payload.action === 'undo') {
    handleUndo()
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

async function handleUndo() {
  try {
    const result = await api.undoMessages(sessionId.value, 1)
    if (result.deleted_count > 0) {
      removeTurns(1)
    }
  } catch (e) {
    console.error('撤回失败:', e)
  }
}

function handleQuickStart(message: string) {
  // 通过 ChatInput 实例的 send 方法发送，确保使用 ChatInput 当前选中的 provider/model，
  // 而非直接调用 onSend（会丢失用户在 ModelSelector 中的选择）
  chatInputInstance.send(message)
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
  color: #fff;
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

@media (max-width: 720px) {
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

</style>
