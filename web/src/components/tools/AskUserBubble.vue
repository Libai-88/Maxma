<template>
  <BubbleChrome :tool-call="toolCall">
    <!-- 等待交互数据到达 -->
    <div v-if="toolCall.status === 'running' && !submitted && !interactionData.interactionId" class="ask-waiting">
      <span>等待询问...</span>
    </div>

    <!-- 运行中：展示交互表单 -->
    <div v-else-if="toolCall.status === 'running' && !submitted && interactionData.interactionId" class="ask-body">
      <p class="ask-question">{{ interactionData.question }}</p>

      <!-- QA 模式：自由文本输入 -->
      <div v-if="interactionData.mode === 'qa'" class="qa-input-area">
        <textarea
          v-model="qaText"
          class="qa-textarea"
          placeholder="请输入你的回答..."
          rows="3"
        ></textarea>
        <button
          class="btn-submit"
          :disabled="!qaText.trim()"
          @click="submitQA"
        >
          发送
        </button>
      </div>

      <!-- 单项选择 -->
      <div v-else-if="interactionData.mode === 'single_choice'" class="choice-area">
        <label
          v-for="(opt, idx) in interactionData.options"
          :key="idx"
          class="choice-option"
          :class="{ selected: singleSelected === opt }"
        >
          <input
            type="radio"
            :value="opt"
            v-model="singleSelected"
            class="choice-radio"
          />
          <span class="choice-label">{{ opt }}</span>
        </label>
        <button
          class="btn-submit"
          :disabled="!singleSelected"
          @click="submitSingle"
        >
          确认选择
        </button>
      </div>

      <!-- 多项选择 -->
      <div v-else-if="interactionData.mode === 'multi_choice'" class="choice-area">
        <label
          v-for="(opt, idx) in interactionData.options"
          :key="idx"
          class="choice-option"
          :class="{ selected: multiSelected.includes(opt) }"
        >
          <input
            type="checkbox"
            :value="opt"
            v-model="multiSelected"
            class="choice-checkbox"
          />
          <span class="choice-label">{{ opt }}</span>
        </label>
        <button
          class="btn-submit"
          :disabled="multiSelected.length === 0"
          @click="submitMulti"
        >
          确认选择（{{ multiSelected.length }}）
        </button>
      </div>

      <!-- 确认模式：危险操作确认 -->
      <div v-else-if="interactionData.mode === 'confirm'" class="confirm-area">
        <div class="confirm-warning">
          <Icon class="confirm-warning-icon" name="warning" :size="16" />
          <span class="confirm-warning-text">危险操作</span>
        </div>
        <p v-if="interactionData.detail" class="confirm-detail">{{ interactionData.detail }}</p>
        <div class="confirm-input-area">
          <label class="confirm-label">请输入"确认"以继续：</label>
          <input
            v-model="confirmText"
            type="text"
            class="confirm-input"
            placeholder="确认"
            @keydown.enter="submitConfirm"
          />
          <button
            class="btn-confirm-submit"
            :disabled="confirmText.trim() !== '确认'"
            @click="submitConfirm"
          >
            确认执行
          </button>
        </div>
      </div>

      <!-- 倒计时进度条 -->
      <div v-if="showCountdown" class="countdown-bar">
        <div
          ref="countdownFillRef"
          class="countdown-fill"
          :class="{ urgent: countdownPercent < 20 }"
        ></div>
        <span class="countdown-text" :class="{ urgent: countdownPercent < 20 }">
          {{ countdownSeconds }}s
        </span>
      </div>
    </div>

    <!-- 已提交，等待回复 -->
    <div v-else-if="toolCall.status === 'running' && submitted" class="ask-waiting">
      <span>已提交，等待回复...</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="toolCall.status === 'error'" class="ask-error">
      {{ toolCall.output || '交互失败' }}
    </div>

    <!-- 完成 -->
    <div v-else-if="toolCall.status === 'done'" class="ask-done">
      <div class="ask-done-summary">
        <Icon class="ask-done-icon" name="checkmark" :size="16" />
        <span class="ask-done-label">已收到你的回复</span>
      </div>
      <div v-if="doneData" class="ask-done-detail">
        <div class="ask-done-item">
          <span class="ask-done-field">Q：</span>
          <span class="ask-done-value">{{ doneData.question }}</span>
        </div>
        <div class="ask-done-item">
          <span class="ask-done-field">A：</span>
          <span class="ask-done-value">{{ doneAnswer }}</span>
        </div>
      </div>
    </div>
  </BubbleChrome>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types';
import { computed, onUnmounted, ref, watch, watchEffect } from 'vue';
import BubbleChrome from './_shared/BubbleChrome.vue';
import Icon from '@/components/Icon.vue';

const props = defineProps<{ toolCall: ToolCall }>()
const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
}>()

const submitted = ref(false)
const qaText = ref('')
const singleSelected = ref('')
const multiSelected = ref<string[]>([])
const confirmText = ref('')

// ── 倒计时 ──
const TIMEOUT_SECONDS = 300
const countdownRemaining = ref(TIMEOUT_SECONDS)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const showCountdown = computed(() => {
  return props.toolCall.status === 'running' && !submitted.value && !!interactionData.value.interactionId
})

const countdownPercent = computed(() => {
  return (countdownRemaining.value / TIMEOUT_SECONDS) * 100
})

const countdownSeconds = computed(() => {
  return Math.max(0, Math.ceil(countdownRemaining.value))
})

// CSP-safe CSSOM: set countdown fill width via style.setProperty
const countdownFillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = countdownFillRef.value
  if (el) el.style.setProperty('width', `${countdownPercent.value}%`)
}, { flush: 'post' })

function startCountdown() {
  stopCountdown()
  countdownRemaining.value = TIMEOUT_SECONDS
  countdownTimer = setInterval(() => {
    countdownRemaining.value -= 1
    if (countdownRemaining.value <= 0) {
      stopCountdown()
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

const interactionData = computed(() => {
  // AskUserBubble 只处理 qa/single_choice/multi_choice/confirm 模式，
  // approval 模式由 ApprovalBubble 渲染，因此 options 始终为 string[]。
  // 此处做类型断言以兼容扩展后的 AskUserInteraction.options 联合类型。
  const raw = props.toolCall.interaction
  const result = raw
    ? { ...raw, options: raw.options as string[] }
    : {
        question: '',
        mode: 'qa' as const,
        options: [] as string[],
        interactionId: '',
        submitted: false,
        detail: '',
      }
  return result
})

// 交互数据到达时启动倒计时（必须在 interactionData 声明之后，否则触发 TDZ ReferenceError）
// immediate: 组件挂载时若 interactionId 已存在（如从历史会话恢复），需立即启动倒计时，
// 否则只有 interactionId 变化时才会启动，导致历史会话恢复场景下倒计时永远不开始。
watch(() => interactionData.value.interactionId, (id) => {
  if (id) startCountdown()
}, { immediate: true })

onUnmounted(() => stopCountdown())

/** 工具完成时从 output JSON 解析出 { question, answer } */
const doneData = computed(() => {
  if (props.toolCall.status !== 'done' || !props.toolCall.output) return null
  try {
    const parsed = JSON.parse(props.toolCall.output)
    if (parsed.success && parsed.data) {
      return parsed.data as { question: string; answer: string | string[] }
    }
  } catch {}
  return null
})

/** 格式化用户的回答（多选时用顿号连接） */
const doneAnswer = computed(() => {
  if (!doneData.value) return ''
  const answer = doneData.value.answer
  if (Array.isArray(answer)) {
    return answer.join('、')
  }
  return answer || ''
})

function submitQA() {
  const text = qaText.value.trim()
  if (!text) return
  submitted.value = true
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: interactionData.value.interactionId,
      response: text,
    },
  })
}

function submitSingle() {
  if (!singleSelected.value) return
  submitted.value = true
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: interactionData.value.interactionId,
      response: singleSelected.value,
    },
  })
}

function submitMulti() {
  if (multiSelected.value.length === 0) return
  submitted.value = true
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: interactionData.value.interactionId,
      response: multiSelected.value,
    },
  })
}

function submitConfirm() {
  if (confirmText.value.trim() !== '确认') return
  submitted.value = true
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: interactionData.value.interactionId,
      response: confirmText.value.trim(),
    },
  })
}
</script>

<style scoped>
.ask-body {
  padding: 4px 0;
}
.ask-question {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  margin: 0 0 12px 0;
  font-weight: 500;
}

/* QA 输入 */
.qa-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.qa-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}
.qa-textarea:focus {
  border-color: var(--accent);
}
.qa-textarea::placeholder {
  color: var(--text-secondary);
}

/* 选项 */
.choice-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.choice-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  background: var(--bg-primary);
}
.choice-option:hover {
  border-color: var(--accent);
}
.choice-option.selected {
  border-color: var(--accent);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.choice-radio,
.choice-checkbox {
  accent-color: var(--accent);
  flex-shrink: 0;
}
.choice-label {
  font-size: 13px;
  color: var(--text-primary);
}

/* 提交按钮 */
.btn-submit {
  align-self: flex-end;
  margin-top: 4px;
  padding: 6px 20px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.btn-submit:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-submit:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 等待中 */
.ask-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
/* 错误 */
.ask-error {
  font-size: 13px;
  color: var(--status-error);
  padding: 4px 0;
}

/* 完成 */
.ask-done {
  padding: 4px 0;
}
.ask-done-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ask-done-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--status-ok);
  color: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.ask-done-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}
.ask-done-detail {
  margin-left: 28px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ask-done-item {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}
.ask-done-field {
  color: var(--text-secondary);
}

/* 确认模式 */
.confirm-area {
  padding: 4px 0;
}
.confirm-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  margin-bottom: 8px;
}
.confirm-warning-icon {
  font-size: 16px;
  color: var(--status-error);
}
.confirm-warning-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--status-error);
}
.confirm-detail {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 8px 0;
  line-height: 1.5;
}
.confirm-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.confirm-label {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}
.confirm-input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.confirm-input:focus {
  border-color: var(--accent);
}
.btn-confirm-submit {
  padding: 8px 16px;
  background: var(--status-error);
  color: var(--bg-primary);
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
  align-self: flex-start;
}
.btn-confirm-submit:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-confirm-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── 倒计时进度条 ── */
.countdown-bar {
  position: relative;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  margin-top: 12px;
  overflow: visible;
}
.countdown-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 1s linear, background 0.3s;
}
.countdown-fill.urgent {
  background: var(--status-error);
  animation: countdown-flash 0.5s ease-in-out infinite alternate;
}
.countdown-text {
  position: absolute;
  right: 0;
  top: -18px;
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.countdown-text.urgent {
  color: var(--status-error);
  font-weight: 600;
}

@keyframes countdown-flash {
  from { opacity: 0.6; }
  to { opacity: 1; }
}
</style>
