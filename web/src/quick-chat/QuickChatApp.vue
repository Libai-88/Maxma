<!-- web/src/quick-chat/QuickChatApp.vue -->
<template>
  <div class="qc-app">
    <header class="qc-header">
      <img src="@/assets/images/brand/favicon.png" alt="Maxma" class="qc-logo" />
      <span class="qc-title">Quick Chat</span>
      <button class="qc-close" @click="hideWindow" title="关闭">✕</button>
    </header>

    <div class="qc-messages" ref="messagesRef">
      <div v-if="!turns.length && !currentTurn" class="qc-empty">
        <p>Ctrl+Shift+Space 召唤</p>
        <p class="qc-empty-hint">快速提问，不中断主窗口工作</p>
      </div>
      <template v-for="turn in mergedTurns" :key="turn.id">
        <div class="qc-msg qc-msg--user">{{ turn.userMessage }}</div>
        <div v-if="turn.finalAnswer" class="qc-msg qc-msg--assistant">
          <RenderMarkdown :content="turn.finalAnswer" :streaming="isStreaming" />
        </div>
      </template>
      <div v-if="showTyping" class="qc-typing">
        <span class="qc-typing-dot"></span>
        <span class="qc-typing-dot"></span>
        <span class="qc-typing-dot"></span>
      </div>
    </div>

    <div class="qc-input-area">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="qc-textarea"
        placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
        @keydown.enter.exact.prevent="onSend"
        :disabled="isStreaming"
      ></textarea>
      <button
        v-if="isStreaming"
        class="qc-stop-btn"
        @click="cancel"
      >停止</button>
    </div>

    <!-- 会话切换 -->
    <div class="qc-session-bar">
      <select v-model="selectedSessionId" class="qc-session-select" @change="onSessionChange">
        <option v-for="s in sessions" :key="s.session_id" :value="s.session_id">
          {{ s.const_name || s.session_id.slice(0, 8) }}
        </option>
      </select>
      <button class="qc-new-session" @click="createNewSession" title="新会话">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useChat } from '@/composables/useChat'
import { useSessionStore } from '@/stores/session'
import { storeToRefs } from 'pinia'
import RenderMarkdown from '@/components/RenderMarkdown.vue'

const sessionStore = useSessionStore()
const { sessions } = storeToRefs(sessionStore)

const selectedSessionId = ref('')
const inputText = ref('')
const messagesRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

// useChat 接收 Ref<string>，返回当前会话通道的响应式视图
const {
  turns, currentTurn, isStreaming, send, cancel,
} = useChat(selectedSessionId)

// useChat 未暴露 showTyping，本地计算：流式进行中且尚无最终回复时显示打字指示
const showTyping = computed(() => isStreaming.value && !currentTurn.value?.finalAnswer)

const mergedTurns = computed(() => {
  const list = [...turns.value]
  if (currentTurn.value) list.push(currentTurn.value)
  return list
})

function onSend() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return
  inputText.value = ''
  // send 通过 WebSocket 同步发送（返回 void），无需 await
  send(text, [])
  void nextTick().then(scrollToBottom)
}

function scrollToBottom() {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

function onSessionChange() {
  // useChat 内部 watch 会自动响应 selectedSessionId 变化并切换通道
}

async function createNewSession() {
  await sessionStore.createSession()
  selectedSessionId.value = sessionStore.sessionId
}

async function hideWindow() {
  // 通过 Tauri invoke 隐藏窗口
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('toggle_quick_chat')
  } catch { /* 非 Tauri 环境忽略 */ }
}

// 监听消息变化，自动滚动到底部
watch([mergedTurns, () => isStreaming.value], () => {
  void nextTick().then(scrollToBottom)
})

onMounted(async () => {
  await sessionStore.initIfNeeded()
  if (sessions.value.length) {
    selectedSessionId.value = sessions.value[0].session_id
  }
  // 聚焦输入框
  void nextTick().then(() => textareaRef.value?.focus())
})
</script>

<style>
.qc-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  overflow: hidden;
}

.qc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}
.qc-logo {
  width: 20px;
  height: 20px;
  border-radius: 50%;
}
.qc-title {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--accent);
  flex: 1;
}
.qc-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1em;
  padding: 4px 8px;
  border-radius: 4px;
  -webkit-app-region: no-drag;
}
.qc-close:hover { background: var(--bg-card); color: var(--status-error); }

.qc-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  text-align: center;
}
.qc-empty p { margin: 4px 0; }
.qc-empty-hint { font-size: 0.8em; }

.qc-msg {
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 0.9em;
  line-height: 1.6;
  max-width: 90%;
  word-break: break-word;
}
.qc-msg--user {
  align-self: flex-end;
  background: var(--user-bubble, var(--accent));
  color: var(--bg-primary);
}
.qc-msg--assistant {
  align-self: flex-start;
  background: var(--bg-card);
  border: 1px solid var(--border);
}
.qc-msg--assistant :deep(.markdown-body) { font-size: 0.9em; }

.qc-typing {
  align-self: flex-start;
  display: flex;
  gap: 4px;
  padding: 8px 12px;
}
.qc-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  animation: qc-dot 1.4s infinite ease-in-out;
}
.qc-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.qc-typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes qc-dot {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.qc-input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.qc-textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.9em;
  padding: 8px;
  max-height: 120px;
  outline: none;
  transition: border-color 0.15s;
}
.qc-textarea:focus { border-color: var(--accent); }
.qc-textarea::placeholder { color: var(--text-tertiary); }

.qc-stop-btn {
  padding: 4px 12px;
  border: 1px solid var(--status-error);
  border-radius: var(--radius);
  background: transparent;
  color: var(--status-error);
  font-size: 0.8em;
  cursor: pointer;
  white-space: nowrap;
}
.qc-stop-btn:hover {
  background: color-mix(in srgb, var(--status-error) 10%, transparent);
}

.qc-session-bar {
  display: flex;
  gap: 4px;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-secondary);
}
.qc-session-select {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.8em;
  padding: 2px 4px;
  outline: none;
}
.qc-new-session {
  width: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1em;
}
.qc-new-session:hover { border-color: var(--accent); color: var(--accent); }

@media (prefers-reduced-motion: reduce) {
  .qc-typing-dot { animation: none; }
}
</style>
