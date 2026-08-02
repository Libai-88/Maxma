<template>
  <div class="app-layout" :style="sidebarBgStyle">
    <Dock
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
        <router-view v-slot="{ Component, route }">
          <Transition :name="pageTransition" mode="out-in">
            <!-- :key=route.name 保证 keep-alive 缓存稳定（ChatView 切换回来不重建） -->
            <keep-alive include="ChatView" :max="5">
              <component :is="Component" :key="route.name" />
            </keep-alive>
          </Transition>
        </router-view>
      </RegionalErrorBoundary>
    </main>
    <!-- 保留全局媒体与引导层，布局本身不依赖装饰层。 -->
    <AuroraBackground :opacity="0.12" :aurora-count="3" />
    <LiquidBackground />
    <CursorGlow />
    <SmoothCursor />
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
    <!-- 全局确认对话框（替代 window.confirm） -->
    <ConfirmDialog />
    <!-- Konami Code 惊喜彩蛋：全屏星芒 + 品牌印章，自动消失（pointer-events: none 不挡操作） -->
    <Transition name="konami">
      <div v-if="konamiShow" class="konami-overlay" role="status" aria-live="polite">
        <div class="konami-stars" aria-hidden="true"></div>
        <div class="konami-stars konami-stars--2" aria-hidden="true"></div>
        <BrandSeal size="lg" class="konami-seal" />
        <p class="konami-msg">✦ 彩蛋达成，愿你今天事事顺心 ✦</p>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import OnboardingView from '@/views/OnboardingView.vue';
import Dock from '@/components/inspira/Dock.vue';
import SessionDrawer from '@/components/SessionDrawer.vue';
import { useChatStore } from '@/stores/chat';
import { onboardingEnabled, useOnboardingStore } from '@/stores/onboarding';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { defineAsyncComponent, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import LeavesOverlay from '@/components/LeavesOverlay.vue'
import CursorGlow from '@/components/CursorGlow.vue'
import SmoothCursor from '@/components/inspira/SmoothCursor.vue'
import AuroraBackground from '@/components/inspira/AuroraBackground.vue'
import LiquidBackground from '@/components/LiquidBackground.vue'
import { usePaperTexture } from '@/composables/usePaperTexture'
import { useGlobalShortcut } from '@/composables/useGlobalShortcut'
import { useHealthPolling } from '@/composables/useHealthPolling'
import { initCapabilities } from '@/composables/useCapabilities'
import RegionalErrorBoundary from '@/components/ui/RegionalErrorBoundary.vue'
import DsToast from '@/components/ui/DsToast.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import BrandSeal from '@/components/brand/BrandSeal.vue'
import { confirmAction } from '@/composables/useConfirm'
import { useKonami } from '@/composables/useKonami'
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

// 差异化页面转场：direction（前进/后退）由 history.position 判断，
// transition 类型（flip/slide/rise/zoom）由目标路由 meta.transition 决定。
// 组合为 `page-{type}-{direction}`，实现每个页面不同的入场个性动画。
// 首次加载 / direction 未知 → 回退 page-fade。
const pageTransition = ref('page-fade')
let lastNavPosition = 0
router.beforeResolve((to) => {
  const pos = (window.history.state as { position?: number } | null)?.position ?? 0
  const type = (to.meta.transition as string | undefined) ?? 'flip'
  const direction = pos > lastNavPosition ? 'forward' : pos < lastNavPosition ? 'back' : null
  lastNavPosition = pos
  pageTransition.value = direction ? `page-${type}-${direction}` : 'page-fade'
})

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

async function handleUnconstify(id: string) {
  if (await confirmAction({ message: '确定取消固定此会话？', confirmText: '取消固定' })) {
    sessionStore.unconstifySession(id)
  }
}

// ── Konami Code 惊喜彩蛋：印章 + 星芒环扩散，自动消失 ──
const konamiShow = ref(false)
let konamiTimer: ReturnType<typeof setTimeout> | null = null
useKonami(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  konamiShow.value = true
  if (konamiTimer) clearTimeout(konamiTimer)
  konamiTimer = setTimeout(() => { konamiShow.value = false }, 2600)
})

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

const sidebarBgUrl = `${import.meta.env.BASE_URL}images/sidebar-bg.jpg`
const sidebarBgStyle = { '--sidebar-bg-image': `url("${sidebarBgUrl}")` }

onMounted(async () => {
  // 初始化 Session 状态（从 localStorage 恢复或创建新会话）
  const initialized = await sessionStore.initIfNeeded()
  if (!initialized) {
    globalErrorToast.message = '会话初始化失败，请检查后端服务后重试'
    globalErrorToast.visible = true
  }
  onboarding.initialize()

  // Phase 4：启动能力发现 —— 拉取能力清单并开启 5 分钟后台轮询。
  initCapabilities()

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
/* ══ 主题系统 v2.0 — 6 主题（旗舰/变体/保留） ══ */
@import '@/themes/suying.css';
@import '@/themes/ultraline.css';
@import '@/themes/night.css';
@import '@/themes/kintsugi.css';
@import '@/themes/grass.css';
@import '@/themes/midnight.css';

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

/* ── 主题切换过渡动画 ── */
@media (prefers-reduced-motion: no-preference) {
  html {
    transition: background-color 0.3s ease;
  }
  body {
    scrollbar-color: var(--border) transparent;
    transition: background-color 0.25s ease, color 0.25s ease,
                border-color 0.25s ease, scrollbar-color 0.25s ease;
  }
  .app-layout,
  .main {
    transition: background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease;
  }
}

/* ── 路由级过渡（router-view Transition） ── */
/* 差异化转场：transition 类型（flip/slide/rise/zoom）× 方向（forward/back）。
   每种页面有个性化的入场/出场动画；direction 未知/首载回退 fade。
   所有转场 reduce-motion 降级为无过渡。 */
.page-fade-enter-active,
.page-fade-leave-active,
.page-flip-forward-enter-active, .page-flip-forward-leave-active,
.page-flip-back-enter-active,   .page-flip-back-leave-active,
.page-slide-forward-enter-active, .page-slide-forward-leave-active,
.page-slide-back-enter-active,   .page-slide-back-leave-active,
.page-rise-forward-enter-active, .page-rise-forward-leave-active,
.page-rise-back-enter-active,   .page-rise-back-leave-active,
.page-zoom-forward-enter-active, .page-zoom-forward-leave-active,
.page-zoom-back-enter-active,   .page-zoom-back-leave-active {
  transition: opacity 0.32s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              transform 0.32s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.page-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── flip：3D 翻转（主内容页，如对话/记忆/动态） ── */
.page-flip-forward-enter-from {
  opacity: 0;
  transform: perspective(1400px) rotateY(-24deg) translateX(60px) scale(0.96);
  transform-origin: left center;
}
.page-flip-forward-leave-to {
  opacity: 0;
  transform: perspective(1400px) rotateY(16deg) translateX(-40px) scale(0.97);
  transform-origin: right center;
}
.page-flip-back-enter-from {
  opacity: 0;
  transform: perspective(1400px) rotateY(24deg) translateX(-60px) scale(0.96);
  transform-origin: right center;
}
.page-flip-back-leave-to {
  opacity: 0;
  transform: perspective(1400px) rotateY(-16deg) translateX(40px) scale(0.97);
  transform-origin: left center;
}

/* ── slide：水平滑入（设置类，如外观/角色/用户/隐私） ── */
.page-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(48px);
}
.page-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-32px);
}
.page-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-48px);
}
.page-slide-back-leave-to {
  opacity: 0;
  transform: translateX(32px);
}

/* ── rise：上升浮入（工具类，如模型/插件/规则/自动化） ── */
.page-rise-forward-enter-from,
.page-rise-back-enter-from {
  opacity: 0;
  transform: translateY(36px);
}
.page-rise-forward-leave-to,
.page-rise-back-leave-to {
  opacity: 0;
  transform: translateY(-24px);
}

/* ── zoom：缩放淡入（详情/特殊页，如插件详情/分享/404） ── */
.page-zoom-forward-enter-from,
.page-zoom-back-enter-from {
  opacity: 0;
  transform: scale(0.9);
}
.page-zoom-forward-leave-to,
.page-zoom-back-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active, .page-fade-leave-active,
  .page-flip-forward-enter-active, .page-flip-forward-leave-active,
  .page-flip-back-enter-active, .page-flip-back-leave-active,
  .page-slide-forward-enter-active, .page-slide-forward-leave-active,
  .page-slide-back-enter-active, .page-slide-back-leave-active,
  .page-rise-forward-enter-active, .page-rise-forward-leave-active,
  .page-rise-back-enter-active, .page-rise-back-leave-active,
  .page-zoom-forward-enter-active, .page-zoom-forward-leave-active,
  .page-zoom-back-enter-active, .page-zoom-back-leave-active {
    transition: none;
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
  position: relative;
  display: flex;
  width: 100%;
  max-width: 100%;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
}

.app-layout {
  padding-left: var(--icon-rail-width, 84px);
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
  /* 页面转场 3D 透视：router-view 翻转出入场提供深度 */
  perspective: 1400px;
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
  background-image: var(--sidebar-bg-image);
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

/* ── Konami Code 彩蛋 ── */
.konami-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 55%);
}
.konami-stars {
  position: absolute;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 35%, transparent);
  animation: maxma-konami-ring 0.9s ease-out infinite;
}
.konami-stars::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 25%, transparent);
  animation: maxma-konami-ring 0.9s ease-out 0.3s infinite;
}
.konami-stars--2 {
  width: 240px;
  height: 240px;
  animation-delay: 0.6s;
}
@keyframes maxma-konami-ring {
  0%   { transform: scale(0.35); opacity: 0.9; }
  100% { transform: scale(1.8);  opacity: 0; }
}
.konami-seal {
  position: relative;
  animation: maxma-konami-seal-pop 0.65s var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
}
@keyframes maxma-konami-seal-pop {
  0%   { transform: scale(0.4) rotate(-18deg); opacity: 0; }
  60%  { transform: scale(1.14) rotate(2deg);  opacity: 1; }
  100% { transform: scale(1)    rotate(0deg);  opacity: 1; }
}
.konami-msg {
  position: relative;
  font-family: var(--font-display);
  font-size: var(--fs-ui);
  letter-spacing: 0.3px;
  color: var(--text-primary);
  animation: maxma-konami-msg-in 0.4s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) 0.18s both;
}
@keyframes maxma-konami-msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.konami-enter-active,
.konami-leave-active {
  transition: opacity 0.3s ease;
}
.konami-enter-from,
.konami-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .konami-stars,
  .konami-stars::after,
  .konami-seal,
  .konami-msg {
    animation: none;
  }
}
</style>
