<template>
  <div class="chat-header">
    <div class="header-left">
      <span class="header-avatar">{{ store.profile.avatar }}</span>
      <span class="header-name">{{ store.profile.name }}</span>
      <span class="header-divider">·</span>
      <span class="header-tags">{{ store.profile.description }} · {{ sceneShort }}</span>
    </div>
    <div class="header-right">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePersonaStore } from '../stores/persona'
const store = usePersonaStore()
const sceneShort = computed(() => {
  const s = store.profile.scene
  return s.length > 12 ? s.slice(0, 12) + '…' : s
})
</script>

<style scoped>
.chat-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--border, #e5e7eb); background: var(--bg-primary, #fff); }
.header-left { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.header-avatar { font-size: 16px; }
.header-name { font-weight: 600; color: var(--text-primary, #1f2937); }
.header-divider { color: var(--text-tertiary, #9ca3af); }
.header-tags { font-size: 11px; color: var(--text-secondary, #6b7280); }
.header-right { display: flex; align-items: center; gap: 8px; }
</style>
