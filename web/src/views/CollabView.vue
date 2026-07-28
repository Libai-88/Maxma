<template>
  <div class="collab-view">
    <div class="header">
      <h2>协作 COLLABORATION</h2>
      <p class="header-sub">管理会话分享、快照与协作访问</p>
    </div>

    <!-- 会话选择器 -->
    <div class="session-selector">
      <label class="selector-label">当前会话：</label>
      <select v-model="currentSessionId" class="selector-input" @change="handleSessionChange">
        <option value="">选择会话...</option>
        <option v-for="session in sessions" :key="session.session_id" :value="session.session_id">
          {{ session.const_name || session.session_id }}
        </option>
      </select>
    </div>

    <div v-if="!currentSessionId" class="empty">
      <div class="empty-icon">🤝</div>
      <div class="empty-title">请选择一个会话</div>
      <div class="empty-desc">选择会话后可创建分享链接和快照</div>
    </div>

    <template v-else>
      <!-- 错误提示 -->
      <div v-if="store.error" class="error-banner">
        {{ store.error }}
        <button class="error-close" @click="store.clearError()">✕</button>
      </div>

      <!-- 分享链接 -->
      <div class="section">
        <div class="section-header">
          <h3>分享链接</h3>
          <button class="btn btn-primary" @click="showCreateShareDialog = true">
            创建分享
          </button>
        </div>

        <div v-if="store.loading" class="loading">加载中...</div>
        <div v-else-if="store.activeShares.length === 0" class="empty-section">
          暂无活跃的分享链接
        </div>
        <div v-else class="share-list">
          <div v-for="share in store.activeShares" :key="share.share_id" class="share-card">
            <div class="share-header">
              <span class="share-mode" :class="`mode-${share.access_mode}`">
                {{ shareModeLabel(share.access_mode) }}
              </span>
              <button class="btn-icon btn-danger" @click="handleRevokeShare(share.share_id)">
                撤销
              </button>
            </div>
            <div class="share-link">
              <input
                :value="getShareUrl(share.share_id)"
                readonly
                class="share-link-input"
                @click="copyToClipboard(getShareUrl(share.share_id))"
              />
              <button class="btn-copy" @click="copyToClipboard(getShareUrl(share.share_id))">
                复制
              </button>
            </div>
            <div class="share-meta">
              <span>访问次数: {{ share.access_count }}</span>
              <span v-if="share.max_access">/ {{ share.max_access }}</span>
              <span v-if="share.expires_at" class="share-expires">
                过期: {{ formatDate(share.expires_at) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 快照 -->
      <div class="section">
        <div class="section-header">
          <h3>会话快照</h3>
          <button class="btn btn-primary" @click="showCreateSnapshotDialog = true">
            创建快照
          </button>
        </div>

        <div v-if="store.loading" class="loading">加载中...</div>
        <div v-else-if="store.snapshots.length === 0" class="empty-section">
          暂无快照
        </div>
        <div v-else class="snapshot-list">
          <div v-for="snapshot in store.snapshots" :key="snapshot.snapshot_id" class="snapshot-card">
            <div class="snapshot-header">
              <h4>{{ snapshot.title }}</h4>
              <button class="btn-icon btn-danger" @click="handleDeleteSnapshot(snapshot.snapshot_id)">
                删除
              </button>
            </div>
            <div class="snapshot-meta">
              <span>{{ snapshot.turn_count }} 轮对话</span>
              <span>创建于 {{ formatDate(snapshot.created_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 创建分享对话框 -->
    <div v-if="showCreateShareDialog" class="dialog-overlay" @click.self="showCreateShareDialog = false">
      <div class="dialog-content">
        <h3>创建分享链接</h3>
        <form @submit.prevent="handleCreateShare">
          <div class="form-field">
            <label>访问模式</label>
            <select v-model="shareForm.access_mode" class="form-select">
              <option value="read">只读</option>
              <option value="comment">可评论</option>
              <option value="edit">可编辑</option>
            </select>
          </div>
          <div class="form-field">
            <label>有效期（小时，留空为永久）</label>
            <input v-model.number="shareForm.expires_in_hours" type="number" min="1" class="form-input" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">创建</button>
            <button type="button" class="btn" @click="showCreateShareDialog = false">
              取消
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 创建快照对话框 -->
    <div v-if="showCreateSnapshotDialog" class="dialog-overlay" @click.self="showCreateSnapshotDialog = false">
      <div class="dialog-content">
        <h3>创建会话快照</h3>
        <form @submit.prevent="handleCreateSnapshot">
          <div class="form-field">
            <label>快照标题</label>
            <input v-model="snapshotForm.title" type="text" required class="form-input" placeholder="例如：需求讨论 v1" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">创建</button>
            <button type="button" class="btn" @click="showCreateSnapshotDialog = false">
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCollabStore } from '@/stores/collab'
import { useSessionStore } from '@/stores/session'
import { confirmAction } from '@/composables/useConfirm'
import type { SessionInfo } from '@/types'

const store = useCollabStore()
const sessionStore = useSessionStore()

const currentSessionId = ref('')
const sessions = ref<SessionInfo[]>([])
const showCreateShareDialog = ref(false)
const showCreateSnapshotDialog = ref(false)
const copyFeedback = ref('')

const shareForm = ref({
  access_mode: 'read' as 'read' | 'comment' | 'edit',
  expires_in_hours: 24 as number | undefined,
})

const snapshotForm = ref({
  title: '',
})

onMounted(async () => {
  if (!sessionStore.sessions || sessionStore.sessions.length === 0) {
    await sessionStore.refreshSessions().catch(() => {})
  }
  sessions.value = sessionStore.sessions || []
  if (sessionStore.sessionId) {
    currentSessionId.value = sessionStore.sessionId
    await loadCollabData()
  }
})

async function loadCollabData() {
  if (!currentSessionId.value) return
  await Promise.allSettled([
    store.loadShares(currentSessionId.value),
    store.loadSnapshots(currentSessionId.value),
  ])
}

async function handleSessionChange() {
  await loadCollabData()
}

async function handleCreateShare() {
  try {
    await store.createShare({
      session_id: currentSessionId.value,
      access_mode: shareForm.value.access_mode,
      expires_in_hours: shareForm.value.expires_in_hours,
    })
    showCreateShareDialog.value = false
  } catch {
    // Error handled by store
  }
}

async function handleRevokeShare(shareId: string) {
  if (!await confirmAction({
    title: '撤销分享',
    message: '确定要撤销此分享链接吗？撤销后他人将无法再通过此链接访问。',
    confirmText: '撤销',
    danger: true,
  })) return
  try {
    await store.revokeShare(shareId)
  } catch {
    // Error handled by store
  }
}

async function handleCreateSnapshot() {
  if (!snapshotForm.value.title.trim()) return
  try {
    await store.createSnapshot(currentSessionId.value, snapshotForm.value.title.trim())
    showCreateSnapshotDialog.value = false
    snapshotForm.value.title = ''
  } catch {
    // Error handled by store
  }
}

async function handleDeleteSnapshot(snapshotId: string) {
  if (!await confirmAction({
    title: '删除快照',
    message: '确定要删除此快照吗？此操作不可撤销。',
    confirmText: '删除',
    danger: true,
  })) return
  try {
    await store.deleteSnapshot(snapshotId)
  } catch {
    // Error handled by store
  }
}

function getShareUrl(shareId: string): string {
  return `${window.location.origin}/share/${shareId}`
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    copyFeedback.value = '已复制'
    setTimeout(() => { copyFeedback.value = '' }, 2000)
  })
}

function shareModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    read: '只读',
    comment: '可评论',
    edit: '可编辑',
  }
  return labels[mode] || mode
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}
</script>

<style scoped>
.collab-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}

.header {
  margin-bottom: 20px;
}

.header h2 {
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
  margin: 0;
}

.header-sub {
  font-size: 0.82em;
  color: var(--text-tertiary);
  margin: 4px 0 0;
}

.session-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}

.selector-label {
  font-size: 0.9em;
  color: var(--text-secondary);
  white-space: nowrap;
}

.selector-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
}

.selector-input:focus {
  outline: none;
  border-color: var(--accent);
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 3em;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 6px;
}

.empty-desc {
  font-size: 0.9em;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-radius: 6px;
  font-size: 0.85em;
  margin-bottom: 16px;
}

.error-close {
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: #ef4444;
  cursor: pointer;
  font-size: 1.1em;
}

.section {
  margin-bottom: 28px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-header h3 {
  font-size: 1em;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.loading {
  text-align: center;
  padding: 20px;
  color: var(--text-tertiary);
  font-size: 0.9em;
}

.empty-section {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.9em;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.share-list,
.snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.share-card,
.snapshot-card {
  padding: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.share-header,
.snapshot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.snapshot-header h4 {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.share-mode {
  font-size: 0.75em;
  padding: 3px 10px;
  border-radius: 4px;
  font-weight: 500;
}

.mode-read {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.mode-comment {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.mode-edit {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.share-link {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.share-link-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.8em;
  font-family: var(--font-mono);
  cursor: pointer;
}

.share-link-input:focus {
  outline: none;
}

.btn-copy {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.8em;
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-copy:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.share-meta,
.snapshot-meta {
  display: flex;
  gap: 16px;
  font-size: 0.8em;
  color: var(--text-tertiary);
}

.share-expires {
  color: #f59e0b;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.85em;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-icon {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.15s;
}

.btn-danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
}

.dialog-content {
  width: 90%;
  max-width: 420px;
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.dialog-content h3 {
  font-size: 1.05em;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px;
}

.form-field {
  margin-bottom: 16px;
}

.form-field label {
  display: block;
  font-size: 0.85em;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent);
}

.form-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}
</style>
