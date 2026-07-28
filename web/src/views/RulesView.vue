<template>
  <div class="rules-view">
    <div class="header">
      <h2>质量规则 RULES</h2>
      <p class="header-sub">OMP 内置语言特定质量规则</p>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>
    <template v-else>
      <!-- 语言过滤 -->
      <div class="filter-bar">
        <button
          v-for="lang in languages"
          :key="lang"
          class="filter-chip"
          :class="{ active: activeLang === lang }"
          @click="activeLang = activeLang === lang ? '' : lang"
        >
          {{ langLabel(lang) }}
        </button>
      </div>

      <!-- 统计 -->
      <div class="stats">
        <span>{{ filteredRules.length }} 条规则</span>
        <span>{{ enabledCount }} 条启用</span>
      </div>

      <!-- 规则列表 -->
      <div class="rules-list">
        <div v-for="rule in filteredRules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
          <div class="rule-header">
            <span class="rule-severity" :class="`sev-${rule.severity}`">{{ severityLabel(rule.severity) }}</span>
            <span class="rule-name">{{ rule.name }}</span>
            <span class="rule-lang">{{ langLabel(rule.language) }}</span>
          </div>
          <div class="rule-desc">{{ rule.description }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'

interface Rule {
  id: string
  language: string
  name: string
  description: string
  severity: 'error' | 'warning' | 'info'
  enabled: boolean
}

const loading = ref(true)
const error = ref('')
const rules = ref<Rule[]>([])
const activeLang = ref('')

const languages = computed(() => [...new Set(rules.value.map(r => r.language))].sort())
const filteredRules = computed(() =>
  activeLang.value ? rules.value.filter(r => r.language === activeLang.value) : rules.value
)
const enabledCount = computed(() => filteredRules.value.filter(r => r.enabled).length)

onMounted(async () => {
  try {
    const res = await api.request<{ rules: Rule[] }>('/rules')
    rules.value = res.rules
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
})

function langLabel(lang: string): string {
  const labels: Record<string, string> = {
    python: 'Python', typescript: 'TypeScript', general: '通用',
    rust: 'Rust', shell: 'Shell',
  }
  return labels[lang] || lang
}

function severityLabel(sev: string): string {
  const labels: Record<string, string> = { error: '错误', warning: '警告', info: '建议' }
  return labels[sev] || sev
}
</script>

<style scoped>
.rules-view { max-width: 800px; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.loading { text-align: center; padding: 40px; color: var(--text-tertiary); }
.error-banner { padding: 10px 12px; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px; font-size: 0.85em; margin-bottom: 12px; }

.filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.filter-chip {
  padding: 5px 14px; border: 1px solid var(--border); border-radius: 16px;
  background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer;
  font-size: 0.8em; transition: all 0.15s;
}
.filter-chip.active { background: var(--accent); color: white; border-color: var(--accent); }

.stats { font-size: 0.8em; color: var(--text-tertiary); margin-bottom: 12px; display: flex; gap: 16px; }

.rules-list { display: flex; flex-direction: column; gap: 8px; }
.rule-card {
  padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); transition: opacity 0.15s;
}
.rule-card.disabled { opacity: 0.5; }
.rule-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.rule-severity { font-size: 0.7em; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
.sev-error { background: rgba(239,68,68,0.1); color: #ef4444; }
.sev-warning { background: rgba(245,158,11,0.1); color: #f59e0b; }
.sev-info { background: rgba(59,130,246,0.1); color: #3b82f6; }
.rule-name { font-weight: 600; font-size: 0.9em; color: var(--text-primary); flex: 1; }
.rule-lang { font-size: 0.72em; padding: 2px 6px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-tertiary); }
.rule-desc { font-size: 0.82em; color: var(--text-secondary); line-height: 1.5; }
</style>
