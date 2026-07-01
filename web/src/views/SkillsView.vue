<template>
  <div class="skills-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>Skills & 宏</h2>
      <div class="header-actions">
        <div class="tab-switcher">
          <button class="tab-btn" :class="{ active: activeTab === 'skills' }" @click="switchTab('skills')">Skills</button>
          <button class="tab-btn" :class="{ active: activeTab === 'macros' }" @click="switchTab('macros')">宏 Macros</button>
        </div>
        <button v-if="mode === 'list'" class="btn primary" @click="startAdd">+ 新建</button>
        <button v-else class="btn" @click="cancelForm">← 返回列表</button>
      </div>
    </div>

    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="currentList.length === 0" class="empty">
        <template v-if="activeTab === 'skills'">
          尚未创建任何 Skill。点击上方按钮新建。
          <div class="empty-hint">Skills 是可复用的任务指令模板，Maxma 在需要时会自动读取并遵循。</div>
        </template>
        <template v-else>
          尚未创建任何宏。点击上方按钮新建。
          <div class="empty-hint">宏是可复用的指令片段，可嵌入到对话或 Skill 中使用。</div>
        </template>
      </div>
      <div v-else class="card-grid">
        <div v-for="item in currentList" :key="item.id" class="skill-card" @click="startEdit(item)">
          <div class="card-header">
            <span class="card-label">{{ item.name }}</span>
            <span class="source-badge" :class="item.source">{{ item.source === 'builtin' ? '内置' : '自定义' }}</span>
          </div>
          <div v-if="item.description" class="card-desc">{{ item.description }}</div>
          <div class="card-footer">
            <span class="card-id">{{ item.id }}</span>
            <div class="card-actions" @click.stop>
              <button class="action-btn" @click="startEdit(item)">编辑</button>
              <button
                v-if="item.source === 'user'"
                class="action-btn danger"
                @click="deleteItem(item.id)"
              >删除</button>
              <span v-else class="readonly-hint">只读</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 表单模式（新建/编辑） ── -->
    <form v-else class="wizard-form" @submit.prevent="handleSave">
      <div class="form-section">
        <label class="form-label">名称 (ID)</label>
        <input
          v-model="form.name"
          class="input mono"
          placeholder="例如: code-review, commit-message"
          :disabled="isEditing"
          required
        />
        <div class="form-hint">唯一标识符，将作为目录名使用</div>
      </div>

      <div class="form-section">
        <label class="form-label">描述</label>
        <input v-model="form.description" class="input" :disabled="isEditing && editingSource === 'builtin'" placeholder="简要描述这个 {{ activeTab === 'skills' ? 'Skill' : '宏' }} 的用途" />
      </div>

      <div class="form-section content-section">
        <label class="form-label">内容 (Markdown)</label>
        <textarea
          v-model="form.content"
          class="content-editor mono"
          :disabled="isEditing && editingSource === 'builtin'"
          :placeholder="activeTab === 'skills'
            ? '---\nname: my-skill\ndescription: 描述\n---\n\n# My Skill\n\n## 步骤\n1. ...\n2. ...'
            : '---\nname: my-macro\ndescription: 描述\n---\n\n# My Macro\n\n指令内容...'"
          rows="20"
        ></textarea>
        <div class="form-hint">
          {{ activeTab === 'skills' ? 'Skill' : '宏' }} 的完整 Markdown 内容，包含 YAML frontmatter。
          <template v-if="isEditing && editingSource === 'builtin'">
            <strong class="warn-text">内置项目不可编辑。</strong>
          </template>
        </div>
      </div>

      <!-- 保存按钮 -->
      <div class="form-actions">
        <button type="submit" class="btn primary" :disabled="saving || (isEditing && editingSource === 'builtin')">
          {{ saving ? '保存中...' : (isEditing ? '保存修改' : '创建') }}
        </button>
        <span v-if="saveMessage" class="save-msg" :class="saveMessageClass">{{ saveMessage }}</span>
      </div>
    </form>

    <!-- ── 全局提示 ── -->
    <div v-if="globalMessage" class="global-message" :class="globalMessageClass">
      {{ globalMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '@/api'
import type { SkillInfo, MacroInfo } from '@/types'

type Tab = 'skills' | 'macros'
type Mode = 'list' | 'add' | 'edit'

const loading = ref(true)
const activeTab = ref<Tab>('skills')
const mode = ref<Mode>('list')
const saving = ref(false)
const saveMessage = ref('')
const saveMessageClass = ref('')
const globalMessage = ref('')
const globalMessageClass = ref('')

const editingId = ref('')
const editingSource = ref<'builtin' | 'user'>('user')

const skills = ref<SkillInfo[]>([])
const macros = ref<MacroInfo[]>([])

const emptyForm = () => ({
  name: '',
  description: '',
  content: '',
})

const form = reactive(emptyForm())

const isEditing = computed(() => mode.value === 'edit')

const currentList = computed(() => {
  return activeTab.value === 'skills' ? skills.value : macros.value
})

function switchTab(tab: Tab) {
  activeTab.value = tab
  if (mode.value !== 'list') {
    mode.value = 'list'
  }
  loadData()
}

async function loadData() {
  loading.value = true
  globalMessage.value = ''
  try {
    const [skillsRes, macrosRes] = await Promise.all([
      api.listSkills(),
      api.listMacros(),
    ])
    skills.value = skillsRes.skills
    macros.value = macrosRes.macros
  } catch (e: any) {
    globalMessage.value = '加载失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
  } finally {
    loading.value = false
  }
}

function startAdd() {
  Object.assign(form, emptyForm())
  mode.value = 'add'
  editingId.value = ''
  editingSource.value = 'user'
  saveMessage.value = ''
}

async function startEdit(item: SkillInfo | MacroInfo) {
  mode.value = 'edit'
  editingId.value = item.id
  editingSource.value = item.source
  saveMessage.value = ''

  try {
    const detail = activeTab.value === 'skills'
      ? await api.getSkill(item.id)
      : await api.getMacro(item.id)
    Object.assign(form, {
      name: detail.name,
      description: detail.description,
      content: detail.content,
    })
  } catch (e: any) {
    globalMessage.value = '加载详情失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
    mode.value = 'list'
  }
}

function cancelForm() {
  mode.value = 'list'
  saveMessage.value = ''
}

async function handleSave() {
  saving.value = true
  saveMessage.value = ''
  saveMessageClass.value = ''

  try {
    if (mode.value === 'add') {
      if (activeTab.value === 'skills') {
        await api.createSkill({
          name: form.name,
          description: form.description,
          content: form.content || undefined,
        })
      } else {
        await api.createMacro({
          name: form.name,
          description: form.description,
          content: form.content || undefined,
        })
      }
      saveMessage.value = '创建成功'
      saveMessageClass.value = 'ok'
    } else {
      if (activeTab.value === 'skills') {
        await api.updateSkill(editingId.value, {
          description: form.description,
          content: form.content,
        })
      } else {
        await api.updateMacro(editingId.value, {
          description: form.description,
          content: form.content,
        })
      }
      saveMessage.value = '保存成功'
      saveMessageClass.value = 'ok'
    }
    setTimeout(() => {
      mode.value = 'list'
      loadData()
    }, 800)
  } catch (e: any) {
    saveMessage.value = '失败: ' + (e?.message || String(e))
    saveMessageClass.value = 'error'
  } finally {
    saving.value = false
  }
}

async function deleteItem(id: string) {
  const label = activeTab.value === 'skills' ? 'Skill' : '宏'
  if (!confirm(`确定删除${label} "${id}" 吗？此操作不可恢复。`)) return
  try {
    if (activeTab.value === 'skills') {
      await api.deleteSkill(id)
    } else {
      await api.deleteMacro(id)
    }
    globalMessage.value = `已删除 ${id}`
    globalMessageClass.value = 'ok'
    setTimeout(() => { globalMessage.value = '' }, 2000)
    loadData()
  } catch (e: any) {
    globalMessage.value = '删除失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
  }
}

onMounted(loadData)
</script>

<style scoped>
.skills-view {
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── Tab 切换 ── */
.tab-switcher {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.tab-btn {
  padding: 6px 14px;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tab-btn:first-child {
  border-right: 1px solid var(--border);
}

.tab-btn.active {
  background: var(--accent);
  color: #fff;
}

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading, .empty {
  color: var(--text-secondary);
  padding: 40px 0;
  text-align: center;
}
.empty-hint {
  font-size: 13px;
  margin-top: 8px;
  opacity: 0.7;
}

/* ── 卡片网格 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.skill-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}

.skill-card:hover {
  border-color: var(--accent-light);
  box-shadow: var(--shadow-sm);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-label {
  font-weight: 600;
  font-size: 15px;
}

.source-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}
.source-badge.builtin {
  background: #e3f2fd;
  color: #1565c0;
}
.source-badge.user {
  background: #e8f5e9;
  color: #2e7d32;
}

.card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.card-id {
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  color: var(--text-tertiary);
}

.card-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.action-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.action-btn:hover {
  border-color: var(--accent);
}
.action-btn.danger {
  color: #d32f2f;
}
.action-btn.danger:hover {
  border-color: #d32f2f;
}

.readonly-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 4px 8px;
}

/* ── 表单 ── */
.wizard-form {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.warn-text {
  color: #d32f2f;
}

.input {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.input:focus {
  border-color: var(--accent);
}
.input.mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
}
.input:disabled {
  opacity: 0.6;
}

.content-section {
  gap: 8px;
}

.content-editor {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  min-height: 300px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
.content-editor:focus {
  border-color: var(--accent);
}

/* ── 表单操作 ── */
.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.save-msg {
  font-size: 13px;
}
.save-msg.ok { color: var(--status-ok); }
.save-msg.error { color: #d32f2f; }

/* ── 全局提示 ── */
.global-message {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}
.global-message.ok {
  background: #e8f5e9;
  color: #2e7d32;
}
.global-message.error {
  background: #ffebee;
  color: #d32f2f;
}
</style>
