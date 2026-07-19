<template>
  <header class="chat-header" aria-label="当前会话">
    <div class="header-left" :title="contextDetails" :aria-label="contextDetails">
      <span class="header-avatar" aria-hidden="true">{{ store.profile.avatar }}</span>
      <div class="header-context">
        <h1 class="header-name">{{ store.profile.name }}</h1>
        <span class="header-session">{{ sessionTitle }}</span>
      </div>
    </div>
    <div class="header-right" aria-live="polite">
      <slot name="extra" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePersonaStore } from '../stores/persona'
import { useSessionStore } from '../stores/session'
const store = usePersonaStore()
const sessionStore = useSessionStore()
const currentSession = computed(() => sessionStore.sessions.find(session => session.session_id === sessionStore.sessionId))
const sessionTitle = computed(() => currentSession.value?.const_name || '当前会话')
const contextDetails = computed(() => `${store.profile.name} · ${sessionTitle.value} · ${store.profile.description} · ${store.profile.scene}`)
</script>

<style scoped>
.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; max-width: 100%; min-width: 0; overflow: hidden; padding: 10px clamp(12px, 2.4vw, 24px); border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent); background: color-mix(in srgb, var(--bg-card) 86%, transparent); box-shadow: var(--shadow-xs); }
.header-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 auto; overflow: hidden; font-size: 14px; }
.header-avatar { font-size: 18px; }
.header-context { min-width: 0; overflow: hidden; }
.header-name, .header-session { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-name { margin: 0; font-size: 0.98rem; line-height: 1.3; font-weight: 700; color: var(--text-primary); }
.header-session { color: var(--text-secondary); font-size: 12px; }
.header-right { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; max-width: 55%; flex: 0 1 auto; flex-wrap: nowrap; overflow: hidden; }
.header-right > * { min-width: 0; max-width: 100%; flex: 0 1 auto; }
.header-right :deep(button) { min-width: var(--touch-target-min, 44px); min-height: var(--touch-target-min, 44px); }

@media (max-width: 720px) {
  .chat-header {
    align-items: flex-start;
    padding: 8px 12px;
  }

  .header-left {
    flex: 1 1 auto;
  }

  .header-right {
    flex: 1 1 auto;
    max-width: 55%;
    gap: 6px;
  }
}
</style>
