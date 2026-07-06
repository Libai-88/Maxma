<template>
  <div class="app-layout" :class="{ 'night-mode': isNightMode }">
    <aside class="sidebar" :class="{ collapsed: effectiveCollapsed }" @click="onSidebarClick">
      <div class="sidebar-header">
        <h1 class="logo">
          <img src="@/assets/images/brand/logo-hero-opt.jpg" alt="MaxmaHere" class="logo-img" />
          <span class="logo-text">MaxmaHere</span>
        </h1>
      </div>
      <div class="sidebar-icon-collapsed">
        <img src="@/assets/images/brand/favicon.png" alt="MaxmaHere" class="logo-favicon" />
      </div>
      <nav class="sidebar-nav">
        <router-link to="/" class="nav-item">
          <Icon name="chat" :size="18" /> <span class="nav-label">对话&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;CHATTING</span>
        </router-link>
        <router-link to="/memory" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label">记忆&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MEMORY</span>
        </router-link>
        <router-link to="/kb" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label">知识库&nbsp;&nbsp;&nbsp;&nbsp;KB</span>
        </router-link>
        <router-link to="/playground" class="nav-item pg-nav">动态 NEWS</router-link>
        <div class="settings-area" ref="settingsTriggerRef">
          <button class="nav-item settings-btn" :class="{ active: showSettingsMenu }" @click="toggleSettingsMenu">
            <Icon name="settings" :size="18" /> <span class="nav-label">设置&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;SETTINGS</span>
          </button>
        </div>
      </nav>
      <Transition name="popup">
        <div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" :style="{ top: popupTop, left: popupLeft }" @click.stop>
          <div class="popup-header">设置</div>
          <router-link to="/providers" class="popup-item" @click="closeSettingsMenu">模型 MODELS</router-link>
          <router-link to="/mcp" class="popup-item" @click="closeSettingsMenu">MCP 服务</router-link>
          <router-link to="/skills" class="popup-item" @click="closeSettingsMenu">Skills & 宏</router-link>
          <router-link to="/soul" class="popup-item" @click="closeSettingsMenu">人设 SOUL</router-link>
          <router-link to="/user" class="popup-item" @click="closeSettingsMenu">用户 USER</router-link>
          <router-link to="/path-whitelist" class="popup-item" @click="closeSettingsMenu">路径白名单</router-link>
          <router-link to="/maxma-blocker" class="popup-item" @click="closeSettingsMenu">拒止锚</router-link>
          <router-link to="/env-vars" class="popup-item" @click="closeSettingsMenu">环境变量</router-link>
          <router-link to="/event-hooks" class="popup-item" @click="closeSettingsMenu">事件钩子</router-link>
          <router-link to="/privacy" class="popup-item" @click="closeSettingsMenu">隐私仪表盘</router-link>
          <router-link to="/metrics" class="popup-item" @click="closeSettingsMenu">运行指标</router-link>
          <router-link to="/audit-log" class="popup-item" @click="closeSettingsMenu">审计日志</router-link>
          <div class="popup-divider"></div>
          <button class="popup-item popup-action neutral" @click="cycleNightModeSetting">
            深夜模式：{{ nightModeLabel }}
          </button>
          <button class="popup-item popup-action" :class="{ restarting }" :disabled="restarting" @click="handleRestart">
            {{ restarting ? '重启中...' : '重启服务' }}
          </button>
        </div>
      </Transition>
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
      <HealthPanel :health="health!" v-if="health" />
    </aside>
    <main class="main">
      <router-view v-slot="{ Component }">
        <keep-alive include="ChatView">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import HealthPanel from '@/components/HealthPanel.vue';
import Icon from '@/components/Icon.vue';
import SessionSidebar from '@/components/SessionSidebar.vue';
import { useChatStore } from '@/stores/chat';
import { useHealthStore } from '@/stores/health';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { useSidebar } from '@/composables/useSidebar';
import { api } from '@/api';
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useNightModeClock } from '@/composables/useNightMode'

const { effectiveCollapsed, toggleSidebar } = useSidebar()

const showSettingsMenu = ref(false)
const settingsTriggerRef = ref<HTMLElement | null>(null)
const settingsPopupRef = ref<HTMLElement | null>(null)
const popupTop = ref('0px')
const popupLeft = ref('228px')
const restarting = ref(false)
const { nightModeSetting, isNightMode, cycleNightModeSetting } = useNightModeClock()
const nightModeLabel = computed(() =>
  nightModeSetting.value === 'auto' ? '自动'
  : nightModeSetting.value === 'on' ? '开启'
  : '关闭'
)

async function handleRestart() {
  if (restarting.value) return
  if (!window.confirm('确定要重启 MaxmaHere 服务吗？正在进行的对话可能会中断。')) return
  restarting.value = true
  closeSettingsMenu()
  api.restart()
  const poll = async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        await api.health()
        location.reload(); return
      } catch { /* still down */ }
    }
    restarting.value = false
  }
  poll()
}

function toggleSettingsMenu() {
  showSettingsMenu.value = !showSettingsMenu.value
  nextTick(() => updatePopupPosition())
}

function closeSettingsMenu() {
  showSettingsMenu.value = false
}

function updatePopupPosition() {
  if (settingsTriggerRef.value) {
    const rect = settingsTriggerRef.value.getBoundingClientRect()
    popupTop.value = `${rect.top}px`
    popupLeft.value = `${rect.right + 8}px`
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!showSettingsMenu.value) return
  const trigger = settingsTriggerRef.value
  const popup = settingsPopupRef.value
  if (trigger && popup &&
      !trigger.contains(e.target as Node) &&
      !popup.contains(e.target as Node)) {
    closeSettingsMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

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

const chatStore = useChatStore()
const { allSessionStatuses } = storeToRefs(chatStore)

const healthStore = useHealthStore()
const { health } = storeToRefs(healthStore)

onMounted(async () => {
  // 初始化 Session 状态（从 localStorage 恢复或创建新会话）
  await sessionStore.initIfNeeded()
  healthStore.startPolling()
})

// 监听健康状态：后端从离线恢复到在线时，自动刷新会话列表
// 修复：页面刷新时如果后端还在启动，initIfNeeded 的 refreshSessions 可能失败，
// 此处作为兜底，在后端就绪后自动补刷会话列表
watch(health, (newHealth, oldHealth) => {
  if (!oldHealth && newHealth) {
    // 从 null（离线）变为有值（在线），刷新会话列表
    sessionStore.refreshSessions().catch(() => {})
  }
})
</script>

<style>
@import '@/assets/styles/design-system.css';

*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f9fafb;
  --bg-card: #ffffff;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;
  --accent: #000000;
  --accent-light: #b9b9b9;
  --accent-pink: #FF6B9D;
  --accent-pink-light: #FF8FAB;
  --accent-pink-soft: rgba(255, 107, 157, 0.1);
  --border: #e5e7eb;
  --user-bubble: #ffffff;
  --status-ok: #000000;
  --status-error: #ef4444;
  --status-warn: #f59e0b;
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.08);       /* 兼容别名，同级 --shadow-md */
  --shadow-xs: 0 1px 3px rgba(0, 0, 0, 0.04);   /* 极浅分割 */
  --shadow-soft: 0 8px 24px rgba(0, 0, 0, 0.06); /* 大面积超浅阴影（输入框） */
  --shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.06);   /* 卡片、条目 hover */
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);   /* 气泡、通用卡片 */
  --shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.12);  /* 下拉菜单、浮层 */
  --shadow-xl: 0 6px 28px rgba(0, 0, 0, 0.18);  /* 模态弹窗、重型浮层 */
  --shadow-pink: 0 4px 16px rgba(255, 107, 157, 0.3);  /* 粉色光晕 */
  --radius: 10px;
  --font-display: 'ZCOOL KuaiLe', 'Comic Sans MS', cursive;
  --font-body: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}

::selection {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: #000000;
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

.app-layout.night-mode {
  --bg-primary: #f4eadc;
  --bg-secondary: #ede1d1;
  --bg-card: #fff5e6;
  --user-bubble: #fff1dc;
  --text-primary: #2a2118;
  --text-secondary: #756657;
  --text-tertiary: #a08f7f;
  --accent: #2b2117;
  --accent-light: #b79d82;
  --accent-pink: #d87974;
  --accent-pink-light: #e59a8e;
  --accent-pink-soft: rgba(216, 121, 116, 0.14);
  --border: #dccbbb;
  --shadow: 0 2px 8px rgba(73, 45, 25, 0.08);
  --shadow-soft: 0 8px 24px rgba(73, 45, 25, 0.06);
  --shadow-sm: 0 1px 4px rgba(73, 45, 25, 0.06);
  --shadow-md: 0 2px 8px rgba(73, 45, 25, 0.08);
  --shadow-lg: 0 4px 16px rgba(73, 45, 25, 0.14);
  --shadow-xl: 0 6px 28px rgba(73, 45, 25, 0.18);
  --shadow-pink: 0 4px 16px rgba(216, 121, 116, 0.28);

  background:
    linear-gradient(rgba(52, 36, 22, 0.16), rgba(52, 36, 22, 0.16)),
    var(--bg-primary);
  color: var(--text-primary);
}

.app-layout.night-mode .chat-window {
  background:
    radial-gradient(circle at 20% 0%, rgba(255, 214, 168, 0.34), transparent 32%),
    linear-gradient(rgba(45, 28, 16, 0.08), rgba(45, 28, 16, 0.08)),
    var(--bg-primary);
}

.app-layout.night-mode .markdown-body,
.app-layout.night-mode .bubble {
  line-height: 1.72;
  font-weight: 350;
}

/* 夜间模式：空状态使用更柔和的深色背景图 */
.app-layout.night-mode .empty-state {
  background-image: url('@/assets/images/brand/empty-bg-night.jpg');
}
.app-layout.night-mode .empty-state-overlay {
  background: linear-gradient(to bottom, transparent 40%, rgba(244, 234, 220, 0.5) 100%);
}
.app-layout.night-mode .empty-title {
  text-shadow: 0 2px 16px rgba(244, 234, 220, 0.55);
}
.app-layout.night-mode .empty-desc {
  text-shadow: 0 1px 12px rgba(244, 234, 220, 0.55);
}
.app-layout.night-mode .quick-hints {
  text-shadow: 0 1px 8px rgba(244, 234, 220, 0.5);
}

.app-layout.night-mode .sidebar::after {
  background: rgba(255, 245, 230, 0.86);
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
  transition: opacity 0.2s ease 0.05s, transform 0.25s ease 0.05s;
  overflow: hidden;
  white-space: nowrap;
  max-width: 200px;
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

/* ── Settings trigger ── */
.settings-area {
  margin-top: auto;
}

.settings-btn {
  width: 100%;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9em;
  background: transparent;
}

.settings-btn.active {
  background: var(--bg-card);
  color: var(--accent);
  font-weight: 600;
}

.settings-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

/* ── Settings popup ── */
.settings-popup {
  position: fixed;
  z-index: 200;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  min-width: 170px;
  padding: 6px;
  overflow: hidden;
}

.popup-header {
  padding: 8px 12px 6px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.popup-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9em;
  transition: background 0.15s, color 0.15s;
}

.popup-item:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.popup-item.router-link-active {
  color: var(--accent);
  font-weight: 600;
  background: var(--bg-secondary);
}

.popup-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.popup-action {
  width: 100%;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9em;
  background: transparent;
  color: #dc2626;
}
.popup-action.neutral {
  color: var(--text-secondary);
}
.popup-action.neutral:hover {
  color: var(--text-primary);
}
.popup-action:hover:not(:disabled) {
  background: var(--bg-secondary);
  color: #b91c1c;
}
.popup-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.popup-action.restarting {
  color: #f59e0b;
}

/* ── Popup transition ── */
.popup-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.popup-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translateX(-6px);
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

.sidebar > :not(.settings-popup) {
  position: relative;
  z-index: 1;
}

/* ── 无障碍：减少动画 ── */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .typewriter-cursor { display: none; }
}

/* ── Shared markdown rendered content ── */
.markdown-body {
  font-size: 1.05em; /* 相对于父元素（消息气泡）的字体大小 */
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body h1 { font-size: 1.5em; }
.markdown-body h2 { font-size: 1.3em; }
.markdown-body h3 { font-size: 1.15em; }
.markdown-body h4 { font-size: 1em; }
.markdown-body h5 { font-size: 0.9em; }
.markdown-body h6 { font-size: 0.85em; color: var(--text-secondary); }

.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child  { margin-bottom: 0; }

.markdown-body p {
  margin: 8px 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 20px;
  margin: 8px 0;
}

.markdown-body li {
  margin: 4px 0;
}

.markdown-body code {
  background: var(--bg-primary);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.markdown-body pre {
  background: var(--bg-primary);
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}

.markdown-body pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 0.85em;
}

.markdown-body blockquote {
  border-left: 3px solid var(--accent);
  padding: 4px 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}

.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border);
  padding: 6px 12px;
  text-align: left;
}

.markdown-body th {
  background: var(--bg-secondary);
  font-weight: 600;
}

.markdown-body a {
  color: var(--accent);
  text-decoration: underline;
}
.markdown-body a:hover {
  opacity: 0.8;
}

.markdown-body strong {
  font-weight: 600;
}

.markdown-body hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 16px 0;
}

.markdown-body img {
  max-width: 100%;
  border-radius: 8px;
}

.markdown-body input[type="checkbox"] {
  margin-right: 6px;
  accent-color: var(--accent);
}
</style>
