<!-- web/src/components/ApprovalBubble.vue -->
<!-- 工具执行审批气泡：当 ApprovalToolNode 拦截工具调用并推送 mode='approval' 的 ask_user 事件时渲染 -->
<template>
  <div class="approval-bubble" :class="`risk-${riskLevel}`">
    <div class="approval-header">
      <span class="approval-icon">{{ riskIcon }}</span>
      <span class="approval-title">工具执行审批</span>
      <span class="approval-tool">{{ toolName }}</span>
      <span class="approval-risk-tag" :class="`risk-tag-${riskLevel}`">{{ riskLabel }}</span>
    </div>

    <div class="approval-detail">{{ detail }}</div>

    <!-- 参数预览 -->
    <details v-if="toolInput && Object.keys(toolInput).length" class="approval-params">
      <summary>参数详情</summary>
      <pre class="approval-params-content">{{ JSON.stringify(toolInput, null, 2) }}</pre>
    </details>

    <!-- 操作按钮 -->
    <div class="approval-actions" v-if="!responded">
      <button class="btn-approve" @click="onApprove">
        允许执行
      </button>
      <button class="btn-reject" @click="onReject">
        拒绝
      </button>
    </div>
    <div class="approval-responded" v-else>
      <span :class="responded === 'yes' ? 'approval-approved' : 'approval-rejected'">
        {{ responded === 'yes' ? '✓ 已批准' : '✗ 已拒绝' }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  toolName: string
  detail: string
  riskLevel: string
  toolInput?: Record<string, unknown>
  interactionId: string
}>()

// 与 AskUserBubble 一致，通过 action 事件把 user_response 传递给父组件
const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
}>()

// 本地响应状态：'yes' / 'no' / null（未响应）
const responded = ref<string | null>(null)

const riskLabels: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
}
const riskIcons: Record<string, string> = {
  high: '⚠️',
  medium: '⚡',
  low: 'ℹ️',
}

const riskLabel = riskLabels[props.riskLevel] || '未知'
const riskIcon = riskIcons[props.riskLevel] || 'ℹ️'

function onApprove() {
  if (responded.value) return
  responded.value = 'yes'
  // 复用现有 user_response action 通道，与 AskUserBubble 保持一致
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: props.interactionId,
      response: 'yes',
    },
  })
}

function onReject() {
  if (responded.value) return
  responded.value = 'no'
  emit('action', {
    action: 'user_response',
    data: {
      interactionId: props.interactionId,
      response: 'no',
    },
  })
}
</script>

<style scoped>
.approval-bubble {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin: 8px 0;
  background: var(--bg-card);
  box-shadow: var(--shadow);
}

.approval-bubble.risk-high {
  border-left: 3px solid var(--status-error);
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 5%, var(--bg-card));
}
.approval-bubble.risk-medium {
  border-left: 3px solid var(--status-warn);
}
.approval-bubble.risk-low {
  border-left: 3px solid var(--status-ok);
}

.approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.approval-icon {
  font-size: 1.1em;
}

.approval-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.9em;
}

.approval-tool {
  font-family: var(--font-mono, monospace);
  font-size: 0.8em;
  color: var(--accent);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
}

.approval-risk-tag {
  font-size: 0.72em;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: auto;
}
.risk-tag-high {
  color: var(--status-error);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
}
.risk-tag-medium {
  color: var(--status-warn);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-warn) 12%, transparent);
}
.risk-tag-low {
  color: var(--status-ok);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
}

.approval-detail {
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.approval-params {
  margin-bottom: 8px;
  font-size: 0.8em;
}

.approval-params summary {
  cursor: pointer;
  color: var(--text-tertiary);
}

.approval-params-content {
  margin-top: 4px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.approval-actions {
  display: flex;
  gap: 8px;
}

.btn-approve,
.btn-reject {
  padding: 6px 18px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.btn-approve {
  background: var(--status-ok);
  color: var(--bg-primary);
}
.btn-approve:hover {
  opacity: 0.9;
}

.btn-reject {
  background: var(--status-error);
  color: var(--bg-primary);
}
.btn-reject:hover {
  opacity: 0.9;
}

.approval-responded {
  padding: 4px 0;
}

.approval-approved {
  color: var(--status-ok);
  font-weight: 500;
  font-size: 0.88em;
}

.approval-rejected {
  color: var(--status-error);
  font-weight: 500;
  font-size: 0.88em;
}
</style>
