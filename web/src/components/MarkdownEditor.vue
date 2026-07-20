<template>
  <div class="md-editor-view">
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
    <div v-else class="editor-wrapper">
      <Codemirror
        v-model="content"
        :extensions="extensions"
        :disabled="saving"
        :placeholder="placeholder"
        :autofocus="false"
        :indent-with-tab="true"
        :tab-size="2"
        @blur="onBlur"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { useMarkdownPersist } from '@/composables/useMarkdownPersist'
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
function applyTemplate(t: string) {
  if (!window.confirm('应用此模板将覆盖当前编辑器内容，确定吗？（未保存的内容会丢失）')) return
  content.value = t
}

const {
  content,
  savedContent,
  loading,
  saving,
  saveState,
  saveError,
  extensions,
  saveStateText,
  loadContent,
  saveContent,
  onBlur,
} = useMarkdownPersist({ type: props.type })

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
