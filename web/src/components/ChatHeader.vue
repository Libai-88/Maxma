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
.chat-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--bg-primary); }
.header-left { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.header-avatar { font-size: 18px; }
.header-name { font-weight: 600; color: var(--text-primary); }
.header-divider { color: var(--text-tertiary); }
.header-tags { font-size: 13px; color: var(--text-secondary); }
.header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
