<template>
  <div
    class="session-item"
    :class="{ active: isActive, 'is-const': isConst, collapsed }"
    @click="$emit('switch', session.session_id)"
    @contextmenu.prevent="$emit('contextmenu', $event, session)"
    @mouseenter="$emit('mouseenter', $event, session)"
    @mouseleave="$emit('mouseleave')"
  >
    <div class="session-item-main">
      <span class="session-id">
        <template v-if="isConst">
          <Icon name="pin" :size="12" class="pin-icon" />
          <span class="const-name-text">{{ session.const_name || '未命名' }}</span>
        </template>
        <template v-else>
          Session #{{ displayIndex }}
        </template>
        <span v-if="session.is_subagent" class="sub-badge" title="子 Agent 会话（只读）">sub</span>
      </span>
      <span class="session-count">{{ formatRelativeTime(session.last_active ?? session.created_at) }} · {{ session.message_count }} 条消息</span>
    </div>
    <div class="session-item-right">
      <span
        v-if="status?.isAwaitingUser"
        class="status-dot awaiting-user"
        title="等待用户输入"
      />
      <span
        v-else-if="status?.isStreaming"
        class="status-dot streaming"
        title="Agent 运行中"
      />
      <span
        v-else-if="status?.connected"
        class="status-dot connected"
        title="已连接"
      />
      <button
        class="btn-delete"
        @click.stop="$emit('delete', session)"
        title="删除会话"
      >
        &times;
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import type { SessionInfo } from '@/types'

interface SessionStatus {
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
}

defineProps<{
  session: SessionInfo
  isActive: boolean
  status?: SessionStatus
  isConst: boolean
  /** 临时会话显示序号；const 会话不使用 */
  displayIndex?: number
  /** 父级 sidebar 折叠状态，用于内部应用 collapsed 样式 */
  collapsed?: boolean
}>()

defineEmits<{
  switch: [id: string]
  contextmenu: [event: MouseEvent, session: SessionInfo]
  mouseenter: [event: MouseEvent, session: SessionInfo]
  mouseleave: []
  delete: [session: SessionInfo]
}>()

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
</script>

<style scoped>
.session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.15s;
}
.session-item:hover {
  background: var(--bg-card);
}
.session-item.active {
  background: var(--bg-card);
  box-shadow: var(--shadow);
}

/* Const 会话外观 — pin 图标已提供视觉区分，无需侧边条 */
.session-item.is-const {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}
/* active const sessions should have a clean white bg */
.session-item.is-const.active {
  background: var(--bg-card);
}

.session-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;
  overflow: hidden;
  max-height: 80px;
}
.session-id {
  font-size: 0.9em;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 2px;
}
.pin-icon {
  margin-right: 3px;
  flex-shrink: 0;
}
.const-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  font-size: 0.65em;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 3px;
  vertical-align: middle;
}
.session-count {
  font-size: 0.75em;
  color: var(--text-secondary);
}
.btn-delete {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease 0.05s, transform 0.25s ease 0.05s, color 0.15s;
  overflow: hidden;
  max-width: 22px;
}
.session-item:hover .btn-delete {
  opacity: 1;
}
.btn-delete:hover {
  color: var(--status-error);
}

.session-item-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.connected {
  background: var(--status-ok);
}

.status-dot.streaming {
  background: var(--status-ok);
  animation: pulse 1.2s ease-in-out infinite;
}

.status-dot.awaiting-user {
  background: var(--status-warn);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

/* ── Collapsed icon-only mode ── */
.session-item.collapsed {
  justify-content: center;
  padding: 6px;
}
.session-item.collapsed .session-item-main {
  max-height: 0;
  max-width: 0;
  min-width: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateX(-24px);
  padding: 0;
  margin: 0;
}
.session-item.collapsed .btn-delete {
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateX(-24px);
  padding: 0;
  margin: 0;
  border: none;
}
/* collapsed 时隐藏 const 左侧边框 */
.session-item.collapsed.is-const {
  border-left: none;
}
</style>
