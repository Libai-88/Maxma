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
        <router-link to="/activity" class="nav-item">
          <Icon name="memory" :size="18" /> <span class="nav-label">活动&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ACTIVITY</span>
        </router-link>
        <router-link to="/playground" class="nav-item pg-nav">动态 NEWS</router-link>
        <div class="settings-area" ref="settingsTriggerRef">
          <button class="nav-item settings-btn" :class="{ active: showSettingsMenu }" @click="toggleSettingsMenu">
            <Icon name="settings" :size="18" /> <span class="nav-label">设置&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;SETTINGS</span>
          </button>
        </div>
      </nav>
      <Teleport to="body">
        <Transition name="popup">
          <div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" :style="{ top: popupTop, left: popupLeft, maxHeight: popupMaxHeight }" @click.stop>
            <div class="popup-header">设置</div>
            <router-link to="/appearance" class="popup-item" @click="closeSettingsMenu">外观 APPEARANCE</router-link>
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
            <button class="popup-item popup-action" :class="{ exporting: exportingErrorLog }" :disabled="exportingErrorLog" @click="handleExportErrorLog">
              {{ exportingErrorLog ? '导出中...' : '导出错误日志' }}
            </button>
            <button class="popup-item popup-action" :class="{ exporting: managingLogs }" :disabled="managingLogs" @click="handleManageLogs">
              {{ managingLogs ? '处理中...' : '日志管理' }}
            </button>
            <button class="popup-item popup-action" :class="{ restarting }" :disabled="restarting" @click="handleRestart">
              {{ restarting ? '重启中...' : '重启服务' }}
            </button>
          </div>
        </Transition>
      </Teleport>
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
import { useRouter, useRoute } from 'vue-router';
import { useTheme } from '@/composables/useTheme'

import LeavesOverlay from '@/components/LeavesOverlay.vue'
import MediaViewer from '@/components/MediaViewer.vue'
import FloatSidebar from '@/components/FloatSidebar.vue'
import { useFloatSidebar } from '@/composables/useFloatSidebar'
import { usePaperTexture } from '@/composables/usePaperTexture'
import RegionalErrorBoundary from '@/components/ui/RegionalErrorBoundary.vue'
import { invoke } from '@tauri-apps/api/core'

const { effectiveCollapsed, toggleSidebar } = useSidebar()

const { onEnter: onFloatSidebarEnter, onLeave: onFloatSidebarLeave } = useFloatSidebar()

const showSettingsMenu = ref(false)
const settingsTriggerRef = ref<HTMLElement | null>(null)
const settingsPopupRef = ref<HTMLElement | null>(null)
const popupTop = ref('0px')
const popupLeft = ref('228px')
const popupMaxHeight = ref('')
const restarting = ref(false)
const exportingErrorLog = ref(false)
const managingLogs = ref(false)
const { isDark: isNightMode } = useTheme()

async function handleExportErrorLog() {
  if (exportingErrorLog.value) return
  exportingErrorLog.value = true
  closeSettingsMenu()
  try {
    const text = await api.getErrorLogText()
    const ts = new Date().toISOString().replace(/[:T]/g, '-').substring(0, 19)
    const filename = `maxma-error-report-${ts}.txt`
    // 调用 Tauri 原生保存对话框，让用户选择保存位置
    const result = await invoke<string | null>('save_text_file', {
      content: text,
      defaultFilename: filename,
    })
    if (result) {
      alert(`错误日志已保存到:\n${result}`)
    }
  } catch (e) {
    alert('导出错误日志失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    exportingErrorLog.value = false
  }
}

async function handleManageLogs() {
  if (managingLogs.value) return
  managingLogs.value = true
  closeSettingsMenu()
  try {
    const info = await api.getLogFiles()
    const fileList = info.files.map((f: { name: string; size_mb: number }) => `  ${f.name}: ${f.size_mb.toFixed(2)} MB`).join('\n')
    const totalMB = (info.total_mb ?? 0).toFixed(2)
    const confirmClean = window.confirm(
      `日志文件占用情况：\n${fileList}\n\n总计: ${totalMB} MB\n\n是否清理旧日志轮转文件（保留当前日志）？`
    )
    if (confirmClean) {
      const result = await api.clearOldLogs()
      alert(`已清理 ${result.deleted_count ?? 0} 个旧日志文件，释放 ${(result.freed_mb ?? 0).toFixed(2)} MB 空间`)
    }
  } catch (e) {
    alert('日志管理失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    managingLogs.value = false
  }
}

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
    // 动态计算可用高度：视口高度 - popup 顶部位置 - 底部留白 16px
    // 避免固定 max-height 导致 popup 超出视口底部被裁切
    const available = window.innerHeight - rect.top - 16
    popupMaxHeight.value = `${Math.max(160, available)}px`
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
const route = useRoute()

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
    sessionStore.refreshSessions().catch(() => {})
  }
})
</script>

<style>
@import '@/assets/styles/tokens.css';
@import '@/assets/styles/animations.css';
@import '@/assets/styles/design-system.css';
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

/* ── 纸质纹理系统：三层叠加 ── */
/* ① Surface 层：铺底元素直接叠纹理 */
body.paper-texture,
body.paper-texture .sidebar,
body.paper-texture .chat-header {
  background-image: var(--paper-texture-url);
  background-repeat: repeat;
  background-size: var(--paper-texture-size);
  background-attachment: fixed;
}

/* ② Card 层：bg-card 元素用 lighten 混合 */
body.paper-texture .msg-card,
body.paper-texture .ds-card,
body.paper-texture .input-wrapper,
body.paper-texture .hover-card,
body.paper-texture .no-provider-card {
  background-image: var(--paper-texture-url);
  background-blend-mode: var(--paper-texture-card-blend-mode);
}

/* ③ 亮度补偿：暖白叠层抵消纹理变暗（暗色主题跳过） */
html:not([data-theme="midnight"]):not([data-theme="midnight-contrast"])
body.paper-texture::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(255, 253, 247, var(--paper-texture-opacity));
  pointer-events: none;
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
  /* maxHeight 由 JS 动态设置（基于触发按钮在视口中的位置），避免固定值裁切 */
  overflow-y: auto;
  overscroll-behavior: contain;
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
.popup-action.exporting {
  color: #3b82f6;
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
