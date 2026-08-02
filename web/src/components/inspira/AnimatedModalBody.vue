<template>
  <div
    class="animated-modal-body"
    :class="{ 'lock-scroll': lockScroll }"
    @click.self="onOutsideClick"
  >
    <!-- Close button -->
    <button
      v-if="showClose"
      class="modal-close-btn"
      @click="emit('close')"
      aria-label="关闭"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <div class="modal-body-inner">
      <slot />
    </div>

    <!-- Footer slot -->
    <div v-if="$slots.footer" class="modal-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  lockScroll?: boolean
  closeOnOutside?: boolean
  showClose?: boolean
}>(), {
  lockScroll: false,
  closeOnOutside: true,
  showClose: true,
})

const emit = defineEmits<{
  close: []
}>()

function onOutsideClick() {
  if (props.closeOnOutside) {
    emit('close')
  }
}
</script>

<style scoped>
.animated-modal-body {
  position: relative;
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.08),
    rgba(255, 255, 255, 0.02)
  );
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  overflow: hidden;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.lock-scroll {
  overflow: hidden;
}

.modal-body-inner {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.modal-body-inner::-webkit-scrollbar {
  width: 6px;
}
.modal-body-inner::-webkit-scrollbar-track {
  background: transparent;
}
.modal-body-inner::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.modal-close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}
.modal-close-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 24px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
</style>