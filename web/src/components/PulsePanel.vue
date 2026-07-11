<template>
  <section class="pulse-panel" aria-label="运行状态">
    <button class="pulse-toggle" type="button" :aria-expanded="!collapsed" aria-controls="pulse-details" @click="toggle">
      <span class="pulse-heading"><span class="pulse-dot" :class="overallStatus"></span><span>运行状态</span></span>
      <span class="pulse-summary">{{ summary }}</span>
      <span class="pulse-chevron" :class="{ expanded: !collapsed }" aria-hidden="true">›</span>
    </button>
    <div v-if="!collapsed" id="pulse-details" class="pulse-details" aria-live="polite">
      <div v-for="item in items" :key="item.id" class="pulse-item">
        <span class="pulse-dot" :class="item.component.status"></span>
        <div class="pulse-copy"><span class="pulse-label">{{ item.label }}</span><span class="pulse-detail">{{ item.detail }}</span></div>
      </div>
      <p v-if="health.timestamp" class="pulse-updated">更新于 {{ updatedAt }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ComponentHealth, HealthResponse } from '@/types'
import { diagnosticMessage, retryMessage } from '@/utils/providerDiagnostics'

const STORAGE_KEY = 'maxma.pulse.collapsed'
const props = defineProps<{ health: HealthResponse }>()

interface PulseItem { id: string; label: string; component: ComponentHealth; detail: string }

function initialCollapsed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
}

const collapsed = ref(initialCollapsed())
const providerHealth = computed<ComponentHealth>(() => {
  const providers = Object.values(props.health.providers ?? {})
  if (!providers.length) return props.health.llm
  return providers.find(provider => provider.status === 'error')
    ?? providers.find(provider => provider.status === 'degraded')
    ?? providers[0]
})
const items = computed<PulseItem[]>(() => [
  makeItem('provider', '模型提供商', providerHealth.value),
  makeItem('ltm', '长期记忆', props.health.ltm ?? props.health.memory),
  makeItem('mcp', 'MCP 服务', props.health.mcp_tools),
  makeItem('execution', '执行环境', props.health.native_tools),
])
const overallStatus = computed(() => items.value.some(item => item.component.status === 'error')
  ? 'error' : items.value.some(item => item.component.status === 'degraded') ? 'degraded' : 'ok')
const summary = computed(() => {
  const attention = items.value.filter(item => item.component.status !== 'ok').length
  return attention ? `${attention} 项需要关注` : '运行正常'
})
const updatedAt = computed(() => new Date(props.health.timestamp * 1000).toLocaleTimeString())

function makeItem(id: string, label: string, component: ComponentHealth): PulseItem {
  const diagnostic = diagnosticMessage(component)
  const retry = retryMessage(component.retry_at)
  const latency = component.latency_ms == null ? null : `${component.latency_ms.toFixed(0)}ms`
  const status = component.status === 'ok' ? '正常' : component.status === 'degraded' ? '受限' : '不可用'
  return { id, label, component, detail: [status, diagnostic, retry, latency].filter(Boolean).join(' · ') }
}

function toggle() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(STORAGE_KEY, String(collapsed.value)) } catch { /* no persistent storage */ }
}
</script>

<style scoped>
.pulse-panel { margin-top: auto; border-top: 1px solid var(--border); padding-top: 12px; }
.pulse-toggle { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; align-items: center; width: 100%; border: 0; background: transparent; color: var(--text-primary); cursor: pointer; font: inherit; text-align: left; }
.pulse-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.pulse-heading, .pulse-item { display: flex; align-items: center; gap: 8px; }
.pulse-heading { min-width: 0; font-size: 12px; font-weight: 600; }
.pulse-summary, .pulse-updated { color: var(--text-tertiary); font-size: 11px; }
.pulse-chevron { color: var(--text-secondary); font-size: 18px; line-height: 1; text-align: right; transition: transform 160ms ease; }
.pulse-chevron.expanded { transform: rotate(90deg); }
.pulse-details { display: grid; gap: 8px; padding: 12px 0 2px; }
.pulse-copy { display: grid; gap: 1px; min-width: 0; }
.pulse-label { color: var(--text-secondary); font-size: 12px; }
.pulse-detail { overflow: hidden; color: var(--text-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.pulse-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; }
.pulse-dot.ok { background: var(--status-ok); }.pulse-dot.degraded { background: #d97706; }.pulse-dot.error { background: var(--status-error); }
.pulse-updated { margin: 2px 0 0 15px; }
</style>
