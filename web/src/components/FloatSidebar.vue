<!-- web/src/components/FloatSidebar.vue -->
<template>
  <Transition name="float-sidebar">
    <div v-if="isVisible" class="float-sidebar" @mouseenter="onEnter" @mouseleave="onLeave">
      <!-- 复用主侧边栏的导航内容 -->
      <nav class="fs-nav">
        <router-link to="/" class="fs-nav-item" @click="forceClose">
          <Icon name="chat" :size="18" /> <span>对话</span>
        </router-link>
        <router-link to="/memory" class="fs-nav-item" @click="forceClose">
          <Icon name="memory" :size="18" /> <span>记忆</span>
        </router-link>
        <router-link to="/kb" class="fs-nav-item" @click="forceClose">
          <Icon name="memory" :size="18" /> <span>知识库</span>
        </router-link>
      </nav>
      <SessionSidebar
        :sessions="sessions"
        :active-id="sessionId"
        :session-statuses="allSessionStatuses"
        :collapsed="false"
        @create="createSession"
        @switch="onSwitch"
        @delete="deleteSession"
        @constify="onConstify"
        @unconstify="onUnconstify"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import SessionSidebar from '@/components/SessionSidebar.vue'
import { useFloatSidebar } from '@/composables/useFloatSidebar'
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const { isVisible, onEnter, onLeave, forceClose } = useFloatSidebar()

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { createSession, switchSession, deleteSession } = sessionStore

const chatStore = useChatStore()
const { allSessionStatuses } = storeToRefs(chatStore)

const router = useRouter()

function onSwitch(id: string) {
  switchSession(id)
  router.push('/')
  forceClose()
}

function onConstify(id: string, name: string) {
  if (name && name.trim()) sessionStore.constifySession(id, name.trim())
}

function onUnconstify(id: string) {
  if (window.confirm('确定取消固定此会话？')) sessionStore.unconstifySession(id)
}
</script>

<style scoped>
.float-sidebar {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.fs-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fs-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9em;
  transition: background 0.15s, color 0.15s;
}
.fs-nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}
.fs-nav-item.router-link-active {
  background: var(--bg-card);
  color: var(--accent);
  font-weight: 600;
}

/* 滑入/滑出动画 */
.float-sidebar-enter-active {
  animation: fs-slide-in 0.25s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.float-sidebar-leave-active {
  animation: fs-slide-out 0.2s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}

@keyframes fs-slide-in {
  from { transform: translateX(-100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes fs-slide-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .float-sidebar-enter-active,
  .float-sidebar-leave-active { animation: none; }
}
</style>
