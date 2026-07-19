<template>
  <div class="context-usage-badge" :class="statusClass" @mouseenter="showDetail = true" @mouseleave="showDetail = false">
    <span class="usage-icon">📊</span>
    <span class="usage-text">{{ displayText }}</span>
    <div class="usage-bar">
      <div ref="fillRef" class="usage-bar-fill"></div>
    </div>
    <span class="usage-pct">{{ usage.percentage.toFixed(1) }}%</span>
    <div v-if="showDetail" class="usage-tooltip">
      <div class="tooltip-header">上下文用量（token ≈ 0.6 个汉字）</div>
      <div class="tooltip-row"><span>模型</span><span>{{ usage.modelName || '-' }}</span></div>
      <div class="tooltip-row"><span>已用</span><span>{{ formatNum(usage.estimatedTokens) }} tokens（约 {{ approxChars(usage.estimatedTokens) }}）</span></div>
      <div class="tooltip-row"><span>上限</span><span>{{ formatNum(usage.maxTokens) }} tokens（约 {{ approxChars(usage.maxTokens) }}）</span></div>
      <div class="tooltip-row"><span>消息数</span><span>{{ usage.messageCount }}</span></div>
      <div class="tooltip-hint">💡 上下文窗口是模型一次对话能处理的最大文本长度，包括你的输入和 AI 的回复。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const showDetail = ref(false)

const usage = computed(() => store.contextUsage)
const barPercent = computed(() => Math.min(usage.value.percentage, 100))
const displayText = computed(() => `${formatNum(usage.value.estimatedTokens)} / ${formatNum(usage.value.maxTokens)}`)
const statusClass = computed(() => {
  if (usage.value.percentage > 90) return 'status-critical'
  if (usage.value.percentage > 70) return 'status-warn'
  return ''
})

// CSP-safe CSSOM: set width via element.style.setProperty
const fillRef = ref<HTMLElement>()
watchEffect(() => {
  const el = fillRef.value
  const p = barPercent.value
  if (el) el.style.setProperty('width', `${p}%`)
}, { flush: 'post' })

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
</script>

<style scoped>
.context-usage-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--text-secondary); cursor: default; position: relative; font-family: 'SF Mono', 'Consolas', monospace; white-space: nowrap; }
.context-usage-badge:hover { background: var(--bg-secondary); }
.usage-icon { font-size: 13px; }
.usage-bar { width: 40px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; }
.usage-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s ease; }
.status-warn .usage-bar-fill { background: var(--status-warn); }
.status-critical .usage-bar-fill { background: var(--status-error); }
.usage-pct { font-size: 11px; min-width: 32px; text-align: right; }
.usage-tooltip { position: absolute; top: calc(100% + 6px); right: 0; z-index: 100; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; min-width: 220px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
.tooltip-header { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.tooltip-row { display: flex; justify-content: space-between; gap: 24px; padding: 3px 0; font-size: 12px; }
.tooltip-row span:first-child { color: var(--text-secondary); }
.tooltip-row span:last-child { color: var(--text-primary); font-weight: 500; }
.tooltip-hint { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-tertiary); line-height: 1.4; }
</style>
