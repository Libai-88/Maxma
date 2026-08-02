<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="animated-modal-overlay"
        @click.self="onBackdropClick"
        @keydown.esc="onEsc"
      >
        <div class="animated-modal-container">
          <slot :open-modal="openModal" :close-modal="closeModal" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  open?: boolean
  closeOnEsc?: boolean
}>(), {
  open: false,
  closeOnEsc: true,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

function openModal() {
  emit('update:open', true)
}

function closeModal() {
  emit('update:open', false)
}

function onBackdropClick() {
  closeModal()
}

function onEsc(e: KeyboardEvent) {
  if (props.closeOnEsc && e.key === 'Escape') {
    closeModal()
  }
}

watch(() => props.open, (val) => {
  if (val) {
    document.addEventListener('keydown', onEsc)
  } else {
    document.removeEventListener('keydown', onEsc)
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onEsc)
})
</script>

<style scoped>
.animated-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.animated-modal-container {
  position: relative;
  width: 100%;
  max-width: 680px;
  max-height: 85vh;
  margin: 0 16px;
  perspective: 1200px;
}

/* Entrance animation: 3D scale + rotate */
.modal-enter-active {
  transition: opacity 0.35s ease, backdrop-filter 0.35s ease;
}
.modal-enter-active .animated-modal-container > :deep(*) {
  animation: modal-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transform-origin: center center;
}
.modal-leave-active {
  transition: opacity 0.25s ease;
}
.modal-leave-active .animated-modal-container > :deep(*) {
  animation: modal-leave 0.25s ease forwards;
  transform-origin: center center;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@keyframes modal-enter {
  0% {
    opacity: 0;
    transform: scale(0.85) rotateX(-12deg) translateY(30px);
  }
  100% {
    opacity: 1;
    transform: scale(1) rotateX(0deg) translateY(0);
  }
}
@keyframes modal-leave {
  0% {
    opacity: 1;
    transform: scale(1) rotateX(0deg) translateY(0);
  }
  100% {
    opacity: 0;
    transform: scale(0.9) rotateX(8deg) translateY(-20px);
  }
}
</style>