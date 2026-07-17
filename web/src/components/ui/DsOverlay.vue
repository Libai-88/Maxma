<!-- web/src/components/ui/DsOverlay.vue -->
<template>
  <Teleport to="body">
    <Transition name="ds-overlay" appear @after-enter="onAfterEnter" @after-leave="onAfterLeave">
      <div
        v-if="modelValue"
        ref="rootRef"
        class="ds-overlay"
        :class="[`ds-overlay--${variant}`, { 'ds-overlay--contained': contained }]"
        @click.self="onBackdropClick"
        @keydown.esc="onEsc"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  variant?: 'dim' | 'blur' | 'none'
  contained?: boolean
  closeOnEsc?: boolean
  closeOnBackdrop?: boolean
}>(), {
  variant: 'dim',
  contained: false,
  closeOnEsc: true,
  closeOnBackdrop: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const rootRef = ref<HTMLElement | null>(null)
let savedFocus: HTMLElement | null = null

function close() {
  emit('update:modelValue', false)
}

function onBackdropClick() {
  if (props.closeOnBackdrop) close()
}

function onEsc() {
  if (props.closeOnEsc) close()
}

function trapFocus(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !rootRef.value) return
  const focusable = rootRef.value.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function onAfterEnter() {
  savedFocus = document.activeElement as HTMLElement
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', trapFocus)
  nextTick(() => {
    const first = rootRef.value?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    first?.focus()
  })
}

function onAfterLeave() {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', trapFocus)
  savedFocus?.focus()
  savedFocus = null
}

onUnmounted(() => {
  document.body.style.overflow = ''
  document.removeEventListener('keydown', trapFocus)
})
</script>

<style scoped>
.ds-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-16);
}
.ds-overlay--contained {
  position: absolute;
}
.ds-overlay--dim {
  background: var(--overlay-medium);
}
.ds-overlay--blur {
  background: var(--overlay-light);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ds-overlay--none {
  background: transparent;
  pointer-events: none;
}
.ds-overlay--none > * {
  pointer-events: auto;
}

.ds-overlay-enter-active,
.ds-overlay-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}
.ds-overlay-enter-from,
.ds-overlay-leave-to {
  opacity: 0;
}
</style>
