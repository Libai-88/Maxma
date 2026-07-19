<template>
  <Transition name="session-drawer">
    <div v-if="open" class="session-drawer-layer">
      <button
        class="session-drawer__scrim"
        type="button"
        aria-label="关闭会话抽屉"
        @click="close"
      />
      <aside
        class="session-drawer"
        aria-label="会话抽屉"
        tabindex="-1"
      >
        <header class="session-drawer__header">
          <div>
            <p class="session-drawer__eyebrow">Sessions</p>
            <h2>会话</h2>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="session-drawer__close"
            aria-label="关闭会话抽屉"
            title="关闭会话抽屉"
            @click="close"
          >
            <Icon name="close" :size="18" />
          </button>
        </header>
        <SessionSidebar
          :sessions="sessions"
          :active-id="activeId"
          :session-statuses="sessionStatuses"
          @create="$emit('create')"
          @switch="$emit('switch', $event)"
          @delete="$emit('delete', $event)"
          @constify="onConstify"
          @unconstify="$emit('unconstify', $event)"
        />
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import SessionSidebar from '@/components/SessionSidebar.vue'
import type { SessionInfo } from '@/types'

interface SessionStatus {
  connected: boolean
  isStreaming: boolean
  isAwaitingUser: boolean
}

const props = withDefaults(defineProps<{
  open: boolean
  sessions: SessionInfo[]
  activeId?: string
  sessionStatuses?: Record<string, SessionStatus>
}>(), {
  activeId: '',
  sessionStatuses: () => ({}),
})

const emit = defineEmits<{
  close: []
  create: []
  switch: [id: string]
  delete: [id: string]
  constify: [id: string, name: string]
  unconstify: [id: string]
}>()

const closeButton = ref<HTMLButtonElement | null>(null)

function focusCloseButton() {
  if (closeButton.value) {
    closeButton.value.focus()
    return
  }
  void nextTick(() => closeButton.value?.focus())
}

function close() {
  emit('close')
}

function onConstify(id: string, name: string) {
  emit('constify', id, name)
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') close()
}

watch(() => props.open, (isOpen) => {
  if (isOpen) focusCloseButton()
})

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
  if (props.open) focusCloseButton()
  if (props.open) window.setTimeout(focusCloseButton, 0)
})

onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown))
</script>

<style scoped>
.session-drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 300;
  pointer-events: none;
}

.session-drawer__scrim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: color-mix(in srgb, var(--text-primary) 18%, transparent);
  cursor: pointer;
  pointer-events: auto;
}

.session-drawer {
  position: absolute;
  inset: 0 auto 0 0;
  display: flex;
  flex-direction: column;
  width: clamp(280px, 24vw, 320px);
  max-width: 100vw;
  min-height: 0;
  padding: 20px 16px;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-xl);
  pointer-events: auto;
}

.session-drawer__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 4px 16px;
  border-bottom: 1px solid var(--border);
}

.session-drawer__eyebrow {
  margin: 0 0 2px;
  color: var(--text-tertiary);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-drawer h2 {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.25;
}

.session-drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 8px);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.session-drawer__close:hover,
.session-drawer__close:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
}

.session-drawer :deep(.session-sidebar) {
  min-height: 0;
  flex: 1;
  gap: 12px;
  padding-top: 12px;
}

.session-drawer :deep(.session-list) {
  max-height: none;
  flex: 1;
  min-height: 0;
  padding-inline: 0;
}

.session-drawer-enter-active,
.session-drawer-leave-active {
  transition: opacity 0.18s ease;
}

.session-drawer-enter-active .session-drawer,
.session-drawer-leave-active .session-drawer {
  transition: transform 0.2s ease;
}

.session-drawer-enter-from,
.session-drawer-leave-to {
  opacity: 0;
}

.session-drawer-enter-from .session-drawer,
.session-drawer-leave-to .session-drawer {
  transform: translateX(-100%);
}

@media (max-width: 640px) {
  .session-drawer {
    width: min(320px, calc(100vw - 56px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .session-drawer-enter-active,
  .session-drawer-leave-active,
  .session-drawer-enter-active .session-drawer,
  .session-drawer-leave-active .session-drawer {
    transition: none;
  }
}
</style>
