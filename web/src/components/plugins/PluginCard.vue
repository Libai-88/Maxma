<template>
  <div ref="rootEl" class="plugin-card" :class="{ disabled: !plugin.enabled }" @click="emit('open', plugin.name)">
    <div class="plugin-header">
      <div class="plugin-icon">🧩</div>
      <div class="plugin-info">
        <div class="plugin-name">{{ plugin.name }}</div>
        <div v-if="plugin.version" class="plugin-version">v{{ plugin.version }}</div>
      </div>
      <div class="plugin-actions">
        <button
          class="toggle-btn"
          :class="{ on: plugin.enabled }"
          @click.stop="emit('toggle', plugin.name)"
          :title="plugin.enabled ? '禁用' : '启用'"
        >
          {{ plugin.enabled ? '启用' : '禁用' }}
        </button>
        <button
          class="btn-icon"
          @click.stop="emit('configure', plugin.name)"
          title="配置"
        >
          ⚙️
        </button>
        <button
          class="btn-icon btn-danger"
          @click.stop="emit('uninstall', plugin.name)"
          title="卸载"
        >
          ✕
        </button>
      </div>
    </div>
    <div v-if="plugin.description" class="plugin-desc">{{ plugin.description }}</div>
    <div v-if="plugin.tags && plugin.tags.length" class="plugin-tags">
      <span v-for="tag in plugin.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>
    <div v-if="plugin.features && plugin.features.length" class="plugin-features">
      <span v-for="feature in plugin.features" :key="feature" class="feature">{{ feature }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Plugin } from '@/types/plugin'
import { useTilt } from '@/composables/useTilt'

defineProps<{
  plugin: Plugin
}>()

const emit = defineEmits<{
  toggle: [name: string]
  configure: [name: string]
  uninstall: [name: string]
  open: [name: string]
}>()

// 3D 倾斜 hover
const rootEl = ref<HTMLElement | null>(null)
useTilt(() => rootEl.value)
</script>

<style scoped>
.plugin-card {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  will-change: transform;
  transition: box-shadow 0.25s ease, border-color 0.25s ease, background 0.2s;
  box-shadow: var(--shadow-sm);
}
.plugin-card:hover {
  box-shadow: var(--shadow-lg);
  border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
}
.plugin-card:active {
  box-shadow: var(--shadow-md);
}
  cursor: pointer;
}

.plugin-card:hover {
  border-color: var(--accent-soft);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.plugin-card.disabled {
  opacity: 0.6;
}

.plugin-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.plugin-icon {
  font-size: 1.5em;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-weight: 600;
  font-size: 0.95em;
  color: var(--text-primary);
}

.plugin-version {
  font-size: 0.75em;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.plugin-actions {
  display: flex;
  gap: 6px;
}

.toggle-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.75em;
  transition: all 0.15s;
}

.toggle-btn.on {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-icon {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.85em;
  transition: all 0.15s;
}

.btn-icon:hover {
  background: var(--bg-tertiary);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

.plugin-desc {
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.plugin-tags, .plugin-features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.tag {
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent);
}

.feature {
  font-size: 0.7em;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}
</style>
