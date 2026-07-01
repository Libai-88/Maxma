<template>
  <div class="ds-card" :class="{ 'ds-card--hover': hoverable }">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ hoverable?: boolean }>()
</script>

<style scoped>
.ds-card--hover:hover {
  border-color: var(--accent-light);
  box-shadow: var(--shadow-sm);
}
</style>
