<template>
  <section class="artifact-card choice-card" aria-live="polite">
    <header>{{ card.title }}</header>
    <p>{{ card.content }}</p>
    <div class="actions">
      <button
        v-for="action in artifact.actions"
        :key="action.id"
        type="button"
        :class="['artifact-action', action.style]"
        :disabled="submitted"
        @click="submit(action.id, action.token)"
      >{{ action.label }}</button>
    </div>
    <small v-if="submitted">已提交，正在等待处理。</small>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CanvasCard } from '@/types/workbench'

const props = defineProps<{ card: CanvasCard }>()
const emit = defineEmits<{ remove: []; 'artifact-action': [payload: { artifactId: string; actionId: string; token: string }] }>()
const submitted = ref(false)
const artifact = computed(() => props.card.artifact!)

function submit(actionId: string, token: string) {
  if (submitted.value) return
  submitted.value = true
  emit('artifact-action', { artifactId: artifact.value.id, actionId, token })
}
</script>

<style scoped>
.artifact-card { border: 1px solid var(--border-color, #d9d9d9); border-radius: 8px; background: var(--bg-primary, #fff); padding: 12px; }
header { font-size: 14px; font-weight: 600; }
p { margin: 8px 0 12px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.artifact-action { border: 1px solid var(--border-color, #d9d9d9); border-radius: 5px; padding: 6px 12px; cursor: pointer; }
.primary { background: var(--accent-color, #1a73e8); color: #fff; border-color: var(--accent-color, #1a73e8); }
.danger { background: #b42318; color: #fff; border-color: #b42318; }
.secondary { background: var(--bg-secondary, #f5f5f5); color: var(--text-primary, #222); }
.artifact-action:focus-visible { outline: 2px solid var(--accent-color, #1a73e8); outline-offset: 2px; }
.artifact-action:disabled { cursor: not-allowed; opacity: .65; }
small { display: block; margin-top: 8px; color: var(--text-secondary, #666); }
</style>
