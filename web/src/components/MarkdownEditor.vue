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

const props = defineProps<{
  type: 'soul' | 'user'
  title: string
  subtitle: string
  placeholder?: string
}>()

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
</style>
