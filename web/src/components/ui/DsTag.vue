<template>
  <label class="ds-tag" :class="[color]">
    <slot />
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ color?: 'ok' | 'warn' | 'error' | 'info' | 'neutral' }>(), { color: 'neutral' })
</script>

<style scoped>
.ds-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 100px; font-size: var(--fs-hint);
  font-weight: 500; line-height: 1.4; white-space: nowrap;
}
.ds-tag.neutral { background: var(--bg-secondary); color: var(--text-secondary); }
.ds-tag.ok { background: color-mix(in srgb, var(--status-ok) 10%, var(--bg-card)); color: var(--status-ok); }
.ds-tag.warn { background: color-mix(in srgb, var(--status-warn) 10%, var(--bg-card)); color: var(--status-warn); }
.ds-tag.error { background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card)); color: var(--status-error); }
.ds-tag.info { background: color-mix(in srgb, var(--status-info) 10%, var(--bg-card)); color: var(--status-info); }
</style>
