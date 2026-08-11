<template>
  <div class="md-editor-view" ref="rootEl">
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
    <template v-else>
      <!-- 写作指引 + 模板：让 Novice 知道 SOUL.md 是什么、该怎么写 -->
      <details class="md-guide">
        <summary class="md-guide-summary">📝 写作指引与模板</summary>
        <div class="md-guide-body">
          <p>
            <strong>SOUL.md</strong> 是当前人格的「角色设定文件」，定义 AI 在对话中扮演谁、用什么语气、有什么能力边界。
            AI 每次对话时会自动读取，写得越具体，AI 表现越稳定。
          </p>
          <p>
            与 <strong>USER.md</strong>（定义用户）不同，<strong>SOUL.md</strong> 定义的是 <em>AI 自己</em>。
          </p>
          <p>建议写：</p>
          <ul>
            <li><strong>身份</strong>：AI 是谁？（如「我是 Maxma，一只温柔的桌面伙伴」）</li>
            <li><strong>风格</strong>：语气、措辞偏好、回答长度倾向</li>
            <li><strong>能力边界</strong>：擅长什么、不擅长什么、什么场景应拒绝</li>
            <li><strong>禁忌</strong>：不要做什么（如「不要自夸」「不要说教」）</li>
          </ul>
          <p>格式为 <code>Markdown</code>，可以切换不同人格分别配置；点击下方模板可一键填入。</p>
          <div class="md-guide-templates">
            <div class="md-guide-templates-title">点击使用模板（将覆盖当前内容）：</div>
            <div class="md-guide-template-list">
              <button
                v-for="t in soulTemplates"
                :key="t.label"
                type="button"
                class="md-template-btn"
                @click="applySoulTemplate(t.content)"
              >{{ t.label }}</button>
            </div>
          </div>
        </div>
      </details>
      <div class="editor-wrapper">
        <!-- WEBVIEW2-EDITOR-001：vue-codemirror 在 Tauri WebView2 下渲染异常
             （5 轮 CSS 修复未根治，编辑器高度塌陷/内容不可见）。与
             MarkdownEditor.vue 同一降级方案：原生 textarea，放弃语法高亮，
             保证人设页在桌面端真实可用。 -->
        <textarea
          ref="editorTextarea"
          class="md-textarea"
          v-model="content"
          :placeholder="pagePlaceholder"
          :disabled="saving"
          spellcheck="false"
          tab-size="2"
          @blur="onBlur"
        />
      </div>
    </template>

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
import { api } from '@/api'
import PersonaCard from '../components/PersonaCard.vue'
import { useMarkdownPersist } from '@/composables/useMarkdownPersist'
import { confirmAction } from '@/composables/useConfirm'
import { createLogger } from '@/utils/logger'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'

const log = createLogger('SoulView')

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
  saveStateText,
  loadContent,
  saveContent,
  onBlur,
  retryLoad,
} = useMarkdownPersist({
  type: TYPE,
  getVariant: () => activeFile.value !== 'SOUL.md' ? activeFile.value : undefined,
})

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', ready: () => !loading.value })

// 功能按钮交互动效：保存主 CTA 磁吸 + 弹性；创建人格小按钮磁吸；模板按钮弹性蹦跳
useButtonFx(() => rootEl.value, '.save-button', { hoverScale: 1.06, magnetic: 10, watchSources: [loading] })
useButtonFx(() => rootEl.value, '.btn-create-persona', { hoverScale: 1.2, magnetic: 8, watchSources: [personasLoaded] })
useButtonFx(() => rootEl.value, '.md-template-btn', { hoverScale: 1.08, bounceIcon: true, watchSources: [loading] })

// 创建新人格
const showCreateDialog = ref(false)
const creating = ref(false)
const createForm = ref({
  name: '',
  description: '',
  memory: 'shared',
})

// 创建弹窗按钮交互动效（弹窗 v-if 渲染，随 showCreateDialog 重新绑定）
useButtonFx(() => rootEl.value, '.create-btn', { hoverScale: 1.08, bounceIcon: true, watchSources: [showCreateDialog] })

// ── SOUL 模板：让 Novice 一键填入可用起点 ──
const soulTemplates = [
  {
    label: '🐱 温柔桌面伙伴',
    content: `# 身份

我是 Maxma，一只温柔、有点小聪明的桌面伙伴。我的目标是帮用户把事情想清楚、做明白，而不是炫技或卖弄。

## 风格
- 语气温柔、克制，像朋友间讨论问题
- 简洁优先；除非用户要求展开，否则回答不超过 300 字
- 不用感叹号、不卖萌、不吹捧自己

## 能力
- 帮用户梳理思路、起草文档、写代码、查信息
- 不确定时坦诚说「我不确定」，并建议用户怎么验证

## 禁忌
- 不要说教、不要鸡汤
- 不要假设用户的操作系统或工具链
- 不要自夸「我是一个强大的 AI」
`,
  },
  {
    label: '💼 专业工作助手',
    content: `# 身份

我是 Maxma，一名冷静、靠谱的工作助手。我擅长把模糊的需求拆解成可执行的步骤，给出直接可用的产出。

## 风格
- 专业、简洁，避免口语化
- 代码要可直接运行，包含必要 import 和边界处理
- 文档要分点列出，先结论后细节

## 能力
- 写文档、起草邮件、整理会议纪要、写代码、做数据分析
- 优先使用标准库 / 主流工具，不引入无谓依赖

## 禁忌
- 不要给「看起来厉害但跑不动」的代码
- 不要给鸡汤式建议
- 不要假设用户用 macOS
`,
  },
  {
    label: '🎨 创意灵感搭子',
    content: `# 身份

我是 Maxma，一个爱发散、爱联结的创意搭子。我擅长从看似无关的事物中找到联系，给用户新鲜的视角。

## 风格
- 活泼但不浮夸，敢于给具体方案而不是空话
- 多给几个方向，每个方向简短说明
- 鼓励用户先发散再收敛

## 能力
- 起名字、写文案、做方案、设计活动、出点子
- 用类比、隐喻、跨领域借鉴打开思路

## 禁忌
- 不要给「多读书多看报」式空泛建议
- 不要每个回答都给"3 个建议"
`,
  },
]

async function applySoulTemplate(t: string) {
  if (!await confirmAction({
    title: '应用模板',
    message: '应用此模板将覆盖当前编辑器内容，确定吗？（未保存的内容会丢失）',
    confirmText: '应用',
    danger: true,
  })) return
  content.value = t
}

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
  } catch (e: unknown) {
    log.error('[SoulView] createPersona FAIL', e)
    window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: '创建失败: ' + (e instanceof Error ? e.message : String(e)) } }))
  } finally {
    creating.value = false
  }
}

async function loadPersonas() {
  try {
    const res = await api.listPersonas()
    personas.value = res.personas
    activeFile.value = res.active_file
    personasLoaded.value = true
  } catch (e) {
    log.error('[SoulView] loadPersonas FAIL', e)
    personas.value = []
    personasLoaded.value = true  // 即使失败也标记为已加载，避免选择器永远不显示
  }
}

async function onPersonaChange() {
  // 修复 PERSONA-SWITCH-ROLLBACK-001：切换失败时回滚 select 到原值——
  // 此前 v-model 已乐观切换到新文件，失败后选择器与内容不一致
  const previous = activeFile.value
  // 切换人格：先保存当前（如果有改动），再调用后端切换，最后加载新人格
  if (content.value !== savedContent.value) {
    await saveContent()
  }
  try {
    await api.switchPersona(activeFile.value)
    // 更新 personas 列表中的 active 状态
    personas.value.forEach(p => { p.active = p.file === activeFile.value })
  } catch (e: unknown) {
    log.error('[SoulView] switchPersona FAIL', e)
    activeFile.value = previous  // 回滚选择
    loadError.value = '切换人格失败: ' + (e instanceof Error ? e.message : String(e))
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
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
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
  /* 保底最小高度：flex 布局异常时编辑器也不会塌陷为 0 */
  min-height: 300px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-primary);
  /* 确保子元素 height:100% 有确定参考（WebView2 flex 子项不一定提供 definite height） */
  position: relative;
}

/* WEBVIEW2-EDITOR-001：原生 textarea 样式（与 MarkdownEditor.vue 一致），
   不再依赖 vue-codemirror 的 display:contents/height 链 */
.editor-wrapper .md-textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 16px;
  background: transparent;
  color: var(--text-primary, #1C1C1C);
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.6;
  tab-size: 2;
}

.editor-wrapper :deep(.cm-editor) {
  height: 100% !important;
  min-height: 100% !important;
}

.editor-wrapper :deep(.cm-scroller) {
  /* specificity 必须 > codemirror base theme 的 `.ͼN .cm-scroller` (0,2,0)，
     并加 !important 覆盖 codemirror 的 font-family: monospace —— 否则
     Tauri WebView2 中 monospace 的中文 fallback 行为异常导致文字不可见。
     overflow-y: auto 补全 codemirror 6 base theme 缺失的垂直滚动。 */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'SimSun', sans-serif !important;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary);
  overflow-y: auto !important;
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
  color: var(--text-primary);
}

/* 关键：scoped 的 .cm-line 需要 color 兜底（之前缺失，靠 main.css 0,2,0 全局兜底，
   在 Tauri WebView2 中 specificity 不够 → 显式加到 scoped 内） */
.editor-wrapper :deep(.cm-line) {
  color: var(--text-primary);
}

.editor-wrapper :deep(.cm-placeholder) {
  color: var(--text-tertiary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
}

/* ── 引导卡片 ── */
.md-guide {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 8px);
  background: var(--bg-card);
  overflow: hidden;
  flex-shrink: 0;
}
.md-guide-summary {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.md-guide-summary::-webkit-details-marker { display: none; }
.md-guide-summary::after {
  content: '▸';
  float: right;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.md-guide[open] .md-guide-summary::after {
  transform: rotate(90deg);
}
.md-guide-body {
  padding: 0 14px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.md-guide-body p { margin: 0 0 8px; }
.md-guide-body ul { margin: 0 0 8px; padding-left: 18px; }
.md-guide-body li { margin-bottom: 4px; }
.md-guide-body strong { color: var(--text-primary); font-weight: 600; }
.md-guide-body code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-secondary);
}
.md-guide-templates {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.md-guide-templates-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}
.md-guide-template-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.md-template-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.md-template-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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
  transition: border-color 0.15s var(--ease-out),
              color 0.15s var(--ease-out);
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
  background: color-mix(in srgb, var(--text-primary) 40%, transparent);
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
	  box-shadow: var(--shadow-xl);
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
  transition: border-color 0.15s var(--ease-out),
              background 0.15s var(--ease-out),
              color 0.15s var(--ease-out);
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
  color: var(--text-inverse);
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
