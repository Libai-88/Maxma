<template>
  <div class="app-layout">
    <!-- 折叠时的悬停触发条 -->
    <div
      v-if="effectiveCollapsed"
      class="sidebar-hover-trigger"
      @mouseenter="onFloatSidebarEnter"
      @mouseleave="onFloatSidebarLeave"
    ></div>
    <aside class="sidebar" :class="{ collapsed: effectiveCollapsed }" @click="onSidebarClick">
      <div class="sidebar-header">
        <h1 class="logo">
          <img src="@/assets/images/brand/logo-hero-opt.jpg" alt="Maxma" class="logo-img" />
          <span class="logo-text">Maxma</span>
        </h1>
      </div>
      <div class="sidebar-icon-collapsed">
        <img src="@/assets/images/brand/favicon.png" alt="Maxma" class="logo-favicon" />
      </div>
      <nav class="sidebar-nav">
        <router-link to="/" class="nav-item">
          <Icon name="chat" :size="18" /> <span class="nav-label"><span class="nav-zh">对话</span><span class="nav-en">CHATTING</span></span>
        </router-link>
        <router-link to="/memory" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label"><span class="nav-zh">记忆</span><span class="nav-en">MEMORY</span></span>
        </router-link>
        <router-link to="/kb" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label"><span class="nav-zh">知识库</span><span class="nav-en">KB</span></span>
        </router-link>
        <router-link to="/activity" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label"><span class="nav-zh">活动</span><span class="nav-en">ACTIVITY</span></span>
        </router-link>
        <router-link to="/playground" class="nav-item pg-nav">动态 NEWS</router-link>
        <AppSettingsMenu
          :onboarding-enabled="onboardingEnabled"
          @restart-onboarding="restartOnboarding"
        />
      </nav>
      <SessionSidebar
        :sessions="sessions"
        :active-id="sessionId"
        :session-statuses="allSessionStatuses"
        :collapsed="effectiveCollapsed"
        @create="createSession"
        @switch="handleSwitchSession"
        @delete="deleteSession"
        @constify="handleConstify"
        @unconstify="handleUnconstify"
      />
      <PulsePanel v-if="health && pulseEnabled" :health="health" />
      <HealthPanel v-else-if="health" :health="health" />
    </aside>
    <!-- 悬停滑入侧边栏 -->
    <FloatSidebar />
    <main class="main">
      <RegionalErrorBoundary :reset-keys="[$route.path]">
        <router-view v-slot="{ Component }">
          <keep-alive include="ChatView">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </RegionalErrorBoundary>
    </main>
    <!-- 树阴光影氛围层 -->
    <LeavesOverlay />
    <!-- 全屏媒体查看器 -->
    <MediaViewer />
    <OnboardingView
      v-if="onboarding.shouldShow"
      :health="health"
      @open-providers="openProviderSetup"
    />
  </div>
</template>

<script setup lang="ts">
import HealthPanel from '@/components/HealthPanel.vue';
import PulsePanel from '@/components/PulsePanel.vue';
import OnboardingView from '@/views/OnboardingView.vue';
import Icon from '@/components/Icon.vue';
import SessionSidebar from '@/components/SessionSidebar.vue';
import AppSettingsMenu from '@/components/AppSettingsMenu.vue';
import { useChatStore } from '@/stores/chat';
import { useHealthStore } from '@/stores/health';
import { onboardingEnabled, useOnboardingStore } from '@/stores/onboarding';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { useSidebar } from '@/composables/useSidebar';
import { onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

import LeavesOverlay from '@/components/LeavesOverlay.vue'
import MediaViewer from '@/components/MediaViewer.vue'
import FloatSidebar from '@/components/FloatSidebar.vue'
import { useFloatSidebar } from '@/composables/useFloatSidebar'
import { usePaperTexture } from '@/composables/usePaperTexture'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
import RegionalErrorBoundary from '@/components/ui/RegionalErrorBoundary.vue'

const { effectiveCollapsed, toggleSidebar } = useSidebar()
const pulseEnabled = import.meta.env.VITE_PULSE_ENABLED === 'true'
const onboarding = useOnboardingStore()

const { onEnter: onFloatSidebarEnter, onLeave: onFloatSidebarLeave } = useFloatSidebar()

function restartOnboarding() {
  onboarding.restart()
}

function onSidebarClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    toggleSidebar()
  }
}

const router = useRouter()

function handleSwitchSession(id: string) {
  switchSession(id)
  router.push('/')
}

function openProviderSetup() {
  onboarding.complete()
  router.push('/providers')
}

function handleConstify(id: string, name: string) {
  if (name && name.trim()) {
    sessionStore.constifySession(id, name.trim())
  }
}

function handleUnconstify(id: string) {
  if (window.confirm('确定取消固定此会话？')) {
    sessionStore.unconstifySession(id)
  }
}

const sessionStore = useSessionStore()
const { sessionId, sessions } = storeToRefs(sessionStore)
const { createSession, switchSession, deleteSession } = sessionStore

useGlobalShortcut({ key: 'n', mod: true, allowInEditable: true }, () => {
  void createSession().then(() => router.push('/'))
})

const chatStore = useChatStore()
const { allSessionStatuses } = storeToRefs(chatStore)

const healthStore = useHealthStore()
const { health } = storeToRefs(healthStore)

onMounted(async () => {
  // 初始化 Session 状态（从 localStorage 恢复或创建新会话）
  await sessionStore.initIfNeeded()
  healthStore.startPolling()
  onboarding.initialize()

  // 初始化纸质纹理 body class
  const { enabled: paperTextureEnabled } = usePaperTexture()
  document.body.classList.toggle('paper-texture', paperTextureEnabled.value)
})

// 监听健康状态：后端从离线恢复到在线时，自动刷新会话列表
// 修复：页面刷新时如果后端还在启动，initIfNeeded 的 refreshSessions 可能失败，
// 此处作为兜底，在后端就绪后自动补刷会话列表
watch(health, (newHealth, oldHealth) => {
  if (!oldHealth && newHealth) {
    // 从 null（离线）变为有值（在线），刷新会话列表
    sessionStore.refreshSessions().catch((err) => console.warn('[App] refreshSessions failed:', err))
  }
})
</script>

<style>
@import '@/assets/styles/tokens.css';
@import '@/assets/styles/animations.css';
@import '@/assets/styles/design-system.css';
@import '@/assets/styles/markdown.css';
@import '@/assets/styles/paper-texture.css';
@import '@/themes/warm-paper.css';
@import '@/themes/midnight.css';
@import '@/themes/high-contrast.css';
@import '@/themes/grass-aroma.css';
@import '@/themes/contemplation.css';
@import '@/themes/coral.css';
@import '@/themes/delve.css';
@import '@/themes/deep-think.css';
@import '@/themes/absolutely.css';
@import '@/themes/dawn.css';
@import '@/themes/midnight-contrast.css';

*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  /* 配色变量由主题文件定义（web/src/themes/*.css），结构 token 由 tokens.css 定义 */
  --radius: var(--radius-md);
  --shadow: var(--shadow-md);
  --shadow-pink: 0 4px 16px var(--shadow-color, rgba(0, 0, 0, 0.18));
}

::selection {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--text-primary);
}

/* ── Scrollbar ── */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
*::-webkit-scrollbar-track {
  background: transparent;
}
*::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

html, body {
  height: 100%;
  font-family: var(--font-body);
  /* 响应式字体：15px 基准，随视口宽度自适应缩放（1920px≈16px, 2560px≈18px） */
  font-size: clamp(15px, 14px + 0.2vw, 18px);
  color: var(--text-primary);
  background: var(--bg-primary);
}

#app {
  height: 100%;
}

.app-layout {
  display: flex;
  height: 100%;
}

.sidebar-hover-trigger {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 8px;
  z-index: 140;
  cursor: default;
}

.sidebar {
  width: 220px;
  min-width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 24px 20px;
  gap: 24px;
  position: relative;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: center;
  transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;
  overflow: hidden;
  max-height: 100px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 700;
  font-family: var(--font-display);
  color: var(--accent);
  letter-spacing: -0.3px;
  margin: 0;
}

.logo-img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.logo-text {
  white-space: nowrap;
}

.logo-favicon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
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

.nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.nav-item.router-link-active {
  background: var(--bg-card);
  color: var(--accent);
  font-weight: 600;
}

.nav-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;
  overflow: hidden;
  white-space: nowrap;
  max-width: 200px;
}
.nav-en {
  font-size: 0.75em;
  color: var(--text-tertiary);
  letter-spacing: 0.5px;
}

.pg-nav {
  margin-top: 16px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  border-radius: 0;
  font-size: 0.8em;
  color: var(--text-secondary);
  opacity: 0.7;
}

.pg-nav:hover {
  opacity: 1;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar .health-panel {
  transition: opacity 0.2s ease 0.05s;
  overflow: hidden;
  max-height: 300px;
}

/* ── Collapsible sidebar ── */
.sidebar {
  position: relative;
  transition: width 0.25s ease;
}
.sidebar.collapsed {
  width: 58px;
  min-width: 58px;
  padding: 24px 10px;
  align-items: center;
  overflow: hidden;
}
.sidebar-icon-collapsed {
  display: none;
  justify-content: center;
}
.sidebar.collapsed .sidebar-header {
  max-height: 0;
  opacity: 0;
  transform: translateX(-30px);
  overflow: hidden;
  padding: 0;
  margin: 0;
}
.sidebar.collapsed .sidebar-icon-collapsed {
  display: flex;
  position: absolute;
  top: 22px;
  left: 50%;
  transform: translateX(-50%);
}
.sidebar.collapsed .sidebar-nav {
  width: 100%;
  align-items: center;
  padding-top: 10px;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 8px;
  gap: 0;
  width: 100%;
  overflow: hidden;
}
.sidebar.collapsed .nav-label {
  max-width: 0;
  opacity: 0;
  transform: translateX(-24px);
  overflow: hidden;
  white-space: nowrap;
  padding: 0;
  margin: 0;
}
.sidebar.collapsed .pg-nav {
  display: none;
}
.sidebar.collapsed .health-panel {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  padding: 0;
  margin: 0;
}

/* ── Sidebar background image with blur + white overlay ── */
.sidebar::before {
  content: '';
  position: absolute;
  inset: -5%;
  background-image: url('/images/sidebar-bg.jpg');
  background-size: cover;
  background-position: left center;
  background-repeat: no-repeat;
  filter: blur(10px);
  transform: scale(1.05);
  z-index: 0;
  pointer-events: none;
}

.sidebar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
  z-index: 0;
  pointer-events: none;
}

.sidebar > * {
  position: relative;
  z-index: 1;
}
</style>
