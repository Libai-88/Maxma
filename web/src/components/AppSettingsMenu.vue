<template>
  <div class="settings-area" ref="settingsTriggerRef">
    <button class="nav-item settings-btn" :class="{ active: showSettingsMenu }" @click="toggleSettingsMenu">
      <Icon name="settings" :size="18" /> <span class="nav-label"><span class="nav-zh">设置</span><span class="nav-en">SETTINGS</span></span>
    </button>
  </div>
  <Teleport to="body">
    <Transition name="popup">
      <div v-if="showSettingsMenu" ref="settingsPopupRef" class="settings-popup" @click.stop>
        <div class="popup-header">设置</div>
        <div class="popup-section">
          <div class="popup-section-header">扩展 EXTENSIONS</div>
          <router-link to="/providers" class="popup-item" @click="closeSettingsMenu">模型 MODELS</router-link>
          <router-link to="/mcp" class="popup-item" @click="closeSettingsMenu">MCP 服务</router-link>
          <router-link to="/skills" class="popup-item" @click="closeSettingsMenu">Skills &amp; 宏</router-link>
          <router-link to="/soul" class="popup-item" @click="closeSettingsMenu">人设 SOUL</router-link>
          <router-link to="/user" class="popup-item" @click="closeSettingsMenu">用户 USER</router-link>
        </div>
        <div class="popup-section">
          <div class="popup-section-header">运维 OPERATIONS</div>
          <router-link to="/path-whitelist" class="popup-item" @click="closeSettingsMenu">路径白名单</router-link>
          <router-link to="/maxma-blocker" class="popup-item" @click="closeSettingsMenu">拒止锚</router-link>
          <router-link to="/env-vars" class="popup-item" @click="closeSettingsMenu">环境变量</router-link>
          <router-link to="/event-hooks" class="popup-item" @click="closeSettingsMenu">事件钩子</router-link>
          <router-link to="/privacy" class="popup-item" @click="closeSettingsMenu">隐私仪表盘</router-link>
          <router-link to="/metrics" class="popup-item" @click="closeSettingsMenu">运行指标</router-link>
          <router-link to="/audit-log" class="popup-item" @click="closeSettingsMenu">审计日志</router-link>
        </div>
        <div class="popup-section">
          <div class="popup-section-header">系统 SYSTEM</div>
          <router-link to="/appearance" class="popup-item" @click="closeSettingsMenu">外观 APPEARANCE</router-link>
        </div>
        <button v-if="onboardingEnabled" class="popup-item popup-action" @click="restartOnboarding">重新开始引导</button>
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
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { api } from '@/api';
import { invoke } from '@tauri-apps/api/core';
import { onMounted, onUnmounted, nextTick, ref } from 'vue';

defineProps<{
  /** 是否启用「重新开始引导」按钮（来自 stores/onboarding.onboardingEnabled） */
  onboardingEnabled: boolean
}>()

const emit = defineEmits<{
  'restart-onboarding': []
}>()

const showSettingsMenu = ref(false)
const settingsTriggerRef = ref<HTMLElement | null>(null)
const settingsPopupRef = ref<HTMLElement | null>(null)
const restarting = ref(false)
const exportingErrorLog = ref(false)
const managingLogs = ref(false)

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
  nextTick(() => updatePopupPosition())
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
  if (!el || !trigger) return
  // CSP-safe CSSOM: position settings popup via style.setProperty (was :style binding)
  const rect = trigger.getBoundingClientRect()
  el.style.setProperty('top', `${rect.top}px`)
  el.style.setProperty('left', `${rect.right + 8}px`)
  // 动态计算可用高度：视口高度 - popup 顶部位置 - 底部留白 16px
  // 避免固定 max-height 导致 popup 超出视口底部被裁切
  const available = window.innerHeight - rect.top - 16
  el.style.setProperty('max-height', `${Math.max(160, available)}px`)
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
</script>

<style scoped>
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  transition: background 0.15s, color 0.15s;
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
</style>
