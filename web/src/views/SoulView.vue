<template>
  <div class="md-editor-view">
    <PersonaCard class="persona-card-spacing" />
    <div class="header">
      <h2>{{ pageTitle }} <span class="subtitle">{{ pageSubtitle }}</span></h2>
      <button class="save-button" :disabled="saving || content === savedContent" @click="saveContent">
        {{ saving ? '保存中...' : '保存' }}
      </button>
      <!-- 人格选择器：始终显示（即使只有一个人格） -->
      <div class="persona-selector" v-if="personasLoaded">
        <select v-model="activeFile" @change="onPersonaChange" :disabled="loading">
          <option v-for="p in personas" :key="p.id" :value="p.file">
            {{ p.name }}{{ p.active ? ' (当前)' : '' }}
          </option>
        </select>
        <button class="btn-create-persona" @click="showCreateDialog = true" title="创建新人格">+</button>
      </div>
      <span class="save-indicator" :class="saveState">
        {{ saveStateText }}
      </span>
      <span v-if="saveError" class="save-error">保存失败：{{ saveError }}</span>
      <span v-if="!saveState && content && content !== savedContent" class="save-hint">点击编辑区域外来保存</span>
    </div>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="loadError" class="load-error">
      <p>加载失败：{{ loadError }}</p>
      <button @click="retryLoad">重试</button>
    </div>
    <div v-else class="editor-wrapper">
      <Codemirror
        v-model="content"
        :extensions="extensions"
        :disabled="saving"
        :placeholder="pagePlaceholder"
        :autofocus="false"
        :indent-with-tab="true"
        :tab-size="2"
        @blur="onBlur"
      />
    </div>

    <!-- 创建新人格弹窗 -->
    <div v-if="showCreateDialog" class="create-overlay" @click.self="showCreateDialog = false">
      <div class="create-dialog">
        <h3>创建新人格</h3>
        <div class="create-field">
          <label>名称</label>
          <input v-model="createForm.name" class="create-input" placeholder="例如: 小助手" />
        </div>
        <div class="create-field">
          <label>描述</label>
          <input v-model="createForm.description" class="create-input" placeholder="一句话描述这个人格" />
        </div>
        <div class="create-field">
          <label>记忆模式</label>
          <select v-model="createForm.memory" class="create-input">
            <option value="shared">共享记忆（所有格共用）</option>
            <option value="persona">独立记忆（专属记忆分区）</option>
          </select>
        </div>
        <div class="create-actions">
          <button class="create-btn cancel" @click="showCreateDialog = false">取消</button>
          <button class="create-btn save" :disabled="!createForm.name.trim() || creating" @click="doCreate">
            {{ creating ? '创建中...' : '创建' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { api } from '@/api'
import PersonaCard from '../components/PersonaCard.vue'
import { useMarkdownPersist } from '@/composables/useMarkdownPersist'

const props = defineProps<{
  title?: string
  subtitle?: string
  placeholder?: string
}>()

const TYPE = 'soul' as const
const pageTitle = props.title || '人设'
const pageSubtitle = props.subtitle || 'SOUL'
const pagePlaceholder = props.placeholder || '编辑人设内容...'

interface PersonaInfo {
  id: string
  file: string
  name: string
  description: string
  active: boolean
}

// personas 状态需先于 composable 声明：getVariant 闭包读取 activeFile
const personas = ref<PersonaInfo[]>([])
const personasLoaded = ref(false)
const activeFile = ref('SOUL.md')

const {
  content,
  savedContent,
  loading,
  saving,
  saveState,
  saveError,
  loadError,
  extensions,
  saveStateText,
  loadContent,
  saveContent,
  onBlur,
  retryLoad,
} = useMarkdownPersist({
  type: TYPE,
  getVariant: () => activeFile.value !== 'SOUL.md' ? activeFile.value : undefined,
})

// 创建新人格
const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = ref({
  name: '',
  description: '',
  memory: 'shared',
})

async function doCreate() {
  if (!createForm.value.name.trim() || creating.value) return
  creating.value = true
  try {
    const res = await api.createPersona({
      name: createForm.value.name.trim(),
      description: createForm.value.description.trim(),
      memory: createForm.value.memory,
    })
    showCreateDialog.value = false
    createForm.value = { name: '', description: '', memory: 'shared' }
    // 刷新人格列表并切换到新人格
    await loadPersonas()
    activeFile.value = res.file
    await onPersonaChange()
  } catch (e: any) {
    console.error('[SoulView] createPersona FAIL', e)
    alert('创建失败: ' + (e?.message || String(e)))
  } finally {
    creating.value = false
  }
}

async function loadPersonas() {
  console.log('[SoulView] loadPersonas start, type=', TYPE)
  try {
    const res = await api.listPersonas()
    console.log('[SoulView] loadPersonas OK, count=', res.personas.length, 'active=', res.active_file)
    personas.value = res.personas
    activeFile.value = res.active_file
    personasLoaded.value = true
  } catch (e) {
    console.error('[SoulView] loadPersonas FAIL', e)
    personas.value = []
    personasLoaded.value = true  // 即使失败也标记为已加载，避免选择器永远不显示
  }
}

async function onPersonaChange() {
  // 切换人格：先保存当前（如果有改动），再调用后端切换，最后加载新人格
  if (content.value !== savedContent.value) {
    await saveContent()
  }
  console.log('[SoulView] switching persona to:', activeFile.value)
  try {
    await api.switchPersona(activeFile.value)
    console.log('[SoulView] persona switched OK')
    // 更新 personas 列表中的 active 状态
    personas.value.forEach(p => { p.active = p.file === activeFile.value })
  } catch (e: any) {
    console.error('[SoulView] switchPersona FAIL', e)
    loadError.value = '切换人格失败: ' + (e?.message || String(e))
    return
  }
  await loadContent()
}

onMounted(async () => {
  if (TYPE === 'soul') {
    await loadPersonas()
  }
  await loadContent()
})
</script>

<style scoped>
.md-editor-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-shrink: 0;
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

.persona-selector select {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  outline: none;
}
.persona-selector select:hover {
  border-color: var(--accent);
}
.persona-selector select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-indicator {
  font-size: 12px;
  transition: opacity 0.3s;
}
.save-indicator.saving {
  color: var(--text-tertiary);
}
.save-indicator.saved {
  color: var(--status-ok);
}

.save-button {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.save-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.save-button:disabled { cursor: not-allowed; opacity: .5; }

.save-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  opacity: 0.8;
}

.save-error { color: var(--status-error, #c0392b); font-size: 12px; }

.loading {
  color: var(--text-secondary);
  padding: 40px 0;
  text-align: center;
}

.load-error {
  color: var(--text-secondary);
  padding: 40px 0;
  text-align: center;
}
.load-error button {
  margin-top: 12px;
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}
.load-error button:hover {
  border-color: var(--accent);
}

.editor-wrapper {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-primary);
}

.editor-wrapper :deep(.cm-editor) {
  height: 100%;
}

.editor-wrapper :deep(.cm-scroller) {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.6;
}

.editor-wrapper :deep(.cm-gutters) {
  background: var(--bg-primary);
  border-right: 1px solid var(--border);
}

.editor-wrapper :deep(.cm-gutterElement) {
  color: var(--text-tertiary);
}

.editor-wrapper :deep(.cm-content) {
  padding: 16px;
}

.editor-wrapper :deep(.cm-placeholder) {
  color: var(--text-tertiary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
}

/* ── 创建新人格按钮 ── */
.btn-create-persona {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  margin-left: 4px;
}
.btn-create-persona:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-primary);
}

/* ── 创建弹窗 ── */
.create-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.create-dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  width: 380px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}
.create-dialog h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px;
  color: var(--text-primary);
}
.create-field {
  margin-bottom: 12px;
}
.create-field label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.create-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}
.create-input:focus {
  border-color: var(--accent);
}
.create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.create-btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  font-family: inherit;
  transition: all 0.15s;
}
.create-btn.cancel {
  background: transparent;
  color: var(--text-secondary);
}
.create-btn.cancel:hover {
  background: var(--bg-secondary);
}
.create-btn.save {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.create-btn.save:hover:not(:disabled) {
  opacity: 0.9;
}
.create-btn.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.persona-card-spacing {
  margin-bottom: 16px;
}
</style>
