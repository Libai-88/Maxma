<template>
  <!-- S4 兜底：便携版（Tauri WebView2）下 .cm-line color 可能被某条
       路由 scoped CSS 覆盖或 CSS 变量未及时应用导致文字不可见。
       在根容器直接 inline 颜色+字体：即便 codemirror 内部所有
       color 规则失效，文字也能通过 inherit 可见。 -->
  <div
    ref="rootRef"
    class="md-editor-view"
    :style="{ color: 'var(--text-primary, #1C1C1C)', background: 'var(--bg-card, #FFFEFA)', fontFamily: 'inherit' }"
  >
    <div class="header">
      <h2>{{ title }} <span class="subtitle">{{ subtitle }}</span></h2>
      <button class="save-button" :disabled="saving || content === savedContent" @click="saveContent">
        {{ saving ? '保存中...' : '保存' }}
      </button>
      <span class="save-indicator" :class="saveState">
        {{ saveStateText }}
      </span>
      <span v-if="saveError" class="save-error">保存失败：{{ saveError }}</span>
      <span v-if="!saveState && content && content !== savedContent" class="save-hint">点击编辑区域外来保存</span>
    </div>
    <!-- 引导卡片：仅在传入 guide 或 templates 时显示 -->
    <details v-if="$slots.guide || templates?.length" class="md-guide">
      <summary class="md-guide-summary"><Icon class="md-guide-icon" name="file-page" :size="14" />写作指引与模板</summary>
      <div class="md-guide-body">
        <slot name="guide" />
        <div v-if="templates?.length" class="md-guide-templates">
          <div class="md-guide-templates-title">点击使用模板（将覆盖当前内容）：</div>
          <div class="md-guide-template-list">
            <button
              v-for="t in templates"
              :key="t.label"
              type="button"
              class="md-template-btn"
              @click="applyTemplate(t.content)"
            >{{ t.label }}</button>
          </div>
        </div>
      </div>
    </details>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="loadError" class="load-error">
      <p>加载失败：{{ loadError }}</p>
      <button class="retry-button" @click="retryLoad">重试</button>
    </div>
    <div v-else class="editor-wrapper">
      <!-- S4-3 降级：原 codemirror 在 Tauri WebView2 下渲染异常（5 轮修复未根治）。
           改用原生 textarea：保证人设/用户页编辑可用，放弃 markdown 语法高亮。
           后续可在 codemirror 与 WebView2 兼容性稳定后再恢复。 -->
      <textarea
        ref="textareaRef"
        class="md-textarea"
        v-model="content"
        :placeholder="placeholder"
        :disabled="saving"
        spellcheck="false"
        @blur="onBlur"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import { useMarkdownPersist } from '@/composables/useMarkdownPersist'
import { confirmAction } from '@/composables/useConfirm'
import Icon from '@/components/Icon.vue'

interface MarkdownTemplate {
  label: string
  content: string
}

const props = defineProps<{
  type: 'soul' | 'user'
  title: string
  subtitle: string
  placeholder?: string
  templates?: MarkdownTemplate[]
}>()

// 应用模板：覆盖当前编辑器内容（保存需用户手动点击）
async function applyTemplate(t: string) {
  if (!await confirmAction({
    title: '应用模板',
    message: '应用此模板将覆盖当前编辑器内容，确定吗？（未保存的内容会丢失）',
    confirmText: '应用',
    danger: true,
  })) return
  content.value = t
}

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
} = useMarkdownPersist({ type: props.type })

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const rootRef = ref<HTMLElement | null>(null)

// 入场：加载完成后 header + 编辑器 wrapper 浮入（仅 opacity/transform，不影响编辑器初始化）
useGsap((_ctx, contextSafe) => {
  watch(loading, contextSafe((isLoading) => {
    if (isLoading) return
    const root = rootRef.value
    if (!root) return
    const header = root.querySelector<HTMLElement>('.header')
    if (header) gsap.from(header, { opacity: 0, y: -8, duration: 0.3, ease: easeMap.out })
    const wrapper = root.querySelector<HTMLElement>('.editor-wrapper')
    if (wrapper) gsap.from(wrapper, { opacity: 0, y: 8, duration: 0.3, ease: easeMap.out })
  }), { immediate: true, flush: 'post' })
})

onMounted(loadContent)
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
.retry-button {
  margin-top: 12px;
  padding: 6px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.retry-button:hover {
  border-color: var(--accent);
  color: var(--accent);
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
  display: flex;
}

/* S4-3 textarea 降级（codemirror 在 Tauri WebView2 渲染异常时使用）：
   填满容器、稳定可编辑。放弃 markdown 语法高亮换取兼容性。 */
.editor-wrapper .md-textarea {
  flex: 1;
  width: 100%;
  height: 100%;
  resize: none;
  border: none;
  outline: none;
  padding: 16px;
  background: transparent;
  color: var(--text-primary);
  font-family: "Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.6;
  tab-size: 2;
}

/* 修复：vue-codemirror 容器默认 display:contents（无盒子），在 WebView2 中
   .cm-editor 的 height:100% 无法正确解析导致编辑器高度塌陷为 0，
   内容与交互区全部不可见（人设/用户页"空白不可编辑"）。
   1) display:block 覆盖 inline style="display:contents"
   2) 绝对定位 + inset:0 让编辑器撑满容器，绕过 height% 百分比链断裂问题 */
.editor-wrapper :deep(.v-codemirror) {
  display: block !important;
  position: absolute;
  inset: 0;
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
}
.md-guide-summary {
  display: flex;
  align-items: center;
  gap: 6px;
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
.md-guide-body :deep(strong) { color: var(--text-primary); font-weight: 600; }
.md-guide-body :deep(code) {
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
</style>
