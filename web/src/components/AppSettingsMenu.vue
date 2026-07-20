<template>
  <div class="settings-area" ref="settingsTriggerRef">
    <button
      class="nav-item settings-btn"
      :class="{ active: showSettingsMenu, compact: props.compact }"
      style="min-width: 44px; min-height: 44px"
      aria-label="设置"
      title="设置"
      @click="toggleSettingsMenu"
    >
      <Icon name="settings" :size="18" />
      <span v-if="!props.compact" class="nav-label"><span class="nav-zh">设置</span><span class="nav-en">SETTINGS</span></span>
    </button>
  </div>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" @click.stop>
        <div class="popup-header">设置</div>
        <div class="popup-section">
          <div class="popup-section-header">扩展 EXTENSIONS</div>
          <router-link to="/providers" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">模型 MODELS</span>
              <span class="popup-item-sub">配置 AI 语言模型与接入密钥</span>
            </div>
          </router-link>
          <router-link to="/mcp" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">MCP 服务</span>
              <span class="popup-item-sub">连接和管理 AI 工具与外部服务</span>
            </div>
          </router-link>
          <router-link to="/skills" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">Skills &amp; 宏</span>
              <span class="popup-item-sub">管理自动化命令与快捷指令</span>
            </div>
          </router-link>
          <router-link to="/soul" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">人设 SOUL</span>
              <span class="popup-item-sub">设定 AI 助手的角色与对话风格</span>
            </div>
          </router-link>
          <router-link to="/user" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">用户 USER</span>
              <span class="popup-item-sub">管理用户账户与偏好设置</span>
            </div>
          </router-link>
          <router-link to="/memory" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">记忆 MEMORY</span>
              <span class="popup-item-sub">查看与管理 AI 自动记录的长期事实</span>
            </div>
          </router-link>
          <router-link to="/kb" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">知识库 KB</span>
              <span class="popup-item-sub">了解 AI 如何管理知识，无需手动上传文档</span>
            </div>
          </router-link>
        </div>
        <div class="popup-section">
          <div class="popup-section-header">运维 OPERATIONS</div>
          <router-link to="/path-whitelist" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">路径白名单</span>
              <span class="popup-item-sub">限定 AI 可访问的文件目录</span>
            </div>
          </router-link>
          <router-link to="/maxma-blocker" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">拒止锚</span>
              <span class="popup-item-sub">在敏感目录强制阻断 AI 文件访问</span>
            </div>
          </router-link>
          <router-link to="/env-vars" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">环境变量</span>
              <span class="popup-item-sub">管理应用运行所需的配置项</span>
            </div>
          </router-link>
          <router-link to="/privacy" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">隐私仪表盘</span>
              <span class="popup-item-sub">查看与控制数据收集与隐私设置</span>
            </div>
          </router-link>
          <router-link to="/metrics" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">运行指标</span>
              <span class="popup-item-sub">监控系统性能与资源使用</span>
            </div>
          </router-link>
          <router-link to="/audit-log" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">审计日志</span>
              <span class="popup-item-sub">查看工具调用、权限使用与敏感操作历史</span>
            </div>
          </router-link>
        </div>
        <div class="popup-section">
          <div class="popup-section-header">系统 SYSTEM</div>
          <router-link to="/appearance" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">外观 APPEARANCE</span>
              <span class="popup-item-sub">自定义主题颜色与界面布局</span>
            </div>
          </router-link>
          <router-link to="/help" class="popup-item" @click="closeSettingsMenu">
            <div class="popup-item-content">
              <span class="popup-item-title">帮助 HELP</span>
              <span class="popup-item-sub">了解 Maxma 能力、快速上手与常见问题</span>
            </div>
          </router-link>
        </div>
        <button v-if="props.onboardingEnabled" class="popup-item popup-action" @click="restartOnboarding">重新开始引导</button>
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
        <div class="popup-divider"></div>
        <div class="quick-actions-section">
          <div class="quick-actions-title">⚡ 快捷操作</div>
          <button class="popup-item popup-action neutral" @click="handleClearSession">清空当前会话</button>
          <button class="popup-item popup-action neutral" @click="handleScrollToTop">回到顶部</button>
        </div>
        <div class="popup-divider"></div>
        <div class="shortcuts-section">
          <div class="shortcuts-title">⌨ 快捷键</div>
          <div class="shortcut-item"><kbd>Ctrl+N</kbd> 新建会话</div>
          <div class="shortcut-item"><kbd>Ctrl+K</kbd> 切换私密模式</div>
          <div class="shortcut-item"><kbd>Ctrl+Esc</kbd> 切换侧栏</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { api } from '@/api';
import { invoke } from '@tauri-apps/api/core';
import { onMounted, onUnmounted, nextTick, ref } from 'vue';
import { useSessionStore } from '@/stores/session';
import { useChatStore } from '@/stores/chat';

const props = withDefaults(defineProps<{
  /** 是否启用「重新开始引导」按钮（来自 stores/onboarding.onboardingEnabled） */
  onboardingEnabled: boolean
  /** 紧凑模式仅保留图标，适用于图标导航栏 */
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  'restart-onboarding': []
}>()

const showSettingsMenu = ref(false)
const settingsTriggerRef = ref<HTMLElement | null>(null)
const settingsPopupRef = ref<HTMLElement | null>(null)
const restarting = ref(false)
const exportingErrorLog = ref(false)
const managingLogs = ref(false)

const sessionStore = useSessionStore()
const chatStore = useChatStore()

function handleClearSession() {
  const sid = sessionStore.sessionId
  if (!sid) return
  if (!window.confirm('确定要清空当前会话的所有消息吗？此操作不可撤销。')) return
  // 清空内存中的对话轮次
  const ch = chatStore.channels.get(sid)
  if (ch) {
    ch.turns.splice(0, ch.turns.length)
    ch.currentTurn = null
  }
  // 清除 localStorage 持久化缓存
  chatStore.removeTurnsFromStorage(sid)
  closeSettingsMenu()
}

function handleScrollToTop() {
  window.scrollTo(0, 0)
  closeSettingsMenu()
}

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

let restartPollTimer: ReturnType<typeof setTimeout> | null = null

async function handleRestart() {
  if (restarting.value) return
  if (!window.confirm('确定要重启 Maxma 吗？正在进行的对话可能会中断。')) return
  restarting.value = true
  closeSettingsMenu()
  api.restart()
  const poll = async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => { restartPollTimer = setTimeout(r, 2000) })
      restartPollTimer = null
      try {
        await api.health()
        location.reload(); return
      } catch { /* still down */ }
    }
    restarting.value = false
  }
  poll()
}

onUnmounted(() => {
  if (restartPollTimer) {
    clearTimeout(restartPollTimer)
    restartPollTimer = null
  }
})

function toggleSettingsMenu() {
  showSettingsMenu.value = !showSettingsMenu.value
  nextTick(() => {
    updatePopupPosition()
    // 打开时滚动到顶部，避免上次的滚动位置残留导致看不到顶部菜单
    if (showSettingsMenu.value && settingsPopupRef.value) {
      settingsPopupRef.value.scrollTop = 0
    }
  })
}

function closeSettingsMenu() {
  showSettingsMenu.value = false
}

function restartOnboarding() {
  emit('restart-onboarding')
  closeSettingsMenu()
}

function updatePopupPosition() {
  const el = settingsPopupRef.value
  const trigger = settingsTriggerRef.value
  if (!showSettingsMenu.value || !el || !trigger) return

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const viewportPadding = 12
  const gap = 8
  const rect = trigger.getBoundingClientRect()

  // Measure the unconstrained menu so the side with more room is selected
  // when the full list cannot fit either above or below the trigger.
  el.style.removeProperty('max-height')
  const contentHeight = el.scrollHeight || el.getBoundingClientRect().height
  const availableAbove = Math.max(0, rect.top - gap - viewportPadding)
  const availableBelow = Math.max(0, viewportHeight - rect.bottom - gap - viewportPadding)
  const fitsAbove = contentHeight > 0 && contentHeight <= availableAbove
  const fitsBelow = contentHeight > 0 && contentHeight <= availableBelow
  const opensAbove = fitsAbove
    ? !fitsBelow || availableAbove >= availableBelow
    : availableAbove >= availableBelow

  const available = Math.max(1, Math.floor(opensAbove ? availableAbove : availableBelow))
  const popupWidth = el.getBoundingClientRect().width || el.offsetWidth
  const fallbackWidth = Math.min(320, Math.max(1, viewportWidth - viewportPadding * 2))
  const measuredWidth = popupWidth || fallbackWidth
  const left = Math.min(
    Math.max(viewportPadding, rect.right + gap),
    Math.max(viewportPadding, viewportWidth - measuredWidth - viewportPadding),
  )

  el.style.removeProperty('top')
  el.style.removeProperty('bottom')
  el.style.setProperty('left', `${Math.floor(left)}px`)
  el.style.setProperty('max-height', `${available}px`)
  el.style.setProperty('overflow-y', 'auto')

  if (opensAbove) {
    // popup 底部贴近 trigger 上方，通过 bottom 定位让浏览器自动延展顶部
    const popupBottom = Math.min(
      viewportHeight - viewportPadding,
      Math.max(viewportPadding, rect.top - gap),
    )
    el.style.setProperty('bottom', `${Math.floor(viewportHeight - popupBottom)}px`)
  } else {
    const popupTop = Math.min(
      viewportHeight - viewportPadding,
      Math.max(viewportPadding, rect.bottom + gap),
    )
    el.style.setProperty('top', `${Math.floor(popupTop)}px`)
  }
}

function onViewportChange() {
  if (showSettingsMenu.value) updatePopupPosition()
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
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<style scoped>
/* ── Settings trigger ── */
.settings-area {
  margin-top: auto;
}

.settings-btn {
  width: 100%;
  min-width: 44px;
  min-height: 44px;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9em;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
}

.settings-btn.compact {
  width: 48px;
  min-width: 44px;
  height: 48px;
  min-height: 44px;
  padding: 0;
  justify-content: center;
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

/* ── Settings popup ── */
.settings-popup {
  position: fixed;
  z-index: 200;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  min-width: min(170px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  padding: 6px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}

/* 加粗 popup 滚动条，让用户能注意到可以滚动 */
.settings-popup::-webkit-scrollbar {
  width: 10px;
}
.settings-popup::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 5px;
  border: 2px solid var(--bg-card);
}
.settings-popup::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}
.settings-popup {
  scrollbar-width: auto;
  scrollbar-color: var(--border) transparent;
}

.popup-header {
  padding: 8px 12px 6px;
  font-size: 0.75em;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.popup-section + .popup-section {
  margin-top: 4px;
}

.popup-section-header {
  padding: 8px 12px 4px;
  font-size: 0.7em;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
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
	  background: var(--bg-secondary);
	}
.popup-item.router-link-active .popup-item-title {
	  color: var(--accent);
	  font-weight: 600;
	}
	
	.popup-item-content {
	  display: flex;
	  flex-direction: column;
	  gap: 1px;
	}
	
	.popup-item-title {
	  font-size: 0.9em;
	  color: var(--text-secondary);
	  line-height: 1.4;
	}
	
	.popup-item-sub {
	  font-size: 0.65em;
	  color: var(--text-tertiary);
	  line-height: 1.35;
	  font-weight: 400;
	  white-space: normal;
	  overflow-wrap: anywhere;
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

/* ── 快捷键指南 ── */
.shortcuts-section {
  padding: 8px 14px 4px;
}
.shortcuts-title {
  font-size: 0.7em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.shortcut-item {
  font-size: 0.75em;
  color: var(--text-secondary);
  line-height: 1.8;
}

/* ── 快捷操作 ── */
.quick-actions-section {
  padding: 4px 6px;
}
.quick-actions-title {
  font-size: 0.7em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 6px 2px;
}
.shortcut-item kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 0.85em;
  font-family: var(--font-mono);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 3px;
  margin-right: 4px;
  min-width: 20px;
  text-align: center;
  transition: background var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
@media (prefers-reduced-motion: no-preference) {
  .shortcut-item kbd:hover {
    background: var(--bg-secondary);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-secondary));
    border-color: var(--accent-dark);
    box-shadow: 0 1px 4px var(--shadow-color);
  }
}
</style>
