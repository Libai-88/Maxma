<template>
  <Teleport to="body">
    <Transition name="loader">
      <div v-if="loading" class="multi-step-loader" role="alert" aria-live="assertive">
        <div class="loader-backdrop" @click="onBackdropClick" />
        <div class="loader-panel">
          <button
            v-if="!preventClose"
            class="loader-close"
            aria-label="关闭加载"
            @click="emit('close')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          <div class="loader-steps">
            <div
              v-for="(step, index) in steps"
              :key="index"
              class="loader-step"
              :class="{
                'step--pending': index > activeStep,
                'step--active': index === activeStep,
                'step--complete': index < activeStep,
              }"
            >
              <div class="step-indicator">
                <div v-if="index < activeStep" class="step-checkmark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div v-else-if="index === activeStep" class="step-spinner" />
                <div v-else class="step-circle" />
              </div>
              <div class="step-text">
                <span v-if="index < activeStep && step.afterText" class="step-label step-label--done">{{ step.afterText }}</span>
                <span v-else class="step-label">{{ step.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

export interface Step {
  text: string
  duration?: number
  afterText?: string
}

interface MultiStepLoaderProps {
  loading?: boolean
  steps?: Step[]
  defaultDuration?: number
  preventClose?: boolean
}

const props = withDefaults(defineProps<MultiStepLoaderProps>(), {
  loading: false,
  steps: () => [],
  defaultDuration: 1500,
  preventClose: false,
})

const emit = defineEmits<{
  'state-change': [index: number]
  complete: []
  close: []
}>()

const activeStep = ref(-1)
let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

function startProgress() {
  clearTimers()
  if (props.steps.length === 0) return

  activeStep.value = 0
  emit('state-change', 0)

  let cumulativeDelay = 0
  for (let i = 0; i < props.steps.length; i++) {
    const duration = props.steps[i].duration ?? props.defaultDuration

    cumulativeDelay += duration

    const timer = setTimeout(() => {
      if (i < props.steps.length - 1) {
        activeStep.value = i + 1
        emit('state-change', i + 1)
      } else {
        activeStep.value = i
        emit('complete')
      }
    }, cumulativeDelay)

    timers.push(timer)
  }
}

function reset() {
  clearTimers()
  activeStep.value = -1
}

watch(() => props.loading, (val) => {
  if (val) {
    startProgress()
  } else {
    reset()
  }
})

onUnmounted(() => {
  clearTimers()
})

function onBackdropClick() {
  if (!props.preventClose) {
    emit('close')
  }
}
</script>

<style scoped>
/* ── Overlay ── */
.multi-step-loader {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-primary, #FFFEFA) 80%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.loader-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-24);
  padding: var(--space-40) var(--space-32);
  border-radius: var(--radius-lg);
  max-width: 360px;
  width: 100%;
}

.loader-close {
  position: absolute;
  top: var(--space-12);
  right: var(--space-12);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
.loader-close:hover {
  background: var(--overlay-light, rgba(0,0,0,0.05));
  color: var(--text-primary, #333);
}

/* ── Steps ── */
.loader-steps {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
}

.loader-step {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-12) 0;
  position: relative;
  min-height: 44px;
}

/* ── Connecting line between steps ── */
.loader-step::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 44px;
  bottom: 0;
  width: 2px;
  background: var(--border, #e5e5e5);
  transition: background var(--duration-slow) var(--ease-out);
}
.loader-step:last-child::before {
  display: none;
}
.loader-step.step--complete::before {
  background: var(--status-ok, #16a34a);
}

/* ── Indicator ── */
.step-indicator {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.step-circle {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--border, #e5e5e5);
  background: transparent;
  transition: border-color var(--duration-slow) var(--ease-out);
}

.step-spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid var(--border, #e5e5e5);
  border-top-color: var(--accent, #D4A5A5);
  border-radius: 50%;
  animation: loader-spin 0.7s linear infinite;
}

.step-checkmark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--status-ok, #16a34a);
  color: #fff;
  animation: loader-pop 0.3s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
}

/* ── Text ── */
.step-text {
  flex: 1;
  min-width: 0;
}

.step-label {
  font-size: var(--fs-ui, 0.88rem);
  color: var(--text-tertiary, #999);
  transition: color var(--duration-slow) var(--ease-out);
  line-height: 1.5;
}

.step--active .step-label {
  color: var(--text-primary, #333);
}

.step--complete .step-label,
.step-label--done {
  color: var(--status-ok, #16a34a);
}

/* ── Animations ── */
@keyframes loader-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes loader-pop {
  0%   { transform: scale(0); }
  60%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}

/* ── Transition for overlay ── */
.loader-enter-active {
  transition: opacity 0.25s var(--ease-out, ease-out);
}
.loader-leave-active {
  transition: opacity 0.15s var(--ease-out, ease-out);
}
.loader-enter-from,
.loader-leave-to {
  opacity: 0;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .step-spinner {
    animation: none;
    border-top-color: var(--accent, #D4A5A5);
    opacity: 0.7;
  }

  .step-checkmark {
    animation: none;
  }

  .loader-enter-active,
  .loader-leave-active {
    transition: opacity 0.01ms;
  }
}
</style>