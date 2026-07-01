<template>
  <span class="ds-badge" :class="`ds-badge--${type}`">
    <slot />
  </span>
</template>

<script setup lang="ts">
defineProps<{
  type?: 'ok' | 'warn' | 'error' | 'info' | 'neutral'
}>()
</script>
