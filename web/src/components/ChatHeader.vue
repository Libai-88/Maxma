<template>
  <div class="chat-header">
    <div class="header-left" :title="contextDetails" :aria-label="contextDetails">
      <span class="header-avatar" aria-hidden="true">{{ store.profile.avatar }}</span>
      <div class="header-context">
        <span class="header-name">{{ store.profile.name }}</span>
        <span class="header-session">{{ sessionTitle }}</span>
      </div>
    </div>
    <div class="header-right">
      <slot name="extra" />
    </div>
  </div>
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
.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--bg-primary); }
.header-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; overflow: hidden; font-size: 14px; }
.header-avatar { font-size: 18px; }
.header-context { min-width: 0; overflow: hidden; }
.header-name, .header-session { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-name { font-weight: 600; color: var(--text-primary); }
.header-session { color: var(--text-secondary); font-size: 12px; }
.header-right { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; flex: 0 1 auto; flex-wrap: wrap; }

@media (max-width: 720px) {
  .chat-header {
    align-items: flex-start;
    padding: 8px 12px;
  }

  .header-left {
    flex: 0 1 auto;
  }

  .header-right {
    flex: 1 1 auto;
    gap: 6px;
  }
}
</style>
