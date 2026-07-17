<template>
  <div ref="rootRef" class="bar-chart">
    <div v-if="items.length === 0" class="bar-empty">无数据</div>
    <template v-else>
      <div
        v-for="(item, idx) in normalizedItems"
        :key="`${item.label}-${idx}`"
        class="bar-row"
        :title="`${item.label}: ${item.value}`"
      >
        <div class="bar-label" :title="item.label">{{ item.label }}</div>
        <div class="bar-track">
          <div
            class="bar-fill"
            :class="{ 'bar-fill-error': item.kind === 'error' }"
            :ref="(el) => setFillRef(el, idx)"
          ></div>
        </div>
        <div class="bar-value">{{ item.display }}</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect, type ComponentPublicInstance } from 'vue'

const props = withDefaults(defineProps<{
  items: Array<{ label: string; value: number; display?: string; kind?: 'default' | 'error' }>
  height?: number
  /** 最大值（用于多图对齐），不传则自适应 */
  maxValue?: number
}>(), {
  height: 140,
})

const maxVal = computed(() => {
  if (props.items.length === 0) return 1
  if (props.maxValue !== undefined && props.maxValue > 0) return props.maxValue
  return Math.max(...props.items.map(i => i.value), 1)
})

const normalizedItems = computed(() =>
  props.items.map(item => ({
    ...item,
    display: item.display ?? String(item.value),
    percent: maxVal.value > 0 ? Math.max(2, (item.value / maxVal.value) * 100) : 0,
  })),
)

// CSP-safe CSSOM: set height + per-bar width via element.style.setProperty
// (inline style attribute would be blocked by CSP 'unsafe-inline' removal)
const rootRef = ref<HTMLElement>()
const fillEls: HTMLElement[] = []
const setFillRef = (el: Element | ComponentPublicInstance | null, idx: number) => {
  if (el) fillEls[idx] = el as HTMLElement
}

watchEffect(() => {
  const root = rootRef.value
  if (root) root.style.setProperty('height', `${props.height}px`)
  normalizedItems.value.forEach((item, idx) => {
    const el = fillEls[idx]
    if (el) el.style.setProperty('width', `${item.percent}%`)
  })
}, { flush: 'post' })
</script>

<style scoped>
.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.bar-empty {
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) 2fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  min-height: 18px;
}
.bar-label {
  color: var(--text-secondary);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar-track {
  position: relative;
  height: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.2s ease;
  min-width: 2px;
}
.bar-fill-error {
  background: var(--status-error);
}
.bar-value {
  color: var(--text-primary);
  font-weight: 600;
  font-size: 11px;
  min-width: 28px;
  text-align: right;
}
</style>
