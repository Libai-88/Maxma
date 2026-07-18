<template>
  <div class="whitelist-view">
    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div class="header">
        <h2>路径白名单 Path Whitelist</h2>
        <button class="btn btn-primary" @click="startAdd">添加</button>
      </div>

      <details class="intro-card" open>
        <summary>什么是路径白名单？我需要配置吗？</summary>
        <div class="intro-body">
          <p>路径白名单是 Maxma 的<strong>文件访问授权清单</strong>——只有显式列在白名单中的目录，AI 才能在工具调用中读写其中的文件。</p>
          <p><strong>不配置会怎样</strong>？默认情况下 AI 无法访问任何本地目录，所有文件类工具调用都会被拒绝。要让 AI 能读你的项目代码、整理你的文档、操作你的笔记，必须先把对应目录加入白名单。</p>
          <p><strong>建议添加的目录</strong>：</p>
          <ul>
            <li>📝 <strong>工作文档目录</strong>（如 <code>Documents</code> / <code>桌面</code>）——让 AI 能整理、检索、改写文档。</li>
            <li>💻 <strong>代码项目目录</strong>（如 <code>Code/projects</code>）——让 AI 能阅读、修改、调试你的代码。</li>
            <li>📔 <strong>笔记目录</strong>（如 Obsidian 库 / Logseq 库）——让 AI 能搜索和补充你的知识库。</li>
          </ul>
          <p class="intro-warn">⚠️ 不建议直接添加整盘根目录（如 <code>C:\</code> 或 <code>/</code>）——这会让 AI 能访问系统所有文件，违反最小权限原则。如需保护敏感目录，使用<router-link to="/maxma-blocker">拒止锚</router-link>叠加阻断。</p>
        </div>
      </details>

      <details class="rule-card">
        <summary class="rule-summary">规则说明</summary>
        <div class="rule-body">
          <p>权限检查按以下优先级判断：</p>
          <ol>
            <li><strong>拒止锚优先</strong> — 目标目录本身或任意父目录存在 <code>MaxmaBlocker</code> 标记文件时直接阻断，白名单不生效。详见<router-link to="/maxma-blocker">拒止锚</router-link>页面。</li>
            <li><strong>精确匹配</strong> — 目标目录与某条目的目录完全一致时，始终放行，不受子目录继承开关影响。</li>
            <li><strong>非递归阻断</strong> — 匹配到「仅当前目录」条目的子目录时阻断。父目录的阻断优先于子目录的递归放行。</li>
            <li><strong>递归放行</strong> — 无上方阻断时，匹配到「允许子目录」条目的子目录时放行。</li>
            <li><strong>无匹配</strong> — 以上均不满足时阻断。</li>
          </ol>
        </div>
      </details>

      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="entries.length === 0" class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>还没有任何白名单路径</h3>
        <p class="empty-desc">AI 目前无法访问任何本地目录。点击下方「添加」选择一个常用目录（文档 / 代码 / 笔记）让 AI 开始协助你。</p>
        <button class="btn btn-primary" @click="startAdd">+ 添加第一个目录</button>
      </div>
      <div v-else class="entry-list">
        <div v-for="(entry, i) in entries" :key="i" class="entry-card">
          <div class="entry-body">
            <div class="entry-path">{{ entry.path }}</div>
            <div v-if="entry.description" class="entry-desc">{{ entry.description }}</div>
            <div class="entry-recursive-tag" :class="entry.recursive ? 'recursive-yes' : 'recursive-no'">
              {{ entry.recursive ? '允许子目录' : '仅当前目录' }}
            </div>
          </div>
          <div class="entry-actions">
            <button class="btn" @click="startEdit(i)">编辑</button>
            <button class="btn btn-danger" @click="confirmDelete(i)">删除</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 表单模式 ── -->
    <template v-else>
      <div class="header">
        <h2>{{ editingIndex >= 0 ? '编辑' : '添加' }}路径</h2>
      </div>
      <div class="form-card">
        <div class="form-section">
          <label class="form-label">路径</label>
          <div class="path-row">
            <input
              v-model="formPath"
              class="input mono"
              placeholder="C:\path\to\directory"
              readonly
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
        <div class="form-section">
          <label class="form-label">子目录继承</label>
          <label class="toggle-row">
            <input type="checkbox" v-model="formRecursive" class="toggle-input" />
            <span class="toggle-slider"></span>
            <span class="toggle-label">{{ formRecursive ? '允许访问所有子目录' : '仅允许访问此目录（不含子目录）' }}</span>
          </label>
          <div class="form-hint">
            <strong>{{ formRecursive ? '✅ 已开启继承' : '⛔ 已关闭继承' }}</strong>：
            <template v-if="formRecursive">AI 可访问此目录及其下所有子目录的文件。适用于<strong>项目根目录 / 笔记库根目录</strong>——AI 能完整检索整个目录树。</template>
            <template v-else>AI 只能访问此目录下的直接文件，无法进入任何子目录。适用于<strong>只让 AI 整理某个具体文件夹</strong>，避免它触及子目录中的其他内容。</template>
          </div>
        </div>
        <div v-if="formError" class="msg error">{{ formError }}</div>
        <div class="form-actions">
          <button class="btn" @click="cancelForm">取消</button>
          <button class="btn btn-primary" :disabled="saving || !formPath.trim()" @click="handleSave">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { WhitelistEntry } from '@/types'
import { ref, onMounted } from 'vue'

const mode = ref<'list' | 'form'>('list')
const entries = ref<WhitelistEntry[]>([])
const loading = ref(true)
const saving = ref(false)
const formError = ref('')
const editingIndex = ref(-1)
const formPath = ref('')
const formDesc = ref('')
const formRecursive = ref(true)

async function loadEntries() {
  loading.value = true
  try {
    const res = await api.listWhitelist()
    entries.value = res.entries
  } catch (e: unknown) {
    console.error('加载白名单失败', e)
  } finally {
    loading.value = false
  }
}

async function pickDir() {
  try {
    const res = await api.selectFolder()
    if (res.path) {
      formPath.value = res.path
      formError.value = ''
    }
  } catch {
    formError.value = '选择目录失败'
  }
}

function startAdd() {
  editingIndex.value = -1
  formPath.value = ''
  formDesc.value = ''
  formRecursive.value = true
  formError.value = ''
  mode.value = 'form'
}

function startEdit(i: number) {
  editingIndex.value = i
  formPath.value = entries.value[i].path
  formDesc.value = entries.value[i].description || ''
  formRecursive.value = entries.value[i].recursive === true
  formError.value = ''
  mode.value = 'form'
}

function cancelForm() {
  mode.value = 'list'
}

async function handleSave() {
  if (!formPath.value.trim()) return
  saving.value = true
  formError.value = ''
  try {
    const entry = { path: formPath.value.trim(), description: formDesc.value.trim(), recursive: formRecursive.value }
    if (editingIndex.value >= 0) {
      await api.updateWhitelistEntry(editingIndex.value, entry)
    } else {
      await api.addWhitelistEntry(entry)
    }
    await loadEntries()
    mode.value = 'list'
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(i: number) {
  if (!window.confirm(`确定删除此路径？\n${entries.value[i].path}`)) return
  try {
    await api.deleteWhitelistEntry(i)
    entries.value.splice(i, 1)
  } catch (e: unknown) {
    console.error('删除失败', e)
  }
}

onMounted(loadEntries)
</script>

<style scoped>
.whitelist-view {
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
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-card));
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
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
.intro-warn {
  margin-top: 10px !important;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--status-warn, #eab308) 10%, var(--bg-primary));
  border-left: 3px solid var(--status-warn, #eab308);
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
  background: color-mix(in srgb, var(--accent) 3%, var(--bg-card));
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
  max-width: 420px;
}

/* ── 表单提示 ── */
.form-hint {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.form-hint strong { color: var(--text-primary); }
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
.entry-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
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
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
  color: var(--status-error);
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
.rule-body ol {
  margin: 6px 0;
  padding-left: 20px;
}
.rule-body li {
  margin-bottom: 4px;
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

/* ── 按钮 ── */
.btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  transition: opacity 0.15s;
}
.btn:hover { opacity: 0.8; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
.btn-danger {
  color: var(--status-error);
  border-color: var(--status-error);
}

/* ── 递归标签 ── */
.entry-recursive-tag {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  margin-top: 4px;
}
.recursive-yes {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
  color: var(--status-ok);
}
.recursive-no {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
  color: var(--status-warn);
}

/* ── Toggle 开关 ── */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.toggle-input {
  display: none;
}
.toggle-slider {
  position: relative;
  width: 40px;
  height: 22px;
  background: #d1d5db;
  border-radius: 11px;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: var(--bg-primary);
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle-input:checked + .toggle-slider {
  background: var(--accent);
}
.toggle-input:checked + .toggle-slider::after {
  transform: translateX(18px);
}
.toggle-label {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
