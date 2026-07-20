<!-- web/src/components/ui/RegionalErrorBoundary.vue -->
<template>
  <slot v-if="!hasError" />
  <div v-else class="regional-error-boundary">
    <div class="regional-error-card">
      <Icon class="regional-error-icon" name="warning" :size="24" />
      <p class="regional-error-message">{{ errorMessage }}</p>
      <button class="ds-btn ds-btn--primary" @click="reset">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, watch } from 'vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  resetKeys?: unknown[]
}>()

const hasError = ref(false)
const errorMessage = ref('此区域发生错误')

onErrorCaptured((err) => {
  hasError.value = true
  errorMessage.value = err instanceof Error ? err.message : String(err)
  console.error('[RegionalErrorBoundary]', err)
  return false
})

watch(() => props.resetKeys, () => {
  if (hasError.value) reset()
}, { deep: true })

function reset() {
  hasError.value = false
  errorMessage.value = ''
}
</script>

<style scoped>
.regional-error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-16);
}
.regional-error-card {
  text-align: center;
  max-width: 320px;
}
.regional-error-icon {
  font-size: 48px;
  margin-bottom: var(--space-4);
}
.regional-error-message {
  color: var(--text-secondary);
  margin-bottom: var(--space-6);
  word-break: break-word;
}
</style>
