<template>
  <div class="session-sidebar" :class="{ collapsed }">
    <div class="sidebar-section-header">
      <span>会话 Sessions</span>
      <button class="btn-new" aria-label="新建会话" @click="$emit('create')" title="新会话">+</button>
    </div>

    <div class="session-list">

      <!-- ── 已保存（固定会话）── -->
      <div class="const-section">
        <div class="section-label">已保存</div>
        <div v-if="constSessions.length === 0" class="section-hint">
          无已保存的会话。
          <br>
          右键点击临时会话来固定保存
        </div>
        <SessionItem
          v-for="s in constSessions"
          :key="s.session_id"
          :session="s"
          :is-active="s.session_id === activeId"
          :status="(sessionStatuses ?? {})[s.session_id]"
          :is-const="true"
          :collapsed="collapsed"
          @switch="$emit('switch', $event)"
          @contextmenu="onSessionContextMenu"
          @mouseenter="onSessionMouseEnter"
          @mouseleave="onSessionMouseLeave"
          @delete="showDeleteConfirm"
        />
      </div>

      <!-- ── 临时会话 ── -->
      <div class="temp-section">
        <div class="section-label">临时会话</div>
        <SessionItem
          v-for="s in tempSessions"
          :key="s.session_id"
          :session="s"
          :is-active="s.session_id === activeId"
          :status="(sessionStatuses ?? {})[s.session_id]"
          :is-const="false"
          :display-index="getSessionDisplayIndex(s)"
          :collapsed="collapsed"
          @switch="$emit('switch', $event)"
          @contextmenu="onSessionContextMenu"
          @mouseenter="onSessionMouseEnter"
          @mouseleave="onSessionMouseLeave"
          @delete="showDeleteConfirm"
        />
      </div>

      <div v-if="sessions.length === 0" class="no-sessions">
        暂无会话
      </div>
    </div>

    <Transition name="card">
      <div v-if="hoveredSession" :key="hoveredSession.session_id" ref="hoverCardRef" class="session-hover-card">
        <div class="card-row">
          <span class="card-label">ID</span>
          <span class="card-value">{{ hoveredSession.session_id }}</span>
        </div>
        <div class="card-row">
          <span class="card-label">消息</span>
          <span class="card-value">{{ hoveredSession.message_count }}</span>
        </div>
        <div class="card-divider"></div>
        <div class="card-row">
          <span class="card-label">创建时间</span>
          <span class="card-value">{{ formatRelativeTime(hoveredSession.created_at) }}</span>
        </div>
        <div class="card-row" v-if="hoveredSession.last_active">
          <span class="card-label">最近活跃</span>
          <span class="card-value">{{ formatRelativeTime(hoveredSession.last_active) }}</span>
        </div>
        <div class="card-divider" v-if="hoveredSession.last_active"></div>
        <div class="card-row">
          <span class="card-label">状态</span>
          <span class="card-value">{{ getAgentStatus(hoveredSession.session_id) }}</span>
        </div>
      </div>
    </Transition>

    <!-- ── 右键菜单 ── -->
    <ContextMenu
      :position="ctxMenuPos"
      :items="ctxMenuItems"
      :visible="ctxMenuVisible"
      @select="handleContextMenuSelect"
      @close="closeContextMenu"
    />

    <!-- ── 固定会话卡片 ── -->
    <Teleport to="body">
      <Transition name="constify-pop">
        <div
          v-if="constifyTarget"
          ref="constifyCardRef"
          class="constify-card"
          @click.stop
        >
          <div class="constify-card-title">固定会话</div>
          <div class="constify-input-row">
            <input
              ref="constifyInputRef"
              v-model="constifyName"
              class="constify-input"
              type="text"
              placeholder="输入会话名称..."
              maxlength="50"
              @keydown.enter="confirmConstify"
              @keydown.esc="cancelConstify"
            />
            <button
              class="constify-gen-btn"
              :class="{ loading: generating }"
              title="AI 生成标题"
              :disabled="generating"
              @click="generateTitle"
            >
              <Icon name="sparkles" :size="16" />
            </button>
          </div>
          <div class="constify-actions">
            <button class="constify-btn cancel" @click="cancelConstify">取消</button>
            <button
              class="constify-btn confirm"
              :disabled="!constifyName.trim()"
              @click="confirmConstify"
            >确定</button>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ── 删除确认对话框 ── -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="deleteConfirmTarget"
          class="delete-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
          @click="cancelDelete"
          @keydown="handleDeleteKeydown"
        >
          <div class="delete-confirm-card" @click.stop>
            <div id="delete-confirm-title" class="delete-confirm-title">确认删除会话</div>
            <div class="delete-confirm-message">
              此会话包含 <strong>{{ deleteConfirmTarget.message_count }}</strong> 条消息，删除后无法恢复。
            </div>
            <div class="delete-confirm-actions">
              <button ref="deleteConfirmCancelBtn" class="delete-confirm-btn cancel" @click="cancelDelete">取消</button>
              <button class="delete-confirm-btn confirm" @click="confirmDelete">删除</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import ContextMenu from '@/components/ContextMenu.vue';
import Icon from '@/components/Icon.vue';
import SessionItem from './SessionItem.vue';
import { useSessionStore } from '@/stores/session';
import type { SessionInfo } from '@/types';
import { computed, nextTick, ref, watch, watchEffect } from 'vue';

const sessionStore = useSessionStore()

const props = defineProps<{
  sessions: SessionInfo[]
  activeId: string
  sessionStatuses?: Record<string, { connected: boolean; isStreaming: boolean; isAwaitingUser: boolean }>
  collapsed?: boolean
}>()

const emit = defineEmits<{
  create: []
  switch: [id: string]
  delete: [id: string]
  constify: [id: string, name: string]
  unconstify: [id: string]
}>()

// ── 分区计算 ──────────────────────────────────────────────────

function getSessionDisplayIndex(s: SessionInfo): number {
  return tempSessions.value.length - tempSessions.value.findIndex(x => x.session_id === s.session_id)
}

const constSessions = computed(() =>
  props.sessions.filter(s => s.is_const)
)

const tempSessions = computed(() =>
  props.sessions.filter(s => !s.is_const)
)

// ── Hover card ────────────────────────────────────────────────

const hoveredSession = ref<SessionInfo | null>(null)
const hoverCardRef = ref<HTMLElement | null>(null)
const cardTop = ref(0)
const cardLeft = ref(0)

let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts * 1000
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return new Date(ts * 1000).toLocaleDateString()
}

function getAgentStatus(sessionId: string): string {
  const status = props.sessionStatuses?.[sessionId]
  if (!status?.connected) return '就绪'
  if (status.isAwaitingUser) return '需处理'
  if (status.isStreaming) return '工作中'
  return '就绪'
}

function onSessionMouseEnter(event: MouseEvent, session: SessionInfo) {
  if (hoverLeaveTimer !== null) {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  cardTop.value = rect.top
  cardLeft.value = rect.right + 8
  hoveredSession.value = session
  nextTick(() => adjustCardPosition(rect))
}

function onSessionMouseLeave() {
  if (hoverLeaveTimer !== null) clearTimeout(hoverLeaveTimer)
  hoverLeaveTimer = setTimeout(() => {
    hoveredSession.value = null
  }, 150)
}

function adjustCardPosition(buttonRect: DOMRect) {
  const cardEl = hoverCardRef.value
  if (!cardEl || !hoveredSession.value) return
  const cardWidth = cardEl.offsetWidth
  const cardHeight = cardEl.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 8

  if (cardLeft.value + cardWidth > vw - margin) {
    const leftPos = buttonRect.left - cardWidth - margin
    cardLeft.value = leftPos >= margin ? leftPos : Math.max(margin, vw - cardWidth - margin)
  }
  if (cardTop.value + cardHeight > vh - margin) {
    cardTop.value = Math.max(margin, vh - cardHeight - margin)
  }
}

// CSP-safe CSSOM: position hover card via style.setProperty (was :style cardStyle)
watchEffect(() => {
  const el = hoverCardRef.value
  if (!el || !hoveredSession.value) return
  el.style.setProperty('position', 'fixed')
  el.style.setProperty('top', `${cardTop.value}px`)
  el.style.setProperty('left', `${cardLeft.value}px`)
  el.style.setProperty('z-index', '100')
  el.style.setProperty('pointer-events', 'none')
}, { flush: 'post' })

// ── 右键菜单 ──────────────────────────────────────────────────

const ctxMenuVisible = ref(false)
const ctxMenuPos = ref({ x: 0, y: 0 })
const ctxMenuSession = ref<SessionInfo | null>(null)

const ctxMenuItems = computed(() => {
  const s = ctxMenuSession.value
  if (!s) return []
  if (s.is_const) {
    return [
      { label: '重命名', action: 'rename', icon: 'edit' },
      { label: '取消固定', action: 'unconstify' },
    ]
  }
  return [
    { label: '固定会话…', action: 'constify', icon: 'pin' },
  ]
})

// ── 固定会话卡片 ──────────────────────────────────────────────

const constifyTarget = ref<SessionInfo | null>(null)
const constifyName = ref('')
const constifyCardRef = ref<HTMLElement | null>(null)
const constifyInputRef = ref<HTMLInputElement | null>(null)
const constifyCardTop = ref(0)
const constifyCardLeft = ref(0)
const generating = ref(false)

/** 鼠标右键触发时的目标元素 rect，用于定位卡片 */
let constifyAnchorRect: DOMRect | null = null

// CSP-safe CSSOM: position constify card via style.setProperty (was :style constifyCardStyle)
watchEffect(() => {
  const el = constifyCardRef.value
  if (!el) return
  if (!constifyTarget.value) {
    el.style.setProperty('display', 'none')
    return
  }
  el.style.setProperty('display', '')
  el.style.setProperty('position', 'fixed')
  el.style.setProperty('top', `${constifyCardTop.value}px`)
  el.style.setProperty('left', `${constifyCardLeft.value}px`)
  el.style.setProperty('z-index', '1001')
}, { flush: 'post' })

function adjustConstifyCardPosition() {
  const cardEl = constifyCardRef.value
  if (!cardEl || !constifyTarget.value) return
  const cardWidth = cardEl.offsetWidth
  const cardHeight = cardEl.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  const margin = 8

  if (constifyCardLeft.value + cardWidth > vw - margin) {
    const leftPos = (constifyAnchorRect?.left ?? constifyCardLeft.value) - cardWidth - margin
    constifyCardLeft.value = leftPos >= margin ? leftPos : Math.max(margin, vw - cardWidth - margin)
  }
  if (constifyCardTop.value + cardHeight > vh - margin) {
    constifyCardTop.value = Math.max(margin, vh - cardHeight - margin)
  }
  // Ensure card stays on the right side of the anchor when there's room
  if (constifyAnchorRect && constifyCardLeft.value < constifyAnchorRect.right) {
    constifyCardLeft.value = constifyAnchorRect.right + margin
  }
}

function showConstifyCard(session: SessionInfo) {
  const rect = constifyAnchorRect
  if (rect) {
    constifyCardTop.value = rect.top
    constifyCardLeft.value = rect.right + 8
  }
  constifyTarget.value = session
  constifyName.value = session.const_name || ''
  closeContextMenu()
  nextTick(() => {
    adjustConstifyCardPosition()
    constifyInputRef.value?.focus()
    constifyInputRef.value?.select()
  })
}

async function generateTitle() {
  const session = constifyTarget.value
  if (!session || generating.value) return
  generating.value = true
  try {
    const title = await sessionStore.generateSessionTitle(session.session_id)
    constifyName.value = title
    nextTick(() => {
      constifyInputRef.value?.focus()
      constifyInputRef.value?.select()
    })
  } catch (e) {
    console.error('[constify] 标题生成失败:', e)
  } finally {
    generating.value = false
  }
}

function confirmConstify() {
  if (!constifyTarget.value || !constifyName.value.trim()) return
  emit('constify', constifyTarget.value.session_id, constifyName.value.trim())
  constifyTarget.value = null
  constifyName.value = ''
}

function cancelConstify() {
  constifyTarget.value = null
  constifyName.value = ''
}

// ── 悬浮详情卡片 ──────────────────────────────────────────────

/** 注册一个全局点击监听，在 constify 卡片打开时点击外部关闭 */
watch(constifyTarget, (val) => {
  if (val) {
    const handler = (e: MouseEvent) => {
      const card = constifyCardRef.value
      if (card && !card.contains(e.target as Node)) {
        cancelConstify()
      }
    }
    // delay registration so the current click doesn't immediately close
    nextTick(() => document.addEventListener('click', handler, { once: true }))
  }
})

function onSessionContextMenu(event: MouseEvent, session: SessionInfo) {
  // 关闭 hover card
  if (hoverLeaveTimer !== null) {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  hoveredSession.value = null

  // 保存锚点元素 rect，供 constify 卡片定位
  constifyAnchorRect = (event.currentTarget as HTMLElement).getBoundingClientRect()

  ctxMenuSession.value = session
  ctxMenuPos.value = { x: event.clientX, y: event.clientY }
  ctxMenuVisible.value = true
}

function handleContextMenuSelect(action: string) {
  const s = ctxMenuSession.value
  if (!s) return
  if (action === 'constify' || action === 'rename') {
    showConstifyCard(s)
    return  // 不关闭菜单，showConstifyCard 内部会关闭
  } else if (action === 'unconstify') {
    emit('unconstify', s.session_id)
  }
  closeContextMenu()
}

function closeContextMenu() {
  ctxMenuVisible.value = false
  ctxMenuSession.value = null
}

// ── 删除确认对话框 ──────────────────────────────────────────────

const deleteConfirmTarget = ref<SessionInfo | null>(null)
const deleteConfirmCancelBtn = ref<HTMLButtonElement | null>(null)
let deleteTriggerElement: HTMLElement | null = null

function showDeleteConfirm(session: SessionInfo) {
  deleteTriggerElement = document.activeElement as HTMLElement
  deleteConfirmTarget.value = session
  nextTick(() => {
    deleteConfirmCancelBtn.value?.focus()
  })
}

function closeDeleteDialog(returnFocus = true) {
  deleteConfirmTarget.value = null
  if (returnFocus && deleteTriggerElement?.isConnected) {
    deleteTriggerElement.focus()
  }
  deleteTriggerElement = null
}

function cancelDelete() {
  closeDeleteDialog(true)
}

function confirmDelete() {
  if (deleteConfirmTarget.value) {
    emit('delete', deleteConfirmTarget.value.session_id)
  }
  closeDeleteDialog(true)
}

function getFocusableInDialog(root: HTMLElement): HTMLElement[] {
  const card = root.querySelector('.delete-confirm-card')
  if (!card) return []
  return Array.from(card.querySelectorAll('button:not([disabled])')) as HTMLElement[]
}

function handleDeleteKeydown(event: KeyboardEvent) {
  if (!deleteConfirmTarget.value) return

  if (event.key === 'Escape') {
    event.preventDefault()
    closeDeleteDialog(true)
    return
  }

  if (event.key !== 'Tab') return

  const overlay = event.currentTarget as HTMLElement
  const focusable = getFocusableInDialog(overlay)
  if (!focusable.length) {
    event.preventDefault()
    return
  }

  const current = document.activeElement as HTMLElement
  const idx = focusable.findIndex(el => el === current)
  if (idx < 0) {
    event.preventDefault()
    focusable[0].focus()
    return
  }

  if (!event.shiftKey && idx === focusable.length - 1) {
    event.preventDefault()
    focusable[0].focus()
  } else if (event.shiftKey && idx === 0) {
    event.preventDefault()
    focusable[focusable.length - 1].focus()
  }
}
</script>

<style scoped>
.session-sidebar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sidebar-section-header {
		  display: flex;
		  align-items: center;
		  justify-content: space-between;
		  font-size: 0.85em;
		  font-weight: 600;
		  font-family: var(--font-display);
		  color: var(--text-secondary);
		  text-transform: uppercase;
		  letter-spacing: 0.5px;
		}
.sidebar-section-header span {
  transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;
  overflow: hidden;
  white-space: nowrap;
  display: inline-block;
  max-width: 200px;
}
.btn-new {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.btn-new:hover {
  background: var(--accent);
  color: var(--bg-primary);
}
.nav-item {
	  display: flex;
	  align-items: center;
	  gap: 8px;
	  padding: 10px 14px;
	  border: none;
	  border-radius: 6px;
	  background: transparent;
	  color: var(--text-primary);
	  font-size: 14px;
	  cursor: pointer;
	  text-align: left;
	  font-family: inherit;
	  transition: background 0.15s;
	}
.nav-item:hover {
  background: var(--bg-card);
}
.nav-icon {
  font-size: 16px;
  line-height: 1;
}
.nav-label {
  font-weight: 500;
}
.session-sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 6px;
}
.session-sidebar.collapsed .nav-label {
  display: none;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 400px;
  overflow-y: auto;
  padding: 0 6px 8px;
}

/* ── Section label ── */
.section-label {
		  font-size: 0.78em;
		  font-weight: 600;
		  font-family: var(--font-display);
		  color: var(--text-tertiary, #9ca3af);
		  text-transform: uppercase;
		  letter-spacing: 0.4px;
		  padding: 6px 12px 4px;
		}

/* ── Novice 引导 intro-card ── */
.session-intro-card {
	  margin: 0 6px 8px;
	  padding: 8px 12px;
	  border: 1px solid var(--border);
	  border-radius: 8px;
	  background: transparent;
	  background: color-mix(in srgb, var(--accent) 4%, transparent);
	  font-size: 0.8em;
	  color: var(--text-secondary);
	}
.session-intro-card > summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--text-primary);
  list-style: none;
  user-select: none;
}
.session-intro-card > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 6px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.session-intro-card[open] > summary::before {
  transform: rotate(90deg);
}
.session-intro-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  line-height: 1.5;
}
.session-intro-body p {
  margin: 0;
}
.session-intro-tip {
  color: var(--text-tertiary);
  font-size: 0.95em;
}

.section-hint {
	  font-size: 0.82em;
	  color: var(--text-tertiary, #9ca3af);
	  padding: 6px 12px 10px;
	  line-height: 1.5;
	}

/* ── Session items 样式已迁移至 SessionItem.vue ── */
.no-sessions {
  font-size: 0.8em;
  color: var(--text-secondary);
  padding: 8px;
  transition: opacity 0.2s ease 0.05s;
  overflow: hidden;
  max-height: 40px;
}

/* ── Hover card ── */
.session-hover-card {
  min-width: 220px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  font-size: 0.8em;
  line-height: 1.6;
  white-space: nowrap;
}
.card-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.card-label {
  color: var(--text-secondary);
}
.card-value {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.card-enter-active,
.card-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

/* ── Collapsed icon-only mode ── */
.session-sidebar.collapsed .sidebar-section-header {
  justify-content: center;
}
.session-sidebar.collapsed .sidebar-section-header span {
  max-width: 0;
  opacity: 0;
  transform: translateX(-24px);
  overflow: hidden;
  white-space: nowrap;
  display: inline-block;
  padding: 0;
  margin: 0;
}
/* session-item 的 collapsed 样式由 SessionItem 内部处理（通过 collapsed prop） */
.session-sidebar.collapsed .no-sessions {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  padding: 0;
  margin: 0;
}
/* collapsed 时隐藏分区 label 和提示 */
.session-sidebar.collapsed .section-label,
.session-sidebar.collapsed .section-hint,
.session-sidebar.collapsed .session-intro-card {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  padding: 0;
  margin: 0;
  border: none;
}

/* ── 固定会话卡片 ── */
.constify-card {
  min-width: 240px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: auto;
}

.constify-card-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
}

.constify-input-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.constify-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 0.9em;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s;
}

.constify-input:focus {
  border-color: var(--accent);
}

.constify-input::placeholder {
  color: var(--text-tertiary);
}

.constify-gen-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}

.constify-gen-btn:hover:not(:disabled) {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
  border-color: var(--accent);
}

.constify-gen-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.constify-gen-btn.loading {
  animation: gen-btn-pulse 0.8s ease-in-out infinite;
}

@keyframes gen-btn-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.constify-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.constify-btn {
  padding: 6px 16px;
  font-size: 0.9em;
  font-family: inherit;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.constify-btn.cancel {
  background: transparent;
  color: var(--text-secondary);
}

.constify-btn.cancel:hover {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-primary);
}

.constify-btn.confirm {
  background: var(--accent);
  color: var(--bg-primary);
}

.constify-btn.confirm:hover:not(:disabled) {
  opacity: 0.85;
}

.constify-btn.confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 卡片弹出动画 */
.constify-pop-enter-active {
  transition: opacity 0.12s ease-out, transform 0.12s ease-out;
}
.constify-pop-leave-active {
  transition: opacity 0.1s ease-in, transform 0.1s ease-in;
}
.constify-pop-enter-from {
  opacity: 0;
  transform: translateX(-6px) scale(0.96);
}
.constify-pop-leave-to {
  opacity: 0;
  transform: translateX(-4px) scale(0.96);
}

/* ── 删除确认对话框 ── */
.delete-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.delete-confirm-card {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 20px;
  min-width: 300px;
  max-width: 400px;
  box-shadow: var(--shadow-xl);
}

.delete-confirm-title {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.delete-confirm-message {
  font-size: 0.95em;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 20px;
}

.delete-confirm-message strong {
  color: var(--text-primary);
  font-weight: 600;
}

.delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.delete-confirm-btn {
  padding: 8px 18px;
  font-size: 0.95em;
  font-family: inherit;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.delete-confirm-btn.cancel {
  background: transparent;
  color: var(--text-secondary);
}

.delete-confirm-btn.cancel:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.delete-confirm-btn.confirm {
  background: var(--status-error, #dc2626);
  color: var(--bg-primary);
}

.delete-confirm-btn.confirm:hover {
  opacity: 0.9;
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
