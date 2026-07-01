<template>
  <div v-if="usage" class="context-usage" :class="level">

    <!-- 圆环 + 用量百分比 → 用量弹窗 -->
    <span class="ring-group hover-trigger">
      <svg class="ring" viewBox="0 0 32 32">
        <circle
          class="ring-bg"
          cx="16" cy="16" r="13"
          fill="none"
          stroke-width="3"
        />
        <circle
          class="ring-fill"
          cx="16" cy="16" r="13"
          fill="none"
          stroke-width="3"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
        />
      </svg>
      <span class="label">{{ Math.round(usage.usage_percent) }}%</span>
      <div class="hover-card card-usage">
        <!-- 饼图：上下文组成概览 -->
        <div v-if="pieSegments.length > 0" class="pie-chart-container">
          <svg class="pie-chart" viewBox="0 0 36 36">
            <circle
              v-for="(seg, idx) in pieSegments"
              :key="idx"
              cx="18" cy="18" r="15.9155"
              fill="none"
              :stroke="seg.color"
              stroke-width="4"
              :stroke-dasharray="`${seg.percent} ${100 - seg.percent}`"
              :stroke-dashoffset="seg.offset"
            />
          </svg>
          <div class="pie-legend">
            <div v-for="(seg, idx) in pieSegments" :key="'l'+idx" class="pie-legend-item">
              <span class="pie-dot" :style="{ background: seg.color }"></span>
              <span class="pie-label">{{ seg.label }}</span>
              <span class="pie-value">{{ formatTokens(seg.tokens) }}</span>
            </div>
          </div>
        </div>

        <!-- 总览 -->
        <div class="breakdown-section">
          <div class="card-row breakdown-header">
            <span class="card-label">总览</span>
            <span class="card-value">{{ Math.round(usage.usage_percent) }}%</span>
          </div>
          <div class="mini-bar-track" :class="level">
            <div
              class="mini-bar-fill"
              :style="{ width: Math.min(usage.usage_percent, 100) + '%' }"
            ></div>
          </div>
          <div class="card-row breakdown-part">
            <span class="card-label indent">已用</span>
            <span class="card-value">{{ formatTokens(usage.current_tokens) }}</span>
          </div>
          <div class="card-row breakdown-part">
            <span class="card-label indent">极限</span>
            <span class="card-value">{{ formatTokens(usage.max_tokens) }}</span>
          </div>
        </div>

        <!-- 细分数据（可选） -->
        <template v-if="usage.breakdown">
          <div class="card-divider"></div>

          <!-- 系统提示词 -->
          <div class="breakdown-section">
            <div class="card-row breakdown-header">
              <span class="card-label">系统提示词</span>
              <span class="card-value">{{ formatTokens(usage.breakdown.system_prompt.total) }}</span>
            </div>
            <div class="mini-bar-track">
              <div
                class="mini-bar-fill"
                :style="{ width: usage.breakdown.system_prompt.usage_percent + '%' }"
              ></div>
            </div>
            <div
              v-for="part in usage.breakdown.system_prompt.parts"
              :key="part.key || part.label"
              class="card-row breakdown-part"
            >
              <span class="card-label indent">{{ part.label }}</span>
              <span class="card-value">{{ formatTokens(part.tokens) }}</span>
            </div>
          </div>

          <!-- 对话数据 -->
          <div class="breakdown-section">
            <div class="card-row breakdown-header">
              <span class="card-label">对话数据</span>
              <span class="card-value">{{ formatTokens(usage.breakdown.messages.total) }}</span>
            </div>
            <div class="mini-bar-track">
              <div
                class="mini-bar-fill"
                :style="{ width: usage.breakdown.messages.usage_percent + '%' }"
              ></div>
            </div>
            <div
              v-for="(part, idx) in usage.breakdown.messages.parts"
              :key="idx"
              class="card-row breakdown-part"
            >
              <span class="card-label indent">
                {{ part.label }}
                <span class="msg-count">({{ part.count }})</span>
              </span>
              <span class="card-value">{{ formatTokens(part.tokens) }}</span>
            </div>
          </div>
        </template>
      </div>
    </span>

    <!-- 模型名 → 余额弹窗 -->
    <span class="model-name hover-trigger" @mouseenter="onBalanceHover">
      {{ displayModelName }}
      <div class="hover-card card-balance">
        <template v-if="!isDeepSeek">
          <div class="balance-idle">余额查询仅支持 DeepSeek</div>
        </template>
        <template v-else-if="balanceLoading">
          <div class="balance-loading">查询中…</div>
        </template>
        <template v-else-if="balanceError">
          <div class="balance-error">{{ balanceError }}</div>
        </template>
        <template v-else-if="balanceData">
          <div
            v-for="info in balanceData.balance_infos"
            :key="info.currency"
            class="card-row"
          >
            <span class="card-label">余额 ({{ info.currency }})</span>
            <span class="card-value">{{ info.total_balance }}</span>
          </div>
          <div class="card-divider"></div>
          <div class="card-row">
            <span class="card-label">充值</span>
            <span class="card-value">{{ balanceData.balance_infos[0]?.topped_up_balance }}</span>
          </div>
          <div class="card-row">
            <span class="card-label">赠送</span>
            <span class="card-value">{{ balanceData.balance_infos[0]?.granted_balance }}</span>
          </div>
          <div class="card-divider"></div>
          <div class="card-row">
            <span class="card-label">状态</span>
            <span
              class="card-value"
              :class="balanceData.is_available ? 'status-ok' : 'status-err'"
            >{{ balanceData.is_available ? '可用' : '不可用' }}</span>
          </div>
        </template>
        <template v-else>
          <div class="balance-idle">悬停查询余额</div>
        </template>
      </div>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ContextUsage, DeepSeekBalanceResponse } from '@/types'
import { api } from '@/api'

const props = defineProps<{
  usage: ContextUsage | null
  selectedModel?: string
}>()

const displayModelName = computed(() => props.selectedModel || props.usage?.model_name || '')

const circumference = 2 * Math.PI * 13

const balanceData = ref<DeepSeekBalanceResponse | null>(null)
const balanceLoading = ref(false)
const balanceError = ref<string | null>(null)
let balanceFetched = false

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const dashOffset = computed(() => {
  if (!props.usage) return circumference
  const pct = Math.min(props.usage.usage_percent, 100)
  return circumference * (1 - pct / 100)
})

const level = computed(() => {
  if (!props.usage) return ''
  if (props.usage.usage_percent < 60) return 'safe'
  if (props.usage.usage_percent < 85) return 'warn'
  return 'danger'
})

/** 饼图分段数据 */
const pieSegments = computed(() => {
  if (!props.usage?.breakdown) return []
  const total = props.usage.current_tokens || 1
  const sysTokens = props.usage.breakdown.system_prompt.total
  const msgTokens = props.usage.breakdown.messages.total

  const segments: Array<{ label: string; tokens: number; percent: number; offset: number; color: string }> = []
  let cumPercent = 0

  // 系统提示词
  const sysPercent = (sysTokens / total) * 100
  segments.push({
    label: '系统提示词',
    tokens: sysTokens,
    percent: sysPercent,
    offset: 25 - cumPercent,
    color: '#6366f1',
  })
  cumPercent += sysPercent

  // 消息部分按类型拆分
  const colors = ['#22c55e', '#3b82f6', '#f59e0b']
  const msgParts = props.usage.breakdown.messages.parts || []
  msgParts.forEach((part, idx) => {
    const partPercent = (part.tokens / total) * 100
    segments.push({
      label: part.label,
      tokens: part.tokens,
      percent: partPercent,
      offset: 25 - cumPercent,
      color: colors[idx % colors.length],
    })
    cumPercent += partPercent
  })

  return segments
})

const isDeepSeek = computed(() => {
  return displayModelName.value.toLowerCase().includes('deepseek')
})

async function onBalanceHover() {
  if (!isDeepSeek.value) return
  if (balanceFetched || balanceLoading.value) return
  balanceFetched = true
  balanceLoading.value = true
  balanceError.value = null
  try {
    balanceData.value = await api.getDeepSeekBalance()
  } catch (e) {
    balanceError.value = (e as Error).message
  } finally {
    balanceLoading.value = false
  }
}
</script>

<style scoped>
.context-usage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  position: relative;
}
.ring {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 1px;
  transform: rotate(-90deg);
}
.ring-bg {
  stroke: var(--border);
}
.ring-fill {
  transition: stroke-dashoffset 0.5s ease, stroke 0.5s ease;
}
.safe .ring-fill {
  stroke: var(--status-ok);
}
.safe .label {
  color: var(--status-ok);
}
.warn .ring-fill {
  stroke: var(--status-warn);
}
.warn .label {
  color: var(--status-warn);
}
.danger .ring-fill {
  stroke: var(--status-error);
}
.danger .label {
  color: var(--status-error);
}
.safe .mini-bar-fill {
  background: var(--status-ok);
}
.warn .mini-bar-fill {
  background: var(--status-warn);
}
.danger .mini-bar-fill {
  background: var(--status-error);
}
.model-name {
  color: var(--text-secondary);
  opacity: 1;
}
.ring-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* hover-trigger 容器：让弹窗相对自己定位 */
.hover-trigger {
  position: relative;
  cursor: default;
}
.hover-trigger:hover .hover-card {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
}

/* 共用弹窗样式 */
.hover-card {
  visibility: hidden;
  opacity: 0;
  transform: translateY(-4px);
  transition: visibility 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 100;
  min-width: 170px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  font-size: 12px;
  line-height: 1.6;
}
.card-usage {
  min-width: 260px;
}
.card-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.card-label {
  color: var(--text-secondary);
}
.card-value {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.card-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.status-ok {
  color: var(--status-ok);
}
.status-err {
  color: var(--status-error);
}

/* 余额弹窗专用 */
.card-balance {
  left: 0;
  right: auto;
}
.balance-loading,
.balance-error,
.balance-idle {
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 0;
}
.balance-error {
  color: var(--status-error);
}

/* ── 细分展示 ── */
.breakdown-section + .breakdown-section {
  margin-top: 8px;
}
.breakdown-header .card-label {
  font-weight: 600;
  color: var(--text-primary);
}
.breakdown-part .indent {
  padding-left: 12px;
  font-size: 11px;
}
.msg-count {
  color: var(--text-tertiary, var(--text-secondary));
  font-size: 10px;
  margin-left: 2px;
}
.mini-bar-track {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin: 2px 0 4px 0;
}
.mini-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--text-secondary);
  transition: width 0.3s ease;
}

/* ── 饼图 ── */
.pie-chart-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.pie-chart {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  transform: rotate(-90deg);
}
.pie-legend {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.pie-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.pie-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pie-label {
  flex: 1;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pie-value {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>
