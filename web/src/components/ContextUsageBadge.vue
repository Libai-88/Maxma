<template>
  <div class="hud-wrap" :class="{ expanded }">
    <button class="hud-trigger" type="button" :aria-expanded="expanded" aria-label="查看模型调用统计" @click="expanded = !expanded">
      <span class="hud-signal" :class="{ live: isLive }"><i></i><i></i><i></i></span>
      <span class="hud-primary">{{ speedLabel }}</span><span class="hud-divider"></span>
      <span class="hud-context">{{ Math.round(percentage) }}% ctx</span><span class="hud-chevron" aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>
    <div v-if="expanded" class="hud-panel" role="dialog" aria-label="模型调用统计">
      <div class="hud-panel-head"><span>本轮调用</span><span class="hud-model">{{ usage.modelName || '当前模型' }}</span></div>
      <div class="hud-grid">
        <div><strong>{{ formatNum(usage.outputTokens ?? 0) }}</strong><small>输出 tokens</small></div>
        <div><strong>{{ speedLabel }}</strong><small>输出速度</small></div>
        <div><strong>{{ formatNum(usage.inputTokens ?? usage.estimatedTokens) }}</strong><small>输入 tokens</small></div>
        <div><strong>{{ cacheLabel }}</strong><small>缓存命中</small></div>
      </div>
      <div class="hud-progress"><span :style="{ width: `${Math.min(100, Math.max(0, percentage))}%` }"></span></div>
      <div class="hud-foot"><span>上下文 {{ formatNum(usage.estimatedTokens) }} / {{ formatNum(usage.maxTokens) }}</span><span>{{ latencyLabel }}</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { normalizeContextUsage, useChatStore } from '../stores/chat'
const store = useChatStore(); const expanded = ref(false)
const usage = computed(() => normalizeContextUsage(store.contextUsage)); const percentage = computed(() => usage.value.percentage)
const isLive = computed(() => (usage.value.outputSpeed ?? 0) > 0 && !usage.value.latencyMs)
const speedLabel = computed(() => { const speed = usage.value.outputSpeed ?? 0; return speed > 0 ? `${speed.toFixed(speed >= 10 ? 0 : 1)} t/s` : '就绪' })
const cacheLabel = computed(() => usage.value.cacheHitRate == null ? '—' : `${Math.round(usage.value.cacheHitRate * 100)}%`)
const latencyLabel = computed(() => usage.value.latencyMs ? `${Math.round(usage.value.latencyMs)} ms` : '流式中')
function formatNum(value: number): string { if (!Number.isFinite(value) || value <= 0) return '0'; if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`; if (value >= 1000) return `${(value / 1000).toFixed(1)}k`; return String(Math.round(value)) }
function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') expanded.value = false }
window.addEventListener('keydown', closeOnEscape); onBeforeUnmount(() => window.removeEventListener('keydown', closeOnEscape))
</script>

<style scoped>
.hud-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
.hud-trigger { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 11px; border: 1px solid var(--border); border-radius: 9px; background: color-mix(in srgb, var(--bg-card) 92%, var(--accent)); color: var(--text-secondary); font: 600 11px/1.1 var(--font-mono, ui-monospace); cursor: pointer; transition: border-color .18s ease, background .18s ease, transform .18s ease; }
.hud-trigger:hover, .expanded .hud-trigger { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--bg-card) 82%, var(--accent)); }.hud-trigger:active { transform: scale(.97); }
.hud-signal { display: inline-flex; align-items: end; gap: 2px; height: 12px; }.hud-signal i { display: block; width: 2px; height: 5px; border-radius: 2px; background: var(--text-tertiary); }.hud-signal i:nth-child(2) { height: 8px; }.hud-signal i:nth-child(3) { height: 11px; }.hud-signal.live i { background: var(--accent); animation: hud-pulse 1s ease-in-out infinite alternate; }.hud-signal.live i:nth-child(2) { animation-delay: .12s; }.hud-signal.live i:nth-child(3) { animation-delay: .24s; }
.hud-primary { color: var(--text-primary); font-variant-numeric: tabular-nums; }.hud-divider { width: 1px; height: 13px; background: var(--border); }.hud-context { font-variant-numeric: tabular-nums; }.hud-chevron { color: var(--text-tertiary); font-size: 13px; }
.hud-panel { position: absolute; right: 0; bottom: calc(100% + 9px); width: 292px; padding: 15px; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--bg-card) 96%, var(--accent)); box-shadow: 0 12px 30px color-mix(in srgb, var(--text-primary) 14%, transparent); z-index: 30; }.hud-panel-head, .hud-foot { display: flex; justify-content: space-between; gap: 12px; align-items: center; }.hud-panel-head { color: var(--text-primary); font-size: 12px; font-weight: 700; }.hud-model, .hud-foot { color: var(--text-tertiary); font-size: 11px; font-weight: 500; }.hud-model { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.hud-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0 12px; }.hud-grid div { display: grid; gap: 3px; }.hud-grid strong { color: var(--text-primary); font: 700 15px/1 var(--font-mono, ui-monospace); font-variant-numeric: tabular-nums; }.hud-grid small { color: var(--text-tertiary); font-size: 10px; }.hud-progress { height: 5px; overflow: hidden; border-radius: 3px; background: var(--border); }.hud-progress span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width .3s ease; }.hud-foot { margin-top: 8px; }
@keyframes hud-pulse { from { opacity: .45; transform: scaleY(.72); } to { opacity: 1; transform: scaleY(1); } } @media (max-width: 480px) { .hud-context, .hud-divider { display: none; }.hud-trigger { padding: 0 8px; }.hud-panel { right: -8px; width: min(270px, calc(100vw - 28px)); } } @media (prefers-reduced-motion: reduce) { .hud-signal.live i { animation: none; } }
</style>
