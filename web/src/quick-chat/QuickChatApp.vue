<!-- web/src/quick-chat/QuickChatApp.vue -->
<template>
  <div class="qc-app">
    <header class="qc-header">
      <div class="qc-logo-wrap">
        <LiquidLogo :image-url="logoUrl" />
      </div>
      <span class="qc-title">Quick Chat</span>
      <button v-if="!dismissed" class="qc-close" title="关闭窗口（关不掉时收起）" @click="closeWindow">✕</button>
    </header>

    <!-- 已收起状态：窗口关不掉时的确定反馈（见 closeWindow 的注释） -->
    <div v-if="dismissed" class="qc-dismissed" role="status">
      <p>Quick Chat 已收起</p>
      <p class="qc-dismissed-hint">
        彻底关闭请点标签页或窗口自带的 ✕；重新打开请访问 /quick-chat.html
      </p>
      <button class="qc-restore" @click="dismissed = false">返回对话</button>
    </div>
    <template v-else>
      <!-- 全局错误通知（监听 maxma:error 事件） -->
      <div v-if="globalError.visible" class="qc-error-bar" @click="globalError.visible = false">
        {{ globalError.message }}
      </div>
      <div class="qc-messages" ref="messagesRef">
        <div v-if="!turns.length && !currentTurn" class="qc-empty">
          <p>快速提问，不中断主窗口工作</p>
          <p class="qc-empty-hint">本页是独立页面（/quick-chat.html），与主窗口共用同一后端与会话</p>
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
          @keydown.enter.exact.prevent="onKeydownEnter"
          :disabled="isStreaming"
          maxlength="100000"
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch, reactive } from 'vue'
import { useChat } from '@/composables/useChat'
import { useSessionStore } from '@/stores/session'
import { storeToRefs } from 'pinia'
import RenderMarkdown from '@/components/RenderMarkdown.vue'
import LiquidLogo from '@/components/LiquidLogo.vue'
import logoUrl from '@/assets/images/brand/favicon.png'

const sessionStore = useSessionStore()
const { sessions } = storeToRefs(sessionStore)

const selectedSessionId = ref('')
const inputText = ref('')
const messagesRef = ref<HTMLElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 「收起」状态：closeWindow 尝试关窗后由它给出可见反馈，可一键返回 */
const dismissed = ref(false)

/** 全局错误提示（由 maxma:error 事件驱动） */
const globalError = reactive({
  visible: false,
  message: '',
})

// useChat 接收 Ref<string>，返回当前会话通道的响应式视图
const {
  turns, currentTurn, isStreaming, send, cancel,
} = useChat(selectedSessionId)

// 修复 QUICKCHAT-SUB-001：sub_session_created 时 useChat 内部 switchSession
// 只更新 session store（模块级 switchSession → getSessionStore().switchSession），
// 本组件的 selectedSessionId 不会跟着变，视图停留在父会话、子会话消息不可见。
// 此处监听 store 同步本地 ref——useChat 的 watch(sessionId) 随即触发通道切换；
// 子会话 done 后 store 自动切回父会话时同理跟随。
watch(() => sessionStore.sessionId, (id) => {
  if (id && id !== selectedSessionId.value) {
    selectedSessionId.value = id
  }
})

// useChat 未暴露 showTyping，本地计算：流式进行中且尚无最终回复时显示打字指示
const showTyping = computed(() => isStreaming.value && !currentTurn.value?.finalAnswer)

const mergedTurns = computed(() => {
  const list = [...turns.value]
  if (currentTurn.value) list.push(currentTurn.value)
  return list
})

// 修复 IME-COMPOSE-001：中文输入法确认候选词按 Enter 不触发发送
// （主输入框有 isComposing 守卫，QuickChat 此前缺失——半截拼音被当消息发出）
function onKeydownEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  onSend()
}

function onSend() {
  const text = inputText.value.trim()
  if (!text || isStreaming.value) return
  const sent = send(text, [])
  if (!sent) {
    globalError.message = '消息发送失败：WebSocket 连接已断开，请重试'
    globalError.visible = true
    return
  }
  inputText.value = ''
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

let _creatingSession = false
async function createNewSession() {
  // 修复 NEW-SESSION-DEDUP-001：连点防重（此前重复触发多次 POST /sessions 创建空会话）
  if (_creatingSession) return
  _creatingSession = true
  try {
    await sessionStore.createSession()
    selectedSessionId.value = sessionStore.sessionId
  } finally {
    _creatingSession = false
  }
}

/**
 * 关闭 / 收起 Quick Chat。
 *
 * Quick Chat 是独立顶层页面（Vite 辅入口 → dist/quick-chat.html，由后端静态托管），
 * 不是主应用文档里的浮层，所以「关闭」只能作用于承载它的顶层浏览上下文。
 *
 * 原先这里动态 import Tauri 的 invoke 并发送 quick-chat 窗口切换命令，外面一层空 catch：
 * Tauri 壳已随阶段 2 删除（原 Rust 端那个命令是对一个 visible:false / alwaysOnTop /
 * skipTaskbar 的 quick-chat 窗口做 show/hide 切换，并配全局快捷键），而 Electron 壳
 * 只有一个加载后端根地址的 BrowserWindow、没有 preload/IPC 桥，Web 形态是纯浏览器
 * —— 动态 import 必然失败，被 catch 吞掉后按钮点了没有任何反应，看起来却像能用。
 *
 * 现在两步，都不依赖任何桌面壳：
 *   1. `window.close()`：页面是被脚本打开的（window.open）时真的关掉窗口；
 *   2. 紧接着无条件置 dismissed：关成功时文档随即销毁、这一步无可见副作用；
 *      关不掉时（用户手输地址的标签页；Electron 下 main.cjs 用 sandbox: true，
 *      Electron 只在非沙箱渲染进程覆写 window.close，因此走 Blink 默认规则被忽略）
 *      界面换成「已收起」提示 —— 给用户确定可见的反馈与重新打开路径，而不是沉默。
 */
function closeWindow() {
  window.close()
  dismissed.value = true
}

// 监听消息变化，自动滚动到底部
watch([mergedTurns, () => isStreaming.value], () => {
  void nextTick().then(scrollToBottom)
})

onMounted(async () => {
  const initialized = await sessionStore.initIfNeeded()
  if (!initialized) {
    globalError.message = '会话初始化失败，请检查后端服务后重试'
    globalError.visible = true
  } else if (sessions.value.length) {
    selectedSessionId.value = sessions.value[0].session_id
  }
  // 聚焦输入框
  void nextTick().then(() => textareaRef.value?.focus())

  // 监听全局错误事件，显示可见通知
  window.addEventListener('maxma:error', ((e: CustomEvent) => {
    const detail = e.detail
    globalError.message = detail.message || '发生了意外错误'
    globalError.visible = true
  }) as EventListener)
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
.qc-logo-wrap {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
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
.qc-close:hover { background: var(--bg-card); color: var(--status-error-text); }

.qc-dismissed {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary);
}
.qc-dismissed p { margin: 0; }
.qc-dismissed-hint {
  font-size: 0.8em;
  color: var(--text-tertiary);
}
.qc-restore {
  margin-top: 8px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.85em;
  cursor: pointer;
}
.qc-restore:hover { border-color: var(--accent); color: var(--accent-text); }

.qc-error-bar {
  padding: 6px 12px;
  background: var(--status-error, #e74c3c);
  color: var(--text-inverse);
  font-size: 0.8em;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

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
  /* 与主聊天用同一对 token，否则轻量页与主应用对「用户气泡」的理解会分叉
     （此前这里读 --user-bubble + --bg-primary，与主应用的 solid/text 不一致）。 */
  background: var(--user-bubble-solid);
  color: var(--user-bubble-text);
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
  color: var(--status-error-text);
  font-size: 0.8em;
  cursor: pointer;
  white-space: nowrap;
}
.qc-stop-btn:hover {
  background: transparent;
  background: transparent;
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
