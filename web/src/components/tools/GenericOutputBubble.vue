<template>
  <BubbleChrome ref="rootRef" :tool-call="toolCall">
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>{{ runningLabel }}</span>
    </div>
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || '执行失败' }}
    </div>
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="isDone" class="output-done">{{ doneLabel }}</div>
      <div v-else-if="structuredData" class="structured">
        <pre class="json-block">{{ JSON.stringify(structuredData, null, 2) }}</pre>
      </div>
      <div v-else-if="output" class="output-text" :class="{ collapsed: collapsed && output.length > 500 }">
        <pre>{{ displayOutput }}</pre>
        <button v-if="output.length > 500" class="toggle-btn" @click="collapsed = !collapsed">
          {{ collapsed ? '展开全部' : '收起' }}
        </button>
      </div>
      <div v-else class="bubble-empty">操作完成</div>
    </template>
  </BubbleChrome>
</template>

<script setup lang="ts">
import { ref, computed, type ComponentPublicInstance } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'
import { useButtonFx } from '@/composables/useButtonFx'

const props = defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'action', p: { action: string; data?: unknown }): void }>()

const collapsed = ref(true)

const rootRef = ref<ComponentPublicInstance | null>(null)

// 展开/收起按钮：hover 弹性
useButtonFx(() => (rootRef.value?.$el as HTMLElement | null) ?? null, '.toggle-btn', {
  watchSources: [() => props.toolCall.status],
})

const toolName = computed(() => props.toolCall.name)
const output = computed(() => props.toolCall.output ?? '')

const runningLabel = computed(() => {
  const labels: Record<string, string> = {
    bash: '执行命令...', launch: '启动中...', ssh: '连接中...',
    github: '处理 GitHub...', lsp: '分析代码...', debug: '调试中...',
    ast_grep: '搜索 AST...', ast_edit: '编辑 AST...',
    task: '执行任务...', job: '运行作业...',
    learn: '学习中...', manage_skill: '管理技能...',
    search_tool_bm25: '搜索中...',
  }
  return labels[toolName.value] ?? '处理中...'
})

const doneLabel = computed(() => {
  const labels: Record<string, string> = {
    task: '任务已完成', job: '作业已完成', learn: '学习完成',
    manage_skill: '技能已更新',
    ast_edit: 'AST 编辑完成', ast_grep: 'AST 搜索完成',
  }
  return labels[toolName.value] ?? '执行完成'
})

const isDone = computed(() => {
  return !output.value && ['task', 'job', 'learn', 'manage_skill', 'ast_edit'].includes(toolName.value)
})

const structuredData = computed(() => {
  if (!output.value) return null
  try { return JSON.parse(output.value) } catch { return null }
})

const displayOutput = computed(() => {
  if (!output.value) return ''
  return collapsed.value && output.value.length > 500
    ? output.value.slice(0, 500) + '\n...'
    : output.value
})
</script>

<style scoped>
.bubble-running { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--text-secondary); }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: maxma-spin 0.6s linear infinite; }
.bubble-error { font-size: 13px; color: var(--error-color, #ef4444); padding: 4px 0; white-space: pre-wrap; }
.bubble-empty { font-size: 13px; color: var(--text-secondary); padding: 4px 0; }
.output-done { font-size: 14px; color: var(--accent); font-weight: 500; padding: 4px 0; }
.output-text { font-size: 12px; }
.output-text pre {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: var(--font-mono); line-height: 1.5; color: var(--text-primary);
  background: var(--bg-secondary); padding: 10px; border-radius: 6px;
  max-height: 400px; overflow-y: auto;
}
.structured .json-block {
  margin: 0; font-size: 11px; font-family: var(--font-mono); line-height: 1.5;
  color: var(--text-secondary); background: var(--bg-secondary); padding: 10px;
  border-radius: 6px; max-height: 300px; overflow-y: auto;
}
.toggle-btn {
  display: block; margin-top: 6px; padding: 4px 12px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-secondary); color: var(--accent); cursor: pointer;
  font-size: 11px; font-family: inherit;
}
</style>
