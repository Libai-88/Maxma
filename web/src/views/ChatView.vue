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
          💡 不知道选哪个？DeepSeek 注册即送免费额度，OpenAI 兼容 API 都能直接接入。
        </p>
      </div>
    </div>
    <!-- 正常聊天界面 -->
    <template v-else>
    <ChatHeader>
      <template #extra>
        <ModelSelector />
        <StatusBadge :connected="connected" :health="health" />
        <span class="private-trigger hover-trigger">
          <button
            class="private-toggle"
            :class="{ active: privateMode }"
            :aria-pressed="privateMode"
            @click="setPrivateMode(!privateMode)"
          >
            <span class="private-indicator"></span>
            {{ privateMode ? '私密' : '记忆' }}
          </button>
          <div class="hover-card card-private">
            <div class="card-row">
              <span class="card-label">私密模式</span>
              <span class="card-value" :class="privateMode ? 'status-on' : 'status-off'">
                {{ privateMode ? '已开启' : '已关闭' }}
              </span>
            </div>
            <div class="card-divider"></div>
            <div class="private-desc">
              开启后，当前对话不会被保存到长期记忆和本地存储，关闭后恢复正常保存。
            </div>
          </div>
        </span>
        <span class="auto-approve-trigger hover-trigger">
          <button
            class="auto-approve-toggle"
            :class="{ active: autoApprove }"
            :aria-pressed="autoApprove"
            @click="setAutoApprove(!autoApprove)"
          >
            <span class="auto-approve-indicator"></span>
            {{ autoApprove ? '自动' : '检查' }}
          </button>
          <div class="hover-card card-auto-approve">
            <div class="card-row">
              <span class="card-label">自动执行</span>
              <span class="card-value" :class="autoApprove ? 'status-warn' : 'status-off'">
                {{ autoApprove ? '已开启' : '已关闭' }}
              </span>
            </div>
            <div class="card-divider"></div>
            <div class="auto-approve-desc">
              {{ autoApprove ? 'Python 代码将直接执行，无需用户确认。点击切换为手动审核模式。' : 'Python 代码执行前需要您确认。点击切换为自动执行模式。' }}
            </div>
          </div>
        </span>
        <SessionPermissionModeControl :session-id="sessionId" />
        <ContextUsageBadge :usage="contextUsage" :selected-model="selectedModelName" />
        <TaskTrackerBar :data="taskTrackerData as unknown as TaskTrackerData | null" />
        <button
          class="workbench-toggle-btn"
          :class="{ active: workbench.isOpen }"
          @click="workbench.toggle()"
          title="工作台"
        >
          &#9776;
        </button>
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
          <span class="sub-agent-readonly-text">🔒 子 Agent 会话 — 只读</span>
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
import ContextUsageBadge from '@/components/ContextUsageBadge.vue'
import SessionPermissionModeControl from '@/components/SessionPermissionModeControl.vue'
import WorkflowCard from '@/components/WorkflowCard.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import TaskTrackerBar, { type TaskTrackerData } from '@/components/TaskTrackerBar.vue'
import WorkbenchPanel from '@/components/workbench/WorkbenchPanel.vue'
import ReasoningTimeline from '@/components/workbench/ReasoningTimeline.vue'
import CanvasContainer from '@/components/workbench/CanvasContainer.vue'
import WelcomeScreen from '@/components/WelcomeScreen.vue'
import ChatHeader from '@/components/ChatHeader.vue'
import ModelSelector from '@/components/ModelSelector.vue'
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
import { computed, onMounted, ref } from 'vue'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { health } = storeToRefs(useHealthStore())
const {
  connected, isStreaming, turns, currentTurn, error, errorCategory, errorTraceId,
  contextUsage, taskTrackerData, send, cancel, sendUserResponse, sendArtifactAction, sendPlanResponse, removeTurns,
  privateMode, setPrivateMode, autoApprove, setAutoApprove
} = useChat(sessionId)

const workbench = useWorkbenchStore()

const hasMessages = computed(() => turns.value.length > 0)

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
  min-height: 0;
}
.private-toggle,
	.auto-approve-toggle {
	  display: inline-flex;
	  align-items: center;
	  justify-content: center;
	  gap: 6px;
	  min-width: 68px;
	  height: 28px;
	  padding: 4px 14px;
	  border: 1px solid var(--border);
	  border-radius: 6px;
	  background: transparent;
	  color: var(--text-secondary);
	  font-size: 0.85em;
	  cursor: pointer;
	  transition: all 0.15s;
	  user-select: none;
	}
.private-toggle:hover {
  border-color: var(--text-secondary);
}
.private-toggle.active {
  border-color: var(--status-warn);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-warn) 10%, transparent);
  color: var(--status-warn);
}
.private-toggle:not(.active) .private-indicator {
  background: var(--accent);
}
.private-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.private-trigger {
  position: relative;
}
.hover-card {
  visibility: hidden;
  opacity: 0;
  transform: translateY(-4px);
  transition: visibility 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 100;
  min-width: 240px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  font-size: 0.8em;
  line-height: 1.6;
}
.private-trigger:hover .hover-card {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
.auto-approve-toggle:hover {
  border-color: var(--text-secondary);
}
/* 自动模式（autoApprove = true） */
.auto-approve-toggle.active {
  border-color: var(--status-warn);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-warn) 10%, transparent);
  color: var(--status-warn);
}
/* 审核模式（autoApprove = false）指示器 */
.auto-approve-toggle:not(.active) .auto-approve-indicator {
  background: var(--accent);
}
.auto-approve-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}
.auto-approve-trigger {
  position: relative;
}
.auto-approve-trigger:hover .hover-card {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}
.private-desc {
  font-size: 0.8em;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: normal;
  max-width: 240px;
}
.status-warn {
  color: var(--status-warn);
}
.status-on {
  color: var(--status-warn);
}
.status-off {
  color: var(--text-secondary);
}
.card-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.card-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}
.card-value {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  font-weight: 600;
}
.card-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.auto-approve-desc {
  font-size: 0.8em;
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: normal;
  max-width: 240px;
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
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-main-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.workbench-toggle-btn {
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

.workbench-placeholder {
  color: var(--text-secondary, #999);
  text-align: center;
  padding: 40px 16px;
  font-size: 13px;
}

</style>
