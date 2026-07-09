<template>
  <component
    :is="bubbleComponent"
    v-if="bubbleComponent"
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
import { getBubbleComponent } from './tools/registry'

const props = defineProps<{ toolCall: ToolCall }>()
const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
  (e: 'pin', payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }): void
}>()

const bubbleComponent = computed(() => {
  return getBubbleComponent(props.toolCall.name)
})

function handleAction(payload: { action: string; data?: unknown }) {
  emit('action', payload)
}
</script>
