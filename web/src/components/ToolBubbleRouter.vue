<template>
  <ErrorCard
    v-if="toolCall.status === 'error'"
    category="warning"
    :message="failureMessage"
    :diagnostic-text="diagnosticText"
    :dismissible="false"
  />
  <ProcessFoldBlock v-else-if="compactToolResultsEnabled && shouldFold" :tool-call="toolCall">
    <component
      :is="bubbleComponent"
      v-if="bubbleComponent"
      :tool-call="toolCall"
      @action="handleAction"
      @pin="$emit('pin', $event)"
    />
    <ToolCallCard v-else :tool-call="toolCall" @pin="$emit('pin', $event)" />
  </ProcessFoldBlock>
  <!-- 修复 ERROR-BYPASS-001：专用工具气泡分支此前无 error 检查——
       status='error' 且工具已注册气泡（python/file_edit 等）时绕过
       ErrorCard 直接渲染气泡组件，错误信息为空时卡片只剩图标。
       错误状态统一走 ErrorCard（含兜底文案与诊断路径）。
       注：TS 模板收窄认为 status 已非 error（前序分支排除），但运行时
       JS 无收窄，此断言仍必要，故用 as string 绕过静态误报。 -->
  <component
    :is="bubbleComponent"
    v-else-if="bubbleComponent && (toolCall.status as string) !== 'error'"
    :tool-call="toolCall"
    @action="handleAction"
    @pin="$emit('pin', $event)"
  />
  <ToolCallCard v-else :tool-call="toolCall" @pin="$emit('pin', $event)" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCall } from '@/types'
import ToolCallCard from './ToolCallCard.vue'
import ErrorCard from './ErrorCard.vue'
import ProcessFoldBlock from './ProcessFoldBlock.vue'
import { getBubbleComponent } from './tools/registry'
import { toolDisplayName } from './tools/_shared/displayNames'

const props = defineProps<{ toolCall: ToolCall }>()
const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
  (e: 'pin', payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }): void
}>()

const bubbleComponent = computed(() => {
  return getBubbleComponent(props.toolCall.name)
})

// Presentation-only rollout: no runtime configuration request is needed.
const compactToolResultsEnabled = import.meta.env.VITE_COMPACT_TOOL_RESULTS_ENABLED === 'true'

const payloadSize = computed(() => {
  const structured = props.toolCall.toolData ? JSON.stringify(props.toolCall.toolData) : ''
  return (props.toolCall.input?.length ?? 0) + (props.toolCall.output?.length ?? 0) + structured.length
})

const shouldFold = computed(() => {
  if (props.toolCall.status === 'running') return false
  const lines = `${props.toolCall.input}\n${props.toolCall.output ?? ''}`.split('\n').length
  return payloadSize.value > 1_800 || lines > 40
})

const failureMessage = computed(() => {
  const text = (props.toolCall.output ?? '').toLowerCase()
  if (/(timeout|timed out|network|connection|rate limit|429|temporar)/.test(text)) {
    return '操作暂未完成，可在稍后重新发起。'
  }
  return '该工具没有完成操作。请检查输入后重试，或复制诊断信息排查。'
})

const diagnosticText = computed(() => [
  `工具：${toolDisplayName(props.toolCall.name)}`,
  '状态：未完成',
  props.toolCall.elapsed === null ? null : `耗时：${props.toolCall.elapsed.toFixed(1)}s`,
].filter((item): item is string => Boolean(item)).join('\n'))

function handleAction(payload: { action: string; data?: unknown }) {
  emit('action', payload)
}
</script>
