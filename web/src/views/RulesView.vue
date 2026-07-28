<template>
  <div class="rules-view">
    <div class="header">
      <div class="header-top">
        <div>
          <h2>质量规则 RULES</h2>
          <p class="header-sub">OMP 内置语言特定质量规则</p>
        </div>
        <button class="btn-create" @click="openCreateDialog">+ 新建规则</button>
      </div>
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
        <span>{{ customCount }} 条自定义</span>
      </div>

      <!-- 规则列表 -->
      <div class="rules-list">
        <div v-for="rule in filteredRules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
          <div class="rule-header">
            <span class="rule-severity" :class="`sev-${rule.severity}`">{{ severityLabel(rule.severity) }}</span>
            <span class="rule-name">{{ rule.name }}</span>
            <span v-if="rule.source === 'custom'" class="rule-source-badge">自定义</span>
            <span class="rule-lang">{{ langLabel(rule.language) }}</span>
            <!-- 启用/禁用切换 -->
            <button
              class="toggle-btn"
              :class="{ on: rule.enabled }"
              :title="rule.enabled ? '禁用' : '启用'"
              @click="handleToggle(rule)"
            >
              <span class="toggle-knob" />
            </button>
          </div>
          <div class="rule-desc">{{ rule.description }}</div>
          <div v-if="rule.pattern" class="rule-pattern"><code>{{ rule.pattern }}</code></div>
          <!-- 自定义规则操作按钮 -->
          <div v-if="rule.editable" class="rule-actions">
            <button class="action-btn edit" @click="openEditDialog(rule)">编辑</button>
            <button class="action-btn delete" @click="handleDelete(rule)">删除</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 新建/编辑对话框 -->
    <div v-if="dialogVisible" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog">
        <h3>{{ isEditing ? '编辑规则' : '新建规则' }}</h3>
        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label>规则名称 *</label>
            <input v-model="form.name" required maxlength="100" placeholder="例如：禁止 console.log" />
          </div>
          <div class="form-group">
            <label>描述 *</label>
            <textarea v-model="form.description" required maxlength="500" rows="3" placeholder="规则说明" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>语言 *</label>
              <select v-model="form.language" required>
                <option value="python">Python</option>
                <option value="typescript">TypeScript</option>
                <option value="general">通用</option>
                <option value="rust">Rust</option>
                <option value="shell">Shell</option>
                <option value="go">Go</option>
                <option value="java">Java</option>
              </select>
            </div>
            <div class="form-group">
              <label>严重级别</label>
              <select v-model="form.severity">
                <option value="error">错误</option>
                <option value="warning">警告</option>
                <option value="info">建议</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>匹配模式 (Pattern)</label>
            <input v-model="form.pattern" maxlength="1000" placeholder="正则表达式或匹配模式（可选）" />
          </div>
          <div class="form-group checkbox-group">
            <label>
              <input type="checkbox" v-model="form.enabled" />
              启用
            </label>
          </div>
          <div v-if="dialogError" class="dialog-error">{{ dialogError }}</div>
          <div class="dialog-actions">
            <button type="button" class="btn-cancel" @click="closeDialog">取消</button>
            <button type="submit" class="btn-submit" :disabled="submitting">
              {{ submitting ? '提交中...' : (isEditing ? '保存' : '创建') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'

interface Rule {
  id: string
  language: string
  name: string
  description: string
  severity: 'error' | 'warning' | 'info'
  pattern: string
  enabled: boolean
  source: 'builtin' | 'custom'
  editable: boolean
}

const loading = ref(true)
const error = ref('')
const rules = ref<Rule[]>([])
const activeLang = ref('')

// Dialog state
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const submitting = ref(false)
const dialogError = ref('')

const form = reactive({
  name: '',
  description: '',
  language: 'python',
  severity: 'warning' as 'error' | 'warning' | 'info',
  pattern: '',
  enabled: true,
})

const languages = computed(() => [...new Set(rules.value.map(r => r.language))].sort())
const filteredRules = computed(() =>
  activeLang.value ? rules.value.filter(r => r.language === activeLang.value) : rules.value
)
const enabledCount = computed(() => filteredRules.value.filter(r => r.enabled).length)
const customCount = computed(() => rules.value.filter(r => r.source === 'custom').length)

onMounted(() => {
  fetchRules()
})

async function fetchRules() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.request<{ rules: Rule[] }>('/rules')
    rules.value = res.rules
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  isEditing.value = false
  editingId.value = ''
  dialogError.value = ''
  form.name = ''
  form.description = ''
  form.language = 'python'
  form.severity = 'warning'
  form.pattern = ''
  form.enabled = true
  dialogVisible.value = true
}

function openEditDialog(rule: Rule) {
  isEditing.value = true
  editingId.value = rule.id
  dialogError.value = ''
  form.name = rule.name
  form.description = rule.description
  form.language = rule.language
  form.severity = rule.severity
  form.pattern = rule.pattern || ''
  form.enabled = rule.enabled
  dialogVisible.value = true
}

function closeDialog() {
  dialogVisible.value = false
}

async function handleSubmit() {
  submitting.value = true
  dialogError.value = ''
  try {
    if (isEditing.value) {
      await api.updateRule(editingId.value, {
        name: form.name,
        description: form.description,
        language: form.language,
        severity: form.severity,
        pattern: form.pattern,
        enabled: form.enabled,
      })
    } else {
      await api.createRule({
        name: form.name,
        description: form.description,
        language: form.language,
        severity: form.severity,
        pattern: form.pattern,
        enabled: form.enabled,
      })
    }
    closeDialog()
    await fetchRules()
  } catch (e) {
    dialogError.value = toErrorMessage(e)
  } finally {
    submitting.value = false
  }
}

async function handleToggle(rule: Rule) {
  try {
    await api.toggleRule(rule.id, !rule.enabled)
    rule.enabled = !rule.enabled
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}

async function handleDelete(rule: Rule) {
  if (!confirm(`确定删除规则「${rule.name}」？`)) return
  try {
    await api.deleteRule(rule.id)
    await fetchRules()
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}

function langLabel(lang: string): string {
  const labels: Record<string, string> = {
    python: 'Python', typescript: 'TypeScript', general: '通用',
    rust: 'Rust', shell: 'Shell', go: 'Go', java: 'Java',
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
.header-top { display: flex; align-items: flex-start; justify-content: space-between; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.loading { text-align: center; padding: 40px; color: var(--text-tertiary); }
.error-banner { padding: 10px 12px; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px; font-size: 0.85em; margin-bottom: 12px; }

.btn-create {
  padding: 8px 16px; background: var(--accent); color: white; border: none;
  border-radius: var(--radius); font-size: 0.82em; font-weight: 500;
  cursor: pointer; white-space: nowrap; transition: opacity 0.15s;
}
.btn-create:hover { opacity: 0.85; }

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
.rule-source-badge {
  font-size: 0.65em; padding: 2px 6px; border-radius: 4px;
  background: rgba(16,185,129,0.1); color: #10b981; font-weight: 500;
}
.rule-lang { font-size: 0.72em; padding: 2px 6px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-tertiary); }
.rule-desc { font-size: 0.82em; color: var(--text-secondary); line-height: 1.5; }
.rule-pattern { margin-top: 4px; font-size: 0.78em; color: var(--text-tertiary); }
.rule-pattern code { background: var(--bg-secondary); padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }

/* Toggle switch */
.toggle-btn {
  position: relative; width: 34px; height: 18px; border-radius: 9px;
  background: var(--border); border: none; cursor: pointer; transition: background 0.2s;
  flex-shrink: 0;
}
.toggle-btn.on { background: var(--accent); }
.toggle-knob {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
  border-radius: 50%; background: white; transition: transform 0.2s;
}
.toggle-btn.on .toggle-knob { transform: translateX(16px); }

/* Rule actions */
.rule-actions { display: flex; gap: 8px; margin-top: 8px; }
.action-btn {
  padding: 4px 10px; font-size: 0.75em; border-radius: 4px;
  border: 1px solid var(--border); background: var(--bg-secondary);
  color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.action-btn.edit:hover { border-color: var(--accent); color: var(--accent); }
.action-btn.delete:hover { border-color: #ef4444; color: #ef4444; }

/* Dialog */
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.dialog {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px;
  padding: 24px; width: 90%; max-width: 480px; max-height: 85vh; overflow-y: auto;
}
.dialog h3 { margin: 0 0 16px; font-size: 1.1em; font-weight: 600; color: var(--text-primary); }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 0.8em; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }
.form-group input, .form-group textarea, .form-group select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.85em;
  box-sizing: border-box;
}
.form-group textarea { resize: vertical; }
.form-row { display: flex; gap: 12px; }
.form-row .form-group { flex: 1; }
.checkbox-group label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.checkbox-group input[type="checkbox"] { width: auto; }
.dialog-error { padding: 8px 10px; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px; font-size: 0.8em; margin-bottom: 12px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.btn-cancel {
  padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer; font-size: 0.82em;
}
.btn-submit {
  padding: 8px 20px; border: none; border-radius: 6px;
  background: var(--accent); color: white; cursor: pointer; font-size: 0.82em; font-weight: 500;
}
.btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
