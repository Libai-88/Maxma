<template>
  <div class="app-layout">
    <IconRail
      :onboarding-enabled="onboardingEnabled"
      :session-drawer-open="sessionDrawerOpen"
      @toggle-session-drawer="openSessionDrawer"
      @restart-onboarding="restartOnboarding"
    />
    <SessionDrawer
      :open="sessionDrawerOpen"
      :sessions="sessions"
      :active-id="sessionId"
      :session-statuses="allSessionStatuses"
      @close="closeSessionDrawer"
      @create="handleCreateSession"
      @switch="handleSwitchSession"
      @delete="deleteSession"
      @constify="handleConstify"
      @unconstify="handleUnconstify"
    />
    <main id="main-content" class="main" tabindex="-1" aria-label="对话工作区">
      <RegionalErrorBoundary :reset-keys="[$route.path]">
        <router-view v-slot="{ Component }">
          <keep-alive include="ChatView">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </RegionalErrorBoundary>
    </main>
    <!-- 保留全局媒体与引导层，布局本身不依赖装饰层。 -->
    <LeavesOverlay />
    <!-- 全屏媒体查看器 -->
    <MediaViewer />
    <OnboardingView
      v-if="onboarding.shouldShow"
      :health="health"
      @open-providers="openProviderSetup"
    />
    <!-- 全局错误通知 toast（监听 maxma:error 事件） -->
    <DsToast
      v-model:visible="globalErrorToast.visible"
      :message="globalErrorToast.message"
      type="error"
      :duration="6000"
      dismissible
    />
  </div>
</template>

<script setup lang="ts">
import OnboardingView from '@/views/OnboardingView.vue';
import IconRail from '@/components/IconRail.vue';
import SessionDrawer from '@/components/SessionDrawer.vue';
import { useChatStore } from '@/stores/chat';
import { onboardingEnabled, useOnboardingStore } from '@/stores/onboarding';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { defineAsyncComponent, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import LeavesOverlay from '@/components/LeavesOverlay.vue'
import { usePaperTexture } from '@/composables/usePaperTexture'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
import { useHealthPolling } from '@/composables/useHealthPolling'
import RegionalErrorBoundary from '@/components/ui/RegionalErrorBoundary.vue'
import DsToast from '@/components/ui/DsToast.vue'
import { reactive, ref } from 'vue'

const MediaViewer = defineAsyncComponent(() => import('@/components/MediaViewer.vue'))
const onboarding = useOnboardingStore()
const sessionDrawerOpen = ref(false)

// 初始化纸质纹理 — 在顶层调用 composable，确保 reactive context 正确
const { enabled: paperTextureEnabled } = usePaperTexture()
document.body.classList.toggle('paper-texture', paperTextureEnabled.value)

function openSessionDrawer() {
  sessionDrawerOpen.value = true
}

function closeSessionDrawer() {
  sessionDrawerOpen.value = false
}

const router = useRouter()

async function handleCreateSession() {
  await createSession()
  closeSessionDrawer()
  await router.push('/')
}

async function handleSwitchSession(id: string) {
  await switchSession(id)
  closeSessionDrawer()
  router.push('/')
}

function openProviderSetup() {
  onboarding.complete()
  router.push('/providers')
}

function restartOnboarding() {
  onboarding.restart()
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

const { health } = useHealthPolling()

/** 全局错误 toast 状态（由 maxma:error 事件驱动） */
const globalErrorToast = reactive({
  visible: false,
  message: '',
})

onMounted(async () => {
  // 初始化 Session 状态（从 localStorage 恢复或创建新会话）
  await sessionStore.initIfNeeded()
  onboarding.initialize()

  // 修复 BC-003：监听 maxma:error 事件，显示用户可见的 toast 通知。
  // 该事件由 main.ts 中的全局 Vue errorHandler 派发。
  window.addEventListener('maxma:error', ((e: CustomEvent) => {
    const detail = e.detail
    globalErrorToast.message = detail.message || '发生了意外错误'
    globalErrorToast.visible = true
    console.debug('[App] maxma:error event received, showing toast:', detail.message)
  }) as EventListener)
})
</script>

<style>
@import '@/assets/styles/tokens.css';
@import '@/assets/styles/animations.css';
@import '@/assets/styles/design-system.css';
@import '@/assets/styles/markdown.css';
@import '@/assets/styles/paper-texture.css';
@import '@/themes/warm-precision.css';
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
	  --shadow-pink: 0 4px 16px var(--shadow-color, rgba(120, 100, 80, 0.14));
	}

::selection {
	  background: color-mix(in srgb, var(--accent) 20%, transparent);
	  color: var(--text-primary);
	}

/* ── Focus-visible 兜底（排除原生表单控件） ── */
:focus-visible:not(input):not(textarea):not(select):not([contenteditable]) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ── 主题切换过渡动画（仅布局容器，不泛化到所有元素） ── */
@media (prefers-reduced-motion: no-preference) {
  html {
    transition: background-color 0.3s ease;
  }
  body,
  .app-layout,
  .main {
    transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
  }
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
  width: 100%;
  max-width: 100%;
  min-height: 100%;
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-body);
  /* 响应式字体：15px 基准，随视口宽度自适应缩放（1920px≈16px, 2560px≈18px） */
	  font-size: clamp(16px, 15px + 0.2vw, 18px);
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-primary);
}

#app {
  height: 100%;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.app-layout {
  display: flex;
  width: 100%;
  max-width: 100%;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
}

.app-layout > .icon-rail {
  flex: 0 0 var(--icon-rail-width);
  width: var(--icon-rail-width);
  min-width: var(--icon-rail-width);
}

.app-layout > .main {
  flex: 1 1 auto;
  width: 0;
  max-width: 100%;
}

/* Route views and their flex descendants must not enlarge the document. */
:where(.chat-view, .chat-workbench-layout, .chat-main-column, .chat-window, .chat-input-wrapper) {
  min-width: 0;
  max-width: 100%;
}

:where(.chat-view, .chat-workbench-layout, .chat-main-column) {
  min-height: 0;
  overflow-x: hidden;
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
	  width: 240px;
	  min-width: 240px;
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
  transition: opacity 0.2s ease;
}

.logo-img {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .logo:hover .logo-img {
    transform: scale(1.06);
    box-shadow: 0 0 0 2px var(--accent);
  }
  .logo:hover .logo-text {
    opacity: 0.8;
  }
}

.logo-text {
  white-space: nowrap;
  transition: opacity 0.2s ease;
}

.logo-favicon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  transition: transform 0.2s ease;
}
@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) {
  .sidebar.collapsed .logo-favicon:hover {
    transform: scale(1.1);
  }
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
	  padding: 10px 14px;
	  border-radius: var(--radius);
	  color: var(--text-secondary);
	  text-decoration: none;
	  font-size: 0.95em;
	  transition: background 0.15s, color 0.15s;
	}

.nav-item:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.nav-item.router-link-active {
	  background: var(--accent-soft, transparent);
	  color: var(--accent);
	  font-weight: 600;
	}

.nav-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
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
  width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary) 72%, transparent);
}

.sidebar .health-panel {
  transition: opacity 0.2s ease 0.05s;
  overflow: hidden;
  max-height: 300px;
}

/* ── Collapsible sidebar ── */
.sidebar {
  position: relative;
  will-change: width;
}
@media (prefers-reduced-motion: no-preference) {
  .sidebar {
    transition: width 0.25s var(--ease-out);
  }
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

/* ── Sidebar background image with blur + overlay ── */
.sidebar::before {
  content: '';
  position: absolute;
  inset: -5%;
  background-image: var(--sidebar-bg-image, url('/images/sidebar-bg.jpg'));
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
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
	  z-index: 0;
	  pointer-events: none;
	}
	
	.sidebar > * {
  position: relative;
  z-index: 1;
}
</style>
