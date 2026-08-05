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

  <AnimatedModal v-model:open="showSettingsMenu">
    <AnimatedModalBody :lock-scroll="true" :show-close="false" @close="closeSettingsMenu">
      <SettingsModalContent
        :items="settingsItems"
        :restarting="restarting"
        :exporting="exportingErrorLog"
        :managing="managingLogs"
        @select="onSelectSetting"
        @restart="handleRestart"
        @clear-session="handleClearSession"
        @export-logs="handleExportErrorLog"
        @manage-logs="handleManageLogs"
      />
    </AnimatedModalBody>
  </AnimatedModal>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import SettingsModalContent from '@/components/SettingsModalContent.vue';
import type { SettingsItem } from '@/components/SettingsModalContent.vue';
import AnimatedModal from '@/components/inspira/AnimatedModal.vue';
import AnimatedModalBody from '@/components/inspira/AnimatedModalBody.vue';
import { api } from '@/api';
import { invoke } from '@tauri-apps/api/core';
import { onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/stores/session';
import { useChatStore } from '@/stores/chat';
import { invalidateTurnsCache } from '@/composables/useChat';
import { confirmAction } from '@/composables/useConfirm';

const props = withDefaults(defineProps<{
  compact?: boolean
  onboardingEnabled?: boolean
}>(), {
  compact: false,
  onboardingEnabled: false,
})

defineEmits<{
  (e: 'restartOnboarding'): void
}>()

const router = useRouter()
const showSettingsMenu = ref(false)
const settingsTriggerRef = ref<HTMLElement | null>(null)
const restarting = ref(false)
const exportingErrorLog = ref(false)
const managingLogs = ref(false)

const sessionStore = useSessionStore()
const chatStore = useChatStore()

// ── 设置页面列表 ──

const settingsItems: SettingsItem[] = [
  { icon: 'dashboard', title: '能力仪表盘', subtitle: 'OMP 全部能力模块概览与运行状态', route: '/capabilities' },
  { icon: 'puzzle', title: '插件管理', subtitle: '安装、卸载与管理 OMP 插件', route: '/plugins' },
  { icon: 'model', title: '模型', subtitle: '配置 AI 语言模型与接入密钥', route: '/providers' },
  { icon: 'settings', title: '设置', subtitle: '压缩、重试、工具审批等核心配置', route: '/settings' },
  { icon: 'mcp', title: 'MCP 服务', subtitle: '连接和管理 AI 工具与外部服务', route: '/mcp' },
  { icon: 'extensions', title: '扩展管理', subtitle: '查看已发现的 OMP 扩展与 Skills', route: '/extensions' },
  { icon: 'soul', title: '人设', subtitle: '设定 AI 助手的角色与对话风格', route: '/soul' },
  { icon: 'user', title: '用户', subtitle: '管理用户账户与偏好设置', route: '/user' },
  { icon: 'memory', title: '记忆', subtitle: '查看与管理 AI 自动记录的长期事实', route: '/memory' },
  { icon: 'blocker', title: '拒止锚', subtitle: '在敏感目录强制阻断 AI 文件访问', route: '/maxma-blocker' },
  { icon: 'privacy', title: '隐私仪表盘', subtitle: '查看与控制数据收集与隐私设置', route: '/privacy' },
  { icon: 'metrics', title: '运行指标', subtitle: '监控系统性能与资源使用', route: '/metrics' },
  { icon: 'appearance', title: '外观', subtitle: '自定义主题颜色与界面布局', route: '/appearance' },
  { icon: 'help', title: '帮助', subtitle: '了解 Maxma 能力、快速上手与常见问题', route: '/help' },
]

// ── 操作函数 ──

async function handleClearSession() {
  const sid = sessionStore.sessionId
  if (!sid) return
  if (!await confirmAction({
    title: '清空会话',
    message: '确定要清空当前会话的所有消息吗？此操作不可撤销。',
    confirmText: '清空',
    danger: true,
  })) return
  const ch = chatStore.channels.get(sid)
  if (ch) {
    ch.turns.splice(0, ch.turns.length)
    ch.currentTurn = null
  }
  chatStore.removeTurnsFromStorage(sid)
  invalidateTurnsCache(sid)
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
    const result = await invoke<string | null>('save_text_file', {
      content: text,
      defaultFilename: filename,
    })
    if (result) {
      window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: `错误日志已保存到:\n${result}` } }))
    }
  } catch (e) {
    window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: '导出错误日志失败: ' + (e instanceof Error ? e.message : String(e)) } }))
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
    const confirmClean = await confirmAction({
      title: '日志管理',
      message: `日志文件占用情况：\n${fileList}\n\n总计: ${totalMB} MB\n\n是否清理旧日志轮转文件（保留当前日志）？`,
      confirmText: '清理',
      danger: true,
    })
    if (confirmClean) {
      const result = await api.clearOldLogs()
      window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: `已清理 ${result.deleted_count ?? 0} 个旧日志文件，释放 ${(result.freed_mb ?? 0).toFixed(2)} MB 空间` } }))
    }
  } catch (e) {
    window.dispatchEvent(new CustomEvent('maxma:error', { detail: { message: '日志管理失败: ' + (e instanceof Error ? e.message : String(e)) } }))
  } finally {
    managingLogs.value = false
  }
}

let restartPollTimer: ReturnType<typeof setTimeout> | null = null

async function handleRestart() {
  if (restarting.value) return
  if (!await confirmAction({
    title: '重启应用',
    message: '确定要重启 Maxma 吗？正在进行的对话可能会中断。',
    confirmText: '重启',
    danger: true,
  })) return
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
}

function closeSettingsMenu() {
  showSettingsMenu.value = false
}

function onSelectSetting(item: SettingsItem) {
  showSettingsMenu.value = false
  router.push(item.route)
}
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
  transition: background 0.15s, color 0.15s, transform 0.1s;
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
.settings-btn:active {
  transform: scale(0.96);
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
</style>