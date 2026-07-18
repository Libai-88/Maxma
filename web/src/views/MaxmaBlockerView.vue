<template>
  <div class="blocker-view">
    <!-- ── 列表 ── -->
    <template v-if="!showForm">
      <div class="header">
        <h2>拒止锚 <span class="subtitle">MaxmaBlocker</span></h2>
        <button class="btn btn-primary" @click="startAdd">添加</button>
      </div>

      <details class="intro-card" open>
        <summary>什么是拒止锚？什么时候需要用到？</summary>
        <div class="intro-body">
          <p>拒止锚（MaxmaBlocker）是 Maxma 的<strong>强制阻断标记</strong>——在某个目录中放置一个名为 <code>MaxmaBlocker</code> 的标记文件后，AI 的所有文件类工具就再也无法读写该目录及其所有子目录，<strong>无论白名单是否放行</strong>。</p>
          <p>可以把它理解为 AI 的"禁区铁门"：白名单是"邀请函"，拒止锚是"上锁"——上了锁的房间，邀请函也进不去。</p>
          <p><strong>典型使用场景</strong>：</p>
          <ul>
            <li>🔒 <strong>含敏感信息的财务 / 证件目录</strong>——银行流水、身份证扫描件、合同等，即使误加入白名单也不会被 AI 读取。</li>
            <li>📔 <strong>私人日记 / 心理咨询笔记目录</strong>——属于绝对隐私，不应被 AI 工具触碰。</li>
            <li>🔑 <strong>密钥 / 凭证目录</strong>——<code>.ssh</code>、<code>.aws</code>、GPG 密钥等，避免任何 AI 误读。</li>
            <li>🧪 <strong>正在实验 / 不稳定的项目目录</strong>——避免 AI 误改或误读未完成的代码。</li>
          </ul>
          <p class="intro-note">📋 与<router-link to="/path-whitelist">路径白名单</router-link>配合使用：白名单授权"可以做什么"，拒止锚划定"绝对不能做什么"。</p>
        </div>
      </details>

      <details class="rule-card">
        <summary class="rule-summary">规则说明</summary>
        <div class="rule-body">
          <p>拒止锚是一种强制安全机制，优先级高于白名单：</p>
          <ul>
            <li>在指定目录中创建 <code>MaxmaBlocker</code> 标记文件（无扩展名），AI 的所有文件工具将无法访问该目录及其所有子目录。</li>
            <li>检查时会从目标目录逐级向上查找，一旦发现任何父目录包含 <code>MaxmaBlocker</code> 文件即强制阻断。</li>
            <li>访问被拒止锚阻断时，白名单中即使有对应的放行条目也不会生效。</li>
          </ul>
          <p class="rule-note">路径白名单及完整权限规则参见设置页的「<router-link to="/path-whitelist">路径白名单</router-link>」页面。</p>
        </div>
      </details>

      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="entries.length === 0" class="empty-state">
        <div class="empty-icon">🛡️</div>
        <h3>还没有任何拒止锚</h3>
        <p class="empty-desc">当前 AI 仅受白名单约束。如果有不希望 AI 触及的敏感目录（财务 / 私人笔记 / 密钥），点击下方添加拒止锚，将目录强制阻断。</p>
        <button class="btn btn-primary" @click="startAdd">+ 添加拒止锚</button>
      </div>
      <div v-else class="entry-list">
        <div v-for="(entry, i) in entries" :key="i" class="entry-card">
          <div class="entry-body">
            <div class="entry-path">{{ entry.path }}</div>
            <div v-if="entry.description" class="entry-desc">{{ entry.description }}</div>
          </div>
          <button class="btn btn-danger" @click="confirmDelete(i)">删除</button>
        </div>
      </div>
    </template>

    <!-- ── 添加表单 ── -->
    <template v-else>
      <div class="header">
        <h2>添加拒止锚</h2>
      </div>
      <div class="form-card">
        <div class="form-section">
          <label class="form-label">目录</label>
          <div class="path-row">
            <input
              v-model="formPath"
              class="input mono"
              placeholder="输入或选择目录路径"
            />
            <button class="btn" @click="pickDir">选择目录</button>
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">描述（可选）</label>
          <input
            v-model="formDesc"
            class="input"
            placeholder="用途说明"
          />
        </div>
        <div v-if="formError" class="msg error">{{ formError }}</div>
        <div class="form-actions">
          <button class="btn" @click="cancelForm">取消</button>
          <button class="btn btn-primary" :disabled="saving || !formPath.trim()" @click="handleSave">
            {{ saving ? '创建中...' : '创建拒止锚' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { BlockerEntry } from '@/types'
import { ref, onMounted } from 'vue'

const showForm = ref(false)
const entries = ref<BlockerEntry[]>([])
const loading = ref(true)
const saving = ref(false)
const formError = ref('')
const formPath = ref('')
const formDesc = ref('')

async function loadEntries() {
  loading.value = true
  try {
    const res = await api.listBlockers()
    entries.value = res.entries
    } catch (e: unknown) {
      console.error('加载拒止锚失败', e)
  } finally {
    loading.value = false
  }
}

function startAdd() {
  formPath.value = ''
  formDesc.value = ''
  formError.value = ''
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
}

async function pickDir() {
  try {
    const res = await api.selectFolder()
    if (res.path) {
      formPath.value = res.path
      formError.value = ''
    }
  } catch (e: unknown) {
    formError.value = '选择目录失败'
  }
}

async function handleSave() {
  if (!formPath.value.trim()) return
  saving.value = true
  formError.value = ''
  try {
    await api.addBlocker({ path: formPath.value.trim(), description: formDesc.value.trim() })
    await loadEntries()
    showForm.value = false
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : '创建失败'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(i: number) {
  if (!window.confirm(`确定解除对此目录的拒止？\n${entries.value[i].path}\n\nMaxmaBlocker 标记文件将被删除。`)) return
  try {
    await api.deleteBlocker(i)
    entries.value.splice(i, 1)
  } catch (e: unknown) {
    console.error('删除失败', e)
  }
}

onMounted(loadEntries)
</script>

<style scoped>
.blocker-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.header h2 {
  font-size: 20px;
  font-weight: 700;
}
.subtitle {
  font-weight: 400;
  font-size: 14px;
  color: var(--text-tertiary);
  margin-left: 4px;
}
.loading,
.empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 40px 0;
}

/* ── Novice 引导卡片 ── */
.intro-card {
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error, #ef4444) 5%, var(--bg-card));
  border-color: color-mix(in srgb, var(--status-error, #ef4444) 25%, var(--border));
  overflow: hidden;
}
.intro-card > summary {
  padding: 12px 16px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.intro-card > summary::-webkit-details-marker { display: none; }
.intro-card > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 8px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.intro-card[open] > summary::before { transform: rotate(90deg); }
.intro-body {
  padding: 0 16px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.75;
}
.intro-body p { margin: 6px 0; }
.intro-body strong { color: var(--text-primary); }
.intro-body ul { margin: 6px 0; padding-left: 22px; }
.intro-body li { margin-bottom: 4px; }
.intro-body code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
}
.intro-note {
  margin-top: 10px !important;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-left: 3px solid var(--accent);
  border-radius: 0 6px 6px 0;
  font-size: 12.5px;
}

/* ── 空状态 ── */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error, #ef4444) 3%, var(--bg-card));
}
.empty-icon { font-size: 42px; margin-bottom: 12px; }
.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px;
}
.empty-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 0 auto 16px;
  max-width: 440px;
}

/* ── 规则说明 ── */
.rule-card {
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  overflow: hidden;
}
.rule-summary {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.rule-summary:hover {
  opacity: 0.8;
}
.rule-body {
  padding: 0 16px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.rule-body ul {
  margin: 6px 0;
  padding-left: 20px;
}
.rule-body li {
  margin-bottom: 4px;
}
.rule-body code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
}
.rule-note {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f0f5ff;
  border-radius: 6px;
  color: #1a4a8a;
  font-size: 12px;
}
.rule-note code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  background: #dbeafe;
  padding: 1px 5px;
  border-radius: 3px;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.entry-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  transition: box-shadow 0.15s;
}
.entry-card:hover {
  box-shadow: var(--shadow-sm);
}
.entry-body {
  flex: 1;
  min-width: 0;
}
.entry-path {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}
.entry-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* ── 表单 ── */
.form-card {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.path-row {
  display: flex;
  gap: 8px;
}
.path-row .input {
  flex: 1;
}
.input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-card);
  outline: none;
  transition: border-color 0.15s;
}
.input:focus {
  border-color: var(--accent);
}
.input.mono {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 13px;
}
.form-actions {
  display: flex;
  gap: 8px;
}
.msg {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.msg.error {
  background: #fee2e2;
  color: #991b1b;
}

/* ── 按钮 ── */
.btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
  white-space: nowrap;
}
.btn:hover { opacity: 0.8; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-danger {
  color: var(--status-error);
  border-color: var(--status-error);
}
</style>
