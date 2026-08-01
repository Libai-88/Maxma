<template>
  <div
    ref="triggerRef"
    class="context-usage-ring"
    :class="statusClass"
    role="img"
    :aria-label="ariaLabel"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @focus="onFocus"
    @blur="onBlur"
    tabindex="0"
  >
    <AnimatedCircularProgressBar
      :value="barPercent"
      :max="100"
      :min="0"
      :primary-color="primaryColor"
      :secondary-color="'var(--border)'"
      :stroke-width="3"
      :show-percentage="true"
      :duration="0.5"
      :size="24"
    />
    <DsTooltip ref="tooltipRef" placement="top" :delay="500">
      <template #content>
        <div class="usage-tooltip-content">
          <div class="tooltip-title">上下文用量</div>
          <div class="tooltip-row">
            <span>模型</span>
            <span>{{ usage.modelName || '-' }}</span>
          </div>
          <div class="tooltip-row">
            <span>已用</span>
            <span>{{ formatNum(usage.estimatedTokens) }} tokens（约 {{ approxChars(usage.estimatedTokens) }}）</span>
          </div>
          <div class="tooltip-row">
            <span>上限</span>
            <span>{{ formatNum(usage.maxTokens) }} tokens（约 {{ approxChars(usage.maxTokens) }}）</span>
          </div>
          <div class="tooltip-row">
            <span>消息数</span>
            <span>{{ usage.messageCount }}</span>
          </div>
          <div class="tooltip-hint">
            上下文窗口是模型一次对话能处理的最大文本长度，包括你的输入和 AI 的回复。
          </div>
        </div>
      </template>
    </DsTooltip>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { normalizeContextUsage, useChatStore } from '../stores/chat'
import DsTooltip from './ui/DsTooltip.vue'
import AnimatedCircularProgressBar from './AnimatedCircularProgressBar.vue'
import { gsap, useGsap } from '@/composables/useGsap'

const store = useChatStore()
const tooltipRef = ref<InstanceType<typeof DsTooltip> | null>(null)
const triggerRef = ref<HTMLElement | null>(null)

const usage = computed(() => store.contextUsage)
const percentage = computed(() => normalizeContextUsage(usage.value).percentage)
const barPercent = computed(() => Math.min(percentage.value, 100))
const pctText = computed(() => Math.round(barPercent.value).toString())

const statusClass = computed(() => {
  if (percentage.value > 90) return 'status-critical'
  if (percentage.value > 70) return 'status-warn'
  return ''
})

const primaryColor = computed(() => {
  if (percentage.value > 90) return 'var(--status-error)'
  if (percentage.value > 70) return 'var(--status-warn)'
  return 'var(--accent)'
})

const statusText = computed(() => {
  if (percentage.value > 90) return '拥挤'
  if (percentage.value > 70) return '偏高'
  return '正常'
})

const ariaLabel = computed(() => `上下文用量 ${pctText.value}%，状态${statusText.value}`)

function onMouseEnter(e: MouseEvent) {
  tooltipRef.value?.show(e)
}

function onMouseLeave() {
  tooltipRef.value?.hide()
}

function onFocus(e: FocusEvent) {
  tooltipRef.value?.show(e)
}

function onBlur() {
  tooltipRef.value?.hide()
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/** Novice 友好的 token → 汉字估算（与 ModelSelector.ctxTooltip 保持一致：1 token ≈ 0.6 个汉字） */
function approxChars(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '未知'
  const approx = Math.round(tokens * 0.6)
  if (approx >= 10000) return `${Math.round(approx / 10000)} 万字`
  return `${approx} 字`
}

// 阈值跨越（70%/90%）时环弹跳提示
useGsap((_ctx, contextSafe) => {
  watch(statusClass, contextSafe((cls, prev) => {
    if (cls === prev || !triggerRef.value) return
    gsap.fromTo(triggerRef.value,
      { scale: 1 },
      { scale: 1.18, duration: 0.15, yoyo: true, repeat: 1, ease: 'sine.out',
        onComplete: () => gsap.set(triggerRef.value, { clearProps: 'transform' }) })
  }))
  // 百分比数字变化 tick（弹性弹跳）
  watch(pctText, contextSafe((v, old) => {
    if (v === old || !triggerRef.value) return
    const text = triggerRef.value.querySelector('.ring-text')
    if (!text) return
    gsap.fromTo(text,
      { scale: 1.35, transformOrigin: 'center center' },
      { scale: 1, duration: 0.28, ease: 'back.out(2.5)', overwrite: 'auto' })
  }))
})
</script>

<style scoped>
.context-usage-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  cursor: default;
  border-radius: 50%;
  outline: none;
}

.context-usage-ring:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

@media (max-width: 480px) {
  .context-usage-ring .acpb-text {
    display: none;
  }
}
</style>

<style>
/* DsTooltip 通过 Teleport 渲染到 body，需要全局样式控制 tooltip 内容布局 */
.usage-tooltip-content {
  min-width: 200px;
}

.usage-tooltip-content .tooltip-title {
  font-weight: 600;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
}

.usage-tooltip-content .tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
  font-size: 12px;
  line-height: 1.5;
}

.usage-tooltip-content .tooltip-row span:first-child {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.usage-tooltip-content .tooltip-row span:last-child {
  color: var(--text-primary);
  text-align: right;
}

.usage-tooltip-content .tooltip-hint {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}
</style>
