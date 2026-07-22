<template>
  <div class="health-panel" v-if="health">
    <div class="health-title">系统状态</div>
    <div class="health-items">
      <div
        v-for="item in items"
        :key="item.name"
        class="health-item"
        :title="item.tooltip"
      >
        <span class="dot" :class="item.statusClass"></span>
        <span class="label">{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComponentHealth, HealthResponse } from '@/types';
import { safeComponentHealth } from '@/utils/componentHealth';
import { diagnosticMessage, retryMessage } from '@/utils/providerDiagnostics';
import { computed } from 'vue';

const props = defineProps<{ health: HealthResponse }>()

interface HealthItem {
  name: string
  label: string
  statusClass: string
  tooltip: string
}

const items = computed<HealthItem[]>(() => {
  const h = props.health
  return [
    makeItem('AI 模型', h.llm),
    makeItem('记忆', h.memory),
    makeItem('工具', h.native_tools),
    makeItem('MCP 服务', h.mcp_tools),
  ]
})

function makeItem(label: string, c: ComponentHealth | null | undefined): HealthItem {
  const safe = safeComponentHealth(c)
  if (!safe) {
    return {
      name: label,
      label,
      statusClass: 'unknown',
      tooltip: `${label}: 状态未获取（后端接口未返回组件详情）`,
    }
  }
  const ok = safe.status === 'ok'
  const parts: string[] = []
  if (safe.latency_ms != null) parts.push(`${safe.latency_ms.toFixed(0)}ms`)
  const diagnostic = props.health.provider_diagnostics_enabled
    ? diagnosticMessage(safe)
    : null
  if (diagnostic != null) parts.push(diagnostic)
  const retry = props.health.provider_diagnostics_enabled
    ? retryMessage(safe.retry_at)
    : null
  if (retry != null) parts.push(retry)
  if (ok && safe.detail != null) parts.push(safe.detail)
  return {
    name: label,
    label,
    statusClass: safe.status,
    tooltip: `${label}: ${ok ? '正常' : safe.status === 'degraded' ? '降级' : '异常'}${parts.length ? ' — ' + parts.join(' | ') : ''}`,
  }
}
</script>

<style scoped>
.health-panel {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.health-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.health-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.health-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: help;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot.ok {
  background: var(--status-ok);
}

.dot.error {
  background: var(--status-error);
}

.dot.degraded {
  background: var(--status-warn);
}

.dot.unknown {
  background: var(--text-tertiary, #999);
}

.label {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
