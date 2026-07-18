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
      <div v-else-if="loadError" class="empty">
        加载失败，请稍后重试。
        <div class="empty-hint">
          <button class="btn primary retry-btn" @click="loadData">重试</button>
        </div>
      </div>
      <div v-else-if="currentList.length === 0" class="empty enhanced-empty">
        <!-- Hero -->
        <div class="empty-hero">
          <svg class="empty-hero-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M24 6l4 12h12l-9.5 7 3.5 12L24 30l-10 7 3.5-12L8 18h12L24 6z" />
          </svg>
          <div class="empty-hero-text">
            <h3 v-if="activeTab === 'skills'">开始使用 Skills 技能</h3>
            <h3 v-else>开始使用宏 Macros</h3>
            <p v-if="activeTab === 'skills'">
              Skills 是可复用的任务指令模板（Markdown 格式）。当你下达任务时，Maxma 会根据上下文自动加载相关 Skill，
              让 AI 遵循你预设的工作流、规范或角色定位，无需每次重复说明。
            </p>
            <p v-else>
              宏是可复用的指令片段，可嵌入到对话或 Skill 中使用。适合保存常用 prompt、格式模板、固定回复等。
            </p>
          </div>
        </div>

        <!-- Guide cards：面向 Novice 的概念解释 -->
        <div class="guide-cards" v-if="activeTab === 'skills'">
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 4h12l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              <path d="M20 4v6h6" />
              <path d="M10 16h12M10 20h12M10 24h8" />
            </svg>
            <h4>什么是 Skill？</h4>
            <p>Skill 是一份 Markdown 文档，描述了"AI 在某类任务中应该怎么做"。例如「写周报时先列任务再总结」「代码评审时按安全/性能/可读性分项检查」等。AI 会在合适时机自动读取并遵循。</p>
          </div>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="16" cy="16" r="12" />
              <path d="M16 8v8l5 3" />
            </svg>
            <h4>何时触发？</h4>
            <p>Maxma 会根据你的对话内容、任务类型自动匹配最相关的 Skill。例如你说"帮我写周报"时，会自动加载 <code>weekly-report</code> Skill；不需要你手动 @。</p>
          </div>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8h24M4 16h24M4 24h16" />
              <circle cx="26" cy="24" r="3" fill="currentColor" stroke="none" />
            </svg>
            <h4>典型示例</h4>
            <p><strong>code-review</strong>：代码评审清单<br><strong>weekly-report</strong>：周报写作规范<br><strong>commit-message</strong>：提交信息格式<br><strong>translator</strong>：翻译风格指南</p>
          </div>
        </div>

        <div class="guide-cards" v-else>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 4h12l6 6v18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              <path d="M20 4v6h6" />
            </svg>
            <h4>什么是宏？</h4>
            <p>宏是一段可复用的指令片段，比 Skill 更轻量。适合保存「常用 prompt」「格式模板」「固定回复」，可在对话或 Skill 中通过引用复用。</p>
          </div>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 8l-8 8 8 8M20 8l8 8-8 8" />
            </svg>
            <h4>典型示例</h4>
            <p><strong>json-output</strong>：要求 AI 输出 JSON<br><strong>concise</strong>：要求简洁回复<br><strong>chinese</strong>：要求中文输出<br><strong>step-by-step</strong>：要求分步思考</p>
          </div>
        </div>

        <!-- Role guidance：面向不同画像的建议 -->
        <div class="role-guidance">
          <div class="role-card">
            <span class="role-badge">新手</span>
            <span>无需手动创建，Maxma 内置常用 Skill，开箱即用；想自定义时点击下方「+ 新建」</span>
          </div>
          <div class="role-card">
            <span class="role-badge">极客</span>
            <span>用 Markdown + YAML frontmatter 编写，支持变量、条件、引用宏；与 Claude Skills 格式兼容</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="empty-actions">
          <button class="btn primary" @click="startAdd">+ 新建 {{ activeTab === 'skills' ? 'Skill' : '宏' }}</button>
          <router-link to="/help" class="btn">了解更多</router-link>
        </div>
      </div>
      <div v-else class="card-grid">
        <template v-for="item in currentList" :key="item.id || item.name">
          <!-- Skills 卡片（新 API 格式） -->
          <div v-if="activeTab === 'skills'" class="skill-card" @click="startEdit(item)">
            <div class="card-header">
              <span class="card-label">{{ item.name }}</span>
              <span class="source-badge" :class="item.source">{{ item.source === 'builtin' ? '内置' : '自定义' }}</span>
              <button class="toggle-btn" :class="{ active: item.enabled }" @click.stop="toggleSkill(item.name)">
                {{ item.enabled ? '启用' : '禁用' }}
              </button>
            </div>
            <div v-if="item.description" class="card-desc">{{ item.description }}</div>
            <div class="card-footer">
              <span class="card-id">{{ item.name }}</span>
              <div class="card-actions" @click.stop>
                <button class="action-btn" @click.stop="startEdit(item)">编辑</button>
                <button
                  v-if="item.source === 'user'"
                  class="action-btn danger"
                  :disabled="deletingId === item.id"
                  @click.stop="deleteItem(item.id)"
                >{{ deletingId === item.id ? '删除中...' : '删除' }}</button>
                <span v-else class="readonly-hint">只读</span>
                <button class="action-btn" @click.stop="viewSkill(item.name)">查看内容</button>
              </div>
            </div>
          </div>
          <!-- Macros 卡片（旧 API 格式） -->
          <div v-else class="skill-card" @click="startEdit(item)">
            <div class="card-header">
              <span class="card-label">{{ item.name }}</span>
              <span class="source-badge" :class="item.source">{{ item.source === 'builtin' ? '内置' : '自定义' }}</span>
            </div>
            <div v-if="item.description" class="card-desc">{{ item.description }}</div>
            <div class="card-footer">
              <span class="card-id">{{ item.id }}</span>
              <div class="card-actions" @click.stop>
                <button class="action-btn" @click.stop="startEdit(item)">编辑</button>
                <button
                  v-if="item.source === 'user'"
                  class="action-btn danger"
                  :disabled="deletingId === item.id"
                  @click.stop="deleteItem(item.id)"
                >{{ deletingId === item.id ? '删除中...' : '删除' }}</button>
                <span v-else class="readonly-hint">只读</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>

    <!-- ── 表单模式（新建/编辑） ── -->
    <form v-else class="wizard-form" @submit.prevent="handleSave">
      <div v-if="loadingDetail" class="loading">加载详情中...</div>
      <template v-else>
      <div class="form-section">
        <label class="form-label">名称 (ID)</label>
        <input
          v-model="form.name"
          class="input mono"
          placeholder="例如: code-review, commit-message"
          maxlength="64"
          :disabled="isEditing"
          required
        />
        <div class="form-hint">唯一标识符，将作为目录名使用。仅允许字母、数字、连字符、下划线</div>
      </div>

      <div class="form-section">
        <label class="form-label">描述</label>
        <input
          v-model="form.description"
          class="input"
          :disabled="isEditing && editingSource === 'builtin'"
          :placeholder="`简要描述这个 ${activeTab === 'skills' ? 'Skill' : '宏'} 的用途`"
        />
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
      </template>
    </form>

    <!-- ── 内容查看模态 ── -->
    <div v-if="showContent" class="content-modal-overlay" @click.self="showContent = false">
      <div class="content-modal">
        <div class="content-modal-header">
          <span>Skill 内容</span>
          <button class="content-modal-close" @click="showContent = false">✕</button>
        </div>
        <pre class="content-modal-body">{{ skillContent }}</pre>
      </div>
    </div>

    <!-- ── 全局提示 ── -->
    <div v-if="globalMessage" class="global-message" :class="globalMessageClass">
      {{ globalMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api, getToken } from '@/api'
import { tauriFetch } from '@/utils/env'
import type { ListSkillsResponse, SkillInfo, MacroInfo } from '@/types'

type Tab = 'skills' | 'macros'
type Mode = 'list' | 'add' | 'edit'

// 与后端 _SKILL_ID_RE / _MACRO_ID_RE 同步：仅允许字母/数字/连字符/下划线（无长度限制）。
// 之前的 ID_PATTERN 允许空格和点，与后端正则不一致，会导致前端通过但后端 400 拒绝。
// 红队 R3 修复引入 {1,64} 长度限制，但后端使用 `+` 量词不限制长度，造成前端拒绝
// 后端接受的 65+ 字符 ID。此处移除长度限制以与后端契约保持一致。
const ID_PATTERN = /^[A-Za-z0-9_\-]+$/

const loading = ref(true)
const loadingDetail = ref(false)
const loadError = ref(false)
const activeTab = ref<Tab>('skills')
const mode = ref<Mode>('list')
const saving = ref(false)
const deletingId = ref('')
const saveMessage = ref('')
const saveMessageClass = ref('')
const globalMessage = ref('')
const globalMessageClass = ref('')

const editingId = ref('')
const editingSource = ref<'builtin' | 'user'>('user')

const skills = ref<SkillInfo[]>([])
const macros = ref<MacroInfo[]>([])

// ── 查看内容 ──
const skillContent = ref('')
const showContent = ref(false)

// 请求序列号：用于取消竞态请求（startEdit/loadData 快速重复触发）
let loadSeq = 0
let editSeq = 0

// setTimeout 计时器集合，组件卸载时统一清理
const timers: number[] = []
function schedule(fn: () => void, delay: number) {
  const id = window.setTimeout(() => {
    const idx = timers.indexOf(id)
    if (idx >= 0) timers.splice(idx, 1)
    fn()
  }, delay)
  timers.push(id)
}

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

function resetFormState() {
  Object.assign(form, emptyForm())
  editingId.value = ''
  editingSource.value = 'user'
  saveMessage.value = ''
  saveMessageClass.value = ''
}

function switchTab(tab: Tab) {
  activeTab.value = tab
  // 切换 tab 时彻底重置表单状态，避免残留
  mode.value = 'list'
  resetFormState()
  loadData()
}

async function loadData() {
  const mySeq = ++loadSeq
  loading.value = true
  loadError.value = false
  globalMessage.value = ''
  try {
    const [skillsData, macrosRes] = await Promise.all([
      api.listSkills(),
      api.listMacros().catch(() => ({ macros: [] })),
    ])
    // 竞态保护：丢弃过期响应
    if (mySeq !== loadSeq) return
    // 新 skills API 直接返回数组，旧格式通过 .skills 读取
    skills.value = Array.isArray(skillsData) ? skillsData : (skillsData as ListSkillsResponse).skills || []
    macros.value = macrosRes.macros
  } catch (e: unknown) {
    if (mySeq !== loadSeq) return
    loadError.value = true
    // 失败时清空旧数据，避免显示陈旧列表误导用户
    skills.value = []
    macros.value = []
    globalMessage.value = '加载失败: ' + (e instanceof Error ? e.message : String(e))
    globalMessageClass.value = 'error'
  } finally {
    if (mySeq === loadSeq) {
      loading.value = false
    }
  }
}

function startAdd() {
  resetFormState()
  mode.value = 'add'
}

async function startEdit(item: SkillInfo | MacroInfo) {
  // 竞态保护：快速点击不同卡片时，丢弃过期响应
  const mySeq = ++editSeq
  mode.value = 'edit'
  editingId.value = item.id
  editingSource.value = item.source
  saveMessage.value = ''
  loadingDetail.value = true

  try {
    const detail = activeTab.value === 'skills'
      ? await api.getSkill(item.id)
      : await api.getMacro(item.id)
    if (mySeq !== editSeq) return  // 已被后续点击取代
    Object.assign(form, {
      name: detail.name,
      description: detail.description,
      content: detail.content,
    })
  } catch (e: unknown) {
    if (mySeq !== editSeq) return
    globalMessage.value = '加载详情失败: ' + (e instanceof Error ? e.message : String(e))
    globalMessageClass.value = 'error'
    mode.value = 'list'
  } finally {
    if (mySeq === editSeq) {
      loadingDetail.value = false
    }
  }
}

function cancelForm() {
  mode.value = 'list'
  resetFormState()
}

function validateForm(): string | null {
  if (!form.name.trim()) {
    return '名称不能为空'
  }
  if (!ID_PATTERN.test(form.name)) {
    return '名称仅允许字母、数字、连字符、下划线'
  }
  return null
}

async function handleSave() {
  // 防御性检查：内置项目不可编辑
  if (isEditing.value && editingSource.value === 'builtin') {
    saveMessage.value = '内置项目不可编辑'
    saveMessageClass.value = 'error'
    return
  }

  // 前端校验（与后端 regex 同步）
  if (mode.value === 'add') {
    const err = validateForm()
    if (err) {
      saveMessage.value = err
      saveMessageClass.value = 'error'
      return
    }
  }

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
    // saving 锁延迟到返回列表后再释放，避免 800ms 窗口期内重复提交
    schedule(() => {
      mode.value = 'list'
      resetFormState()
      loadData()
      saving.value = false
    }, 800)
  } catch (e: unknown) {
    saveMessage.value = '失败: ' + (e instanceof Error ? e.message : String(e))
    saveMessageClass.value = 'error'
    saving.value = false
  }
}

async function deleteItem(id: string) {
  // 防抖锁：避免快速点击重复发送 DELETE
  if (deletingId.value) return
  const label = activeTab.value === 'skills' ? 'Skill' : '宏'
  if (!confirm(`确定删除${label} "${id}" 吗？此操作不可恢复。`)) return

  deletingId.value = id
  try {
    if (activeTab.value === 'skills') {
      await api.deleteSkill(id)
    } else {
      await api.deleteMacro(id)
    }
    globalMessage.value = `已删除 ${id}`
    globalMessageClass.value = 'ok'
    schedule(() => {
      globalMessage.value = ''
      globalMessageClass.value = ''
    }, 2000)
    loadData()
  } catch (e: unknown) {
    globalMessage.value = '删除失败: ' + (e instanceof Error ? e.message : String(e))
    globalMessageClass.value = 'error'
  } finally {
    deletingId.value = ''
  }
}

// ── Skills 启用/禁用 ──
async function toggleSkill(name: string) {
  try {
    const headers: Record<string, string> = {}
    const t = getToken()
    if (t) headers['X-Maxma-Token'] = t
    // 修复：Tauri 环境下必须使用 tauriFetch（原生 fetch 会被 WebView2 拦截）；
    // 并检查 res.ok，避免后端 4xx/5xx 时前端误以为成功并刷新列表。
    const res = await tauriFetch(`/api/skills/${name}/toggle`, { method: 'POST', headers })
    if (!res.ok) {
      console.warn('[SkillsView] toggleSkill failed: HTTP', res.status)
      return
    }
    await loadData()
  } catch (e) {
    console.warn('[SkillsView] toggleSkill failed:', e instanceof Error ? e.message : String(e))
  }
}

// ── 查看 Skill 内容 ──
async function viewSkill(name: string) {
  try {
    const detail = await api.getSkill(name)
    skillContent.value = detail.content || ''
    showContent.value = true
  } catch (e) {
    console.warn('[SkillsView] viewSkill failed:', e instanceof Error ? e.message : String(e))
  }
}

onMounted(loadData)

onUnmounted(() => {
  // 清理所有未触发的 setTimeout，避免卸载后修改 reactive 状态
  timers.forEach(clearTimeout)
  timers.length = 0
  // 重置序列号，使任何残留的 Promise.resolve 也会因 seq 不匹配而被丢弃
  loadSeq++
  editSeq++
})
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

.retry-btn {
  margin-top: 12px;
  padding: 6px 16px;
  font-size: 13px;
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
  border-color: var(--accent-dark);
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
	/* ── Skills 启用/禁用按钮 ── */
.toggle-btn {
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--border, #e5e7eb);
  background: var(--bg-secondary, #f9fafb);
  color: var(--text-secondary, #6b7280);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.toggle-btn:hover {
  border-color: var(--accent);
}
.toggle-btn.active {
  background: #e8f5e9;
  color: #2e7d32;
  border-color: #2e7d32;
}

/* ── 内容查看模态 ── */
.content-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.content-modal {
  max-width: 640px;
  max-height: 80vh;
  width: 90%;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.content-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #e5e7eb);
  font-size: 14px;
  font-weight: 600;
}
.content-modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary, #9ca3af);
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
}
.content-modal-close:hover {
  background: #fee2e2;
  color: #ef4444;
}
.content-modal-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary, #1f2937);
  margin: 0;
}

/* ── 空状态增强（面向 Novice / Power Office 画像） ── */
.enhanced-empty {
  text-align: left;
  padding: 32px 28px !important;
  max-width: 880px;
  margin: 0 auto;
}

.empty-hero {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 28px;
}
.empty-hero-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  color: var(--accent);
}
.empty-hero-text h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
}
.empty-hero-text p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ── 引导卡片 ── */
.guide-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
@media (max-width: 900px) {
  .guide-cards { grid-template-columns: 1fr; }
}
.guide-card {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-card);
}
.guide-card-icon {
  width: 28px;
  height: 28px;
  color: var(--accent);
  margin-bottom: 8px;
}
.guide-card h4 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.guide-card p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.guide-card code,
.guide-card strong {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 600;
}
.guide-card code {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  background: var(--bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
}

/* ── 角色引导 ── */
.role-guidance {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  padding: 12px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--bg-secondary, #f9fafb) 50%, transparent);
}
.role-card {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.role-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary, #fff);
  letter-spacing: 0.3px;
}

/* ── 操作按钮 ── */
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.empty-actions .btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
