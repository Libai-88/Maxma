<template>
  <div class="share-view">
    <div v-if="loading" class="loading">加载分享内容...</div>
    <div v-else-if="error" class="error">
      <h2>无法访问分享</h2>
      <p>{{ error }}</p>
      <router-link to="/" class="back-link">← 返回首页</router-link>
    </div>
    <template v-else>
      <div class="header">
        <h2>分享的会话</h2>
        <router-link to="/" class="back-link">← 返回</router-link>
      </div>
      <div v-if="share" class="share-info">
        <span class="share-badge" :class="`mode-${share.access_mode}`">{{ shareModeLabel(share.access_mode) }}</span>
        <span class="share-date">创建于 {{ formatDate(share.created_at) }}</span>
        <span v-if="share.expires_at" class="share-expires">过期于 {{ formatDate(share.expires_at) }}</span>
      </div>
      <div class="messages">
        <div v-for="(msg, idx) in messages" :key="idx" class="message" :class="msg.role">
          <div class="msg-role">{{ msg.role === 'user' ? '用户' : 'AI' }}</div>
          <div class="msg-content">{{ msg.content }}</div>
        </div>
        <div v-if="messages.length === 0" class="empty-msg">该会话暂无消息</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '@/api'

interface ShareData {
  share: { access_mode: string; created_at: string; expires_at?: string }
  session_id: string
  messages: { role: string; content: string }[]
}

const route = useRoute()
const loading = ref(true)
const error = ref('')
const share = ref<ShareData['share'] | null>(null)
const messages = ref<ShareData['messages']>([])

function shareModeLabel(mode: string): string {
  const labels: Record<string, string> = { read: '只读', comment: '可评论', edit: '可编辑' }
  return labels[mode] || mode
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}

onMounted(async () => {
  try {
    const data = await api.request<ShareData>(`/shares/${route.params.id}`)
    share.value = data.share
    messages.value = data.messages || []
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.share-view { max-width: 800px; margin: 0 auto; padding: 24px 16px 80px; }
.loading, .error { text-align: center; padding: 60px 20px; color: var(--text-tertiary); }
.error h2 { font-size: 1.2em; color: var(--status-error); margin-bottom: 8px; }
.error p { font-size: 0.9em; margin-bottom: 16px; }
.back-link { color: var(--accent); text-decoration: none; font-size: 0.9em; }
.back-link:hover { text-decoration: underline; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; margin: 0; }
.share-info { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; font-size: 0.85em; color: var(--text-secondary); }
.share-badge { font-size: 0.75em; padding: 3px 10px; border-radius: 4px; font-weight: 500; }
.mode-read { background: rgba(59,130,246,0.1); color: #3b82f6; }
.mode-comment { background: rgba(245,158,11,0.1); color: #f59e0b; }
.mode-edit { background: rgba(16,185,129,0.1); color: #10b981; }
.share-expires { color: #f59e0b; }
.messages { display: flex; flex-direction: column; gap: 12px; }
.message { padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); }
.message.user { background: var(--bg-secondary); }
.message.assistant { background: var(--bg-card); }
.msg-role { font-size: 0.75em; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; }
.msg-content { font-size: 0.9em; color: var(--text-primary); line-height: 1.6; white-space: pre-wrap; }
.empty-msg { text-align: center; padding: 40px; color: var(--text-tertiary); font-size: 0.9em; }
</style>
