<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        ref="overlayRef"
        class="animated-modal-overlay"
        role="dialog"
        aria-modal="true"
        @click.self="onBackdropClick"
        @keydown.esc="onEsc"
        @keydown.tab="onTabTrap"
      >
        <div class="animated-modal-container">
          <slot :open-modal="openModal" :close-modal="closeModal" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onUnmounted } from 'vue'

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

const overlayRef = ref<HTMLElement | null>(null)
/** 打开前的焦点元素，关闭时还原（FOCUS-003） */
let restoreFocusEl: HTMLElement | null = null

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

// 修复 FOCUS-003：模态内 Tab 焦点陷阱。此前打开后 Tab 可逃逸到背景
// 应用（侧边栏/主内容区），且关闭后焦点不还原。与 DsOverlay 的
// 焦点管理对齐（DsOverlay.vue:145-168 已有完整实现）。
function onTabTrap(e: KeyboardEvent) {
  const overlay = overlayRef.value
  if (!overlay) return
  const focusables = Array.from(
    overlay.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(el => el.offsetParent !== null)
  if (focusables.length === 0) {
    e.preventDefault()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey) {
    if (active === first || !overlay.contains(active)) {
      e.preventDefault()
      last.focus()
    }
  } else if (active === last || !overlay.contains(active)) {
    e.preventDefault()
    first.focus()
  }
}

watch(() => props.open, (val) => {
  if (val) {
    restoreFocusEl = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onEsc)
    // 打开后把焦点移入模态（首个可聚焦元素）
    void nextTick(() => {
      const overlay = overlayRef.value
      if (!overlay) return
      const focusables = overlay.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      const target = focusables[0]
      if (target) target.focus()
      else overlay.focus?.()
    })
  } else {
    document.removeEventListener('keydown', onEsc)
    // 关闭后还原焦点到触发元素
    if (restoreFocusEl && document.contains(restoreFocusEl)) {
      restoreFocusEl.focus()
    }
    restoreFocusEl = null
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