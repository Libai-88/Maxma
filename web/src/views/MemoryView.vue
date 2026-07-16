<template>
  <div class="memory-view">
    <div class="header"><h2>AI 记忆</h2></div>
    <div v-if="loading" class="loading">加载中...</div>
    <template v-else>
      <div v-if="store.facts.length === 0" class="empty">暂无记忆数据。与 AI 对话后，OMP 会自动记录事实。</div>
      <div v-else class="fact-list">
        <div v-for="fact in store.facts" :key="fact.id" class="fact-card">
          <div class="fact-content">{{ fact.content }}</div>
          <div class="fact-meta">
            <span class="fact-cat">{{ fact.category }}</span>
            <span class="fact-confidence">{{ (fact.confidence * 100).toFixed(0) }}%</span>
            <span class="fact-time">{{ formatTime(fact.updatedAt) }}</span>
            <button class="fact-delete" @click="store.deleteFact(fact.id)">✕</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useMemoryStore } from '../stores/memory'
const store = useMemoryStore()
function formatTime(t: string) { return t ? new Date(t).toLocaleDateString('zh-CN') : '-' }
const loading = store.loading
onMounted(() => { store.fetchFacts() })
</script>

<style scoped>
.memory-view { flex: 1; overflow-y: auto; padding: 24px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: 18px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0; }
.loading, .empty { padding: 48px; text-align: center; color: var(--text-tertiary, #9ca3af); font-size: 14px; }
.fact-list { display: flex; flex-direction: column; gap: 8px; }
.fact-card { padding: 12px 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: var(--bg-card, #fff); }
.fact-content { font-size: 14px; color: var(--text-primary, #1f2937); margin-bottom: 8px; line-height: 1.5; }
.fact-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-tertiary, #9ca3af); }
.fact-cat { padding: 1px 8px; border-radius: 100px; background: var(--bg-secondary, #f9fafb); text-transform: uppercase; letter-spacing: 0.3px; }
.fact-confidence { font-family: 'SF Mono', monospace; }
.fact-delete { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary, #9ca3af); padding: 2px 6px; border-radius: 4px; }
.fact-delete:hover { background: #fee2e2; color: #ef4444; }
</style>
