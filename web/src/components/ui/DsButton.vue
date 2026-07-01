<template>
  <button
    class="ds-btn"
    :class="[`ds-btn--${variant}`, { 'ds-btn--sm': size === 'sm' }]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  variant?: 'default' | 'primary' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
}>()

defineEmits<{ click: [e: MouseEvent] }>()
</script>
