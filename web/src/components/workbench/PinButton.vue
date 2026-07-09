<template>
  <button
    class="pin-btn"
    :class="{ pinned: isPinned }"
    :title="isPinned ? '已固定到画布' : '固定到画布'"
    @click.stop="handleClick"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 17v5" v-if="isPinned" />
      <path d="M9 2h6l-1 7 4 3v3H6v-3l4-3-1-7z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{
  isPinned?: boolean
}>()

const emit = defineEmits<{
  pin: []
}>()

function handleClick() {
  if (!props.isPinned) {
    emit('pin')
  }
}
</script>

<style scoped>
.pin-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #999);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.pin-btn:hover {
  background: var(--bg-hover, #f0f0f0);
  color: var(--accent-color, #1a73e8);
}

.pin-btn.pinned {
  color: var(--accent-color, #1a73e8);
}
</style>
