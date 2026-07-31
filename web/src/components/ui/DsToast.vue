<!-- web/src/components/ui/DsToast.vue
  Toast 通知组件。role=status（非紧急）/ role=alert（紧急）+ aria-live="polite"。
  参考 Vercel Web Interface Guidelines：Async updates (toasts, validation) need `aria-live="polite"`。
-->
<template>
  <Teleport to="body">
    <Transition
      :css="false"
      @before-enter="onBeforeEnter"
      @enter="onEnter"
      @leave="onLeave"
    >
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
        <span v-if="duration > 0" class="ds-toast__progress" aria-hidden="true"></span>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, watchEffect, onUnmounted } from 'vue'
import { gsap, useGsap } from '@/composables/useGsap'

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

// 倒计时进度条时长：映射到 CSS var（--toast-duration）
watchEffect(() => {
  const el = toastRef.value
  if (!el) return
  el.style.setProperty('--toast-duration', `${(props.duration || 4000) / 1000}s`)
})

// ── Toast 弹层动画：spring 滑入 + 图标弹出（JS 过渡钩子，:css=false） ──
let onBeforeEnter = (_el: Element) => {}
let onEnter = (_el: Element, done: () => void) => done()
let onLeave = (_el: Element, done: () => void) => done()

useGsap((_ctx, contextSafe) => {
  function beforeEnter(el: Element) {
    gsap.set(el, { opacity: 0, y: 40, scale: 0.9, transformOrigin: 'bottom right' })
  }
  function enter(el: Element, done: () => void) {
    gsap.to(el, { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'back.out(2)', onComplete: done })
    const icon = (el as HTMLElement).querySelector('.ds-toast__icon')
    if (icon) gsap.from(icon, { scale: 0.3, opacity: 0, rotation: -90, duration: 0.3, ease: 'back.out(2.4)' })
  }
  function leave(el: Element, done: () => void) {
    gsap.to(el, { opacity: 0, y: 12, scale: 0.96, duration: 0.2, ease: 'power2.in', onComplete: done })
  }
  onBeforeEnter = contextSafe(beforeEnter)
  onEnter = contextSafe(enter)
  onLeave = contextSafe(leave)
})
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
  position: relative;
  overflow: hidden;
}

/* 倒计时进度条：线性 scaleX 缩短，hover 暂停 */
.ds-toast__progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  width: 100%;
  transform-origin: left center;
  background: color-mix(in srgb, var(--accent) 38%, transparent);
  animation: maxma-toast-progress linear forwards;
  animation-duration: var(--toast-duration, 4s);
}
.ds-toast:hover .ds-toast__progress,
.ds-toast:focus-within .ds-toast__progress {
  animation-play-state: paused;
}
.ds-toast--info {
  border-left-color: var(--accent);
  color: var(--text-primary);
}
.ds-toast--info .ds-toast__icon { color: var(--accent); }
.ds-toast--success {
  border-left-color: var(--status-ok);
}
.ds-toast--success .ds-toast__icon { color: var(--status-ok); }
.ds-toast--error {
  border-left-color: var(--status-error);
}
.ds-toast--error .ds-toast__icon { color: var(--status-error); }
.ds-toast--warning {
	  border-left-color: var(--status-warn);
	}
	.ds-toast--warning .ds-toast__icon { color: var(--status-warn); }

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

/* 弹层动画由 GSAP JS 过渡钩子控制（:css=false）；reduce-motion 由 useGsap 全局 timeScale 收口 */
</style>
