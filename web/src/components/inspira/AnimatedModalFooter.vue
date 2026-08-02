<template>
  <div class="animated-modal-footer" :class="rootClass">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  class?: string
}>(), {
  class: '',
})

const rootClass = computed(() => props.class || '')
</script>

<style scoped>
.animated-modal-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
</style>