<template>
  <div class="tool-panel">
    <div class="panel-header">工具清单</div>
    <div class="search-box">
      <input v-model="search" placeholder="搜索工具..." class="search-input" />
    </div>
    <div v-if="store.loading" class="loading">加载中...</div>
    <div v-else class="tool-list">
      <div v-for="group in filteredGroups" :key="group.category" class="tool-group">
        <div class="group-label"><Icon class="group-label-icon" :name="groupIcon(group.category)" :size="12" />{{ groupLabel(group.category) }} ({{ group.tools.length }})</div>
        <div v-for="tool in group.tools" :key="tool.name" class="tool-item" @click="selected = selected === tool.name ? null : tool.name">
          <div class="tool-header">
            <span class="tool-name">{{ tool.label || tool.name }}</span>
            <span v-if="tool.builtin" class="tool-badge">内置</span>
            <span v-else class="tool-badge custom">自定义</span>
          </div>
          <div v-if="selected === tool.name" class="tool-desc">{{ tool.description }}</div>
        </div>
      </div>
      <div v-if="filteredGroups.length === 0" class="empty">无匹配工具</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToolsStore } from '../stores/tools'
import Icon from './Icon.vue'

const store = useToolsStore()
const search = ref('')
const selected = ref<string | null>(null)

const filteredGroups = computed(() => {
  if (!search.value) return store.categories
  const q = search.value.toLowerCase()
  return store.categories
    .map(g => ({ ...g, tools: g.tools.filter(t => t.name.toLowerCase().includes(q) || t.label?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) }))
    .filter(g => g.tools.length > 0)
})

function groupLabel(cat: string): string {
  const labels: Record<string, string> = { file: '文件操作', code: '代码执行', web: '网络', memory: '记忆', config: '配置', system: '系统', mcp: 'MCP', interactive: '交互', fun: '娱乐' }
  return labels[cat] || cat
}

function groupIcon(cat: string): string {
  const icons: Record<string, string> = { file: 'folder', code: 'tool', web: 'search', memory: 'memory', config: 'settings', system: 'tool', mcp: 'tool', interactive: 'chat', fun: 'sparkles' }
  return icons[cat] || 'tool'
}

onMounted(() => { if (store.tools.length === 0) store.fetchTools() })
</script>

<style scoped>
.tool-panel { padding: 12px; }
.panel-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 8px; }
.search-box { margin-bottom: 8px; }
.search-input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; background: var(--bg-primary); color: var(--text-primary); outline: none; box-sizing: border-box; }
.search-input:focus { border-color: var(--accent); }
.loading { padding: 24px; text-align: center; font-size: 12px; color: var(--text-tertiary); }
.tool-list { overflow-y: auto; max-height: 400px; }
.tool-group { margin-bottom: 8px; }
.group-label { display: flex; align-items: center; gap: 5px; padding: 4px 0; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary); }
.group-label-icon { opacity: 0.85; }
.tool-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.tool-item:hover { background: var(--bg-secondary); }
.tool-header { display: flex; align-items: center; gap: 6px; }
.tool-name { font-size: 13px; color: var(--text-primary); font-weight: 500; }
.tool-badge { font-size: 9px; padding: 1px 6px; border-radius: 100px; background: var(--border); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.3px; }
.tool-badge.custom { background: var(--accent); color: var(--bg-primary); }
.tool-desc { margin-top: 4px; font-size: 11px; color: var(--text-secondary); line-height: 1.4; padding-left: 4px; }
.empty { padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 12px; }
</style>
