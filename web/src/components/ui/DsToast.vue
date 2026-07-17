<!-- web/src/components/ui/DsToast.vue
  Toast 通知组件。role=status（非紧急）/ role=alert（紧急）+ aria-live="polite"。
  参考 Vercel Web Interface Guidelines：Async updates (toasts, validation) need `aria-live="polite"`。
-->
<template>
  <Teleport to="body">
    <Transition name="ds-toast">
      <div
        v-if="visible"
        ref="toastRef"
        class="ds-toast"
        :class="`ds-toast--${type}`"
        :role="resolvedRole"
        aria-live="polite"
        aria-atomic="true"
        @mouseenter="pause"
        @mouseleave="resume"
        @focusin="pause"
        @focusout="resume"
      >
        <svg
          v-if="iconPath"
          class="ds-toast__icon"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path :d="iconPath" fill="none" stroke="currentColor" stroke-width="1.4"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="ds-toast__msg">{{ message }}</span>
        <button
          v-if="dismissible"
          type="button"
          class="ds-toast__close"
          aria-label="关闭通知"
          @click="dismiss"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor"
                  stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'

type ToastType = 'info' | 'success' | 'error' | 'warning'

const props = withDefaults(defineProps<{
  /** 是否显示（v-model:visible） */
  visible: boolean
  message: string
  type?: ToastType
  /** 自动消失毫秒数；0 表示不自动消失 */
  duration?: number
  dismissible?: boolean
  /** 显式覆盖 role；不传则按 type 推断（error/warning → alert，info/success → status） */
  role?: 'status' | 'alert'
}>(), {
  type: 'info',
  duration: 4000,
  dismissible: true,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  dismiss: []
}>()

const toastRef = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let remaining: number
let startedAt: number

const resolvedRole = computed<'status' | 'alert'>(() => {
  if (props.role) return props.role
  return props.type === 'error' || props.type === 'warning' ? 'alert' : 'status'
})

const iconPath = computed<string>(() => {
  switch (props.type) {
    case 'success':
      return 'M3 8.5l3.5 3.5L13 4.5'
    case 'error':
      return 'M4 4l8 8M12 4l-8 8'
    case 'warning':
      return 'M8 2.5L14 13H2L8 2.5zM8 6.5v3M8 11.5v.5'
    case 'info':
    default:
      return 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 7v4M8 5v.5'
  }
})

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function startTimer(durationMs: number) {
  if (durationMs <= 0) return
  clearTimer()
  remaining = durationMs
  startedAt = Date.now()
  timer = setTimeout(() => dismiss(), durationMs)
}

function pause() {
  if (!timer) return
  // 计算剩余时间
  const elapsed = Date.now() - startedAt
  remaining = Math.max(0, remaining - elapsed)
  clearTimer()
}

function resume() {
  if (remaining > 0) {
    startTimer(remaining)
  }
}

function dismiss() {
  clearTimer()
  emit('update:visible', false)
  emit('dismiss')
}

watch(() => props.visible, (v) => {
  if (v) {
    if (props.duration > 0) {
      remaining = props.duration
      startTimer(props.duration)
    }
  } else {
    clearTimer()
  }
}, { immediate: true })

onUnmounted(() => {
  clearTimer()
})

defineExpose({ dismiss, pause, resume })
</script>

<style scoped>
.ds-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1100;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(380px, calc(100vw - 40px));
  padding: 10px 12px;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  font-size: var(--fs-ui);
  font-family: var(--font-body);
  line-height: 1.4;
}
.ds-toast--info {
  border-left-color: var(--accent, #2563eb);
  color: var(--text-primary);
}
.ds-toast--info .ds-toast__icon { color: var(--accent, #2563eb); }
.ds-toast--success {
  border-left-color: var(--status-success, #16a34a);
}
.ds-toast--success .ds-toast__icon { color: var(--status-success, #16a34a); }
.ds-toast--error {
  border-left-color: var(--status-error, #dc2626);
}
.ds-toast--error .ds-toast__icon { color: var(--status-error, #dc2626); }
.ds-toast--warning {
  border-left-color: #d97706;
}
.ds-toast--warning .ds-toast__icon { color: #d97706; }

.ds-toast__icon {
  flex-shrink: 0;
}
.ds-toast__msg {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.ds-toast__close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.ds-toast__close:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.ds-toast__close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.ds-toast-enter-active,
.ds-toast-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
}
.ds-toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.ds-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .ds-toast-enter-active,
  .ds-toast-leave-active {
    transition: opacity var(--duration-instant) linear;
    transform: none;
  }
  .ds-toast-enter-from,
  .ds-toast-leave-to {
    transform: none;
  }
}
</style>
