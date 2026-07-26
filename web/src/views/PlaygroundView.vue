<template>
  <div class="playground">
    <header class="pg-header">
      <div class="pg-header-left">
        <h1 class="pg-title">Kaleidoscope Playground</h1>
        <span class="pg-badge">开发专用</span>
      </div>
      <div class="pg-header-right">
        <span class="pg-stats">
          已注册 <strong>{{ registeredCount }}</strong> / <strong>{{ toolNames.length }}</strong> 个工具
        </span>
      </div>
    </header>

    <div class="pg-body">
      <!-- 左侧：工具列表 -->
      <aside class="pg-sidebar">
        <div class="pg-section-title">工具列表</div>
        <div class="tool-list">
          <div
            v-for="toolName in toolNames"
            :key="toolName"
            class="tool-item"
            :class="{ active: selectedTool === toolName }"
            @click="selectTool(toolName)"
          >
            <span class="tool-dot" :class="{ registered: isRegistered(toolName) }"></span>
            <span class="tool-item-name">{{ toolDisplayName(toolName) }}</span>
            <span class="tool-item-id">{{ toolName }}</span>
            <span v-if="isRegistered(toolName)" class="chip registered">专属</span>
            <span v-else class="chip fallback">兜底</span>
          </div>
        </div>
      </aside>

      <!-- 右侧：预览区 -->
      <div class="pg-main">
        <!-- 状态切换 -->
        <div class="state-bar">
          <span class="state-bar-label">状态切换：</span>
          <button
            v-for="s in states"
            :key="s"
            class="state-btn"
            :class="s"
            @click="currentState = s"
          >
            <span class="state-dot" :class="s"></span>
            {{ stateLabel(s) }}
          </button>
        </div>

        <!-- 气泡预览 -->
        <div class="preview-area">
          <div class="preview-header">
            <span class="preview-label">
              {{ toolDisplayName(selectedTool) }}
              <code class="preview-tool-id">{{ selectedTool }}</code>
            </span>
            <span v-if="isRegistered(selectedTool)" class="preview-using">
              使用 {{ getBubbleComponentName(selectedTool) }}
            </span>
            <span v-else class="preview-using fallback-text">
              使用 ToolCallCard（兜底）
            </span>
          </div>
          <div class="preview-body">
            <ToolBubbleRouter
              :key="selectedTool + ':' + currentState"
              :tool-call="currentMock"
              @action="logAction"
            />
          </div>
        </div>

        <!-- 交互日志 -->
        <div class="action-log">
          <div class="action-log-header">
            <span class="pg-section-title">交互日志</span>
            <button
              v-if="actionLog.length > 0"
              class="clear-btn"
              @click="actionLog = []"
            >
              清空
            </button>
          </div>
          <div class="log-entries">
            <div
              v-for="(entry, i) in actionLog"
              :key="i"
              class="log-entry"
            >
              <span class="log-idx">#{{ actionLog.length - i }}</span>
              <span class="log-time">{{ entry.time }}</span>
              <span class="log-action">{{ entry.action }}</span>
              <code v-if="entry.data" class="log-data">{{ entry.data }}</code>
            </div>
            <div v-if="actionLog.length === 0" class="log-empty">
              点击气泡中的交互组件以记录事件
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolCall } from '@/types'
import ToolBubbleRouter from '@/components/ToolBubbleRouter.vue'
import { getRegisteredTools } from '@/components/tools/registry'
import { toolDisplayName, ALL_TOOL_NAMES } from '@/components/tools/_shared/displayNames'

// ── 状态定义 ──
type ToolStatus = 'running' | 'done' | 'error'
const states: ToolStatus[] = ['running', 'done', 'error']
const stateLabels: Record<ToolStatus, string> = {
  running: '运行中',
  done: '已完成',
  error: '出错',
}

const toolNames = ALL_TOOL_NAMES
const registeredTools = getRegisteredTools()

function isRegistered(name: string): boolean {
  return registeredTools.includes(name)
}

const registeredCount = computed(() => registeredTools.length)

function stateLabel(s: ToolStatus): string {
  return stateLabels[s]
}

function getBubbleComponentName(name: string): string {
  const map: Record<string, string> = {
    'eval': 'PythonBubble.vue',
    'read': 'FilesBubble.vue',
    'write': 'FilesBubble.vue',
    'glob': 'FilesBubble.vue',
    'grep': 'FilesBubble.vue',
    'edit': 'FileEditBubble.vue',
    'inspect_image': 'ImageBubble.vue',
    'ask': 'AskUserBubble.vue',
    'memory_edit': 'MemoryBubble.vue',
    'retain': 'MemoryBubble.vue',
    'recall': 'MemoryBubble.vue',
    'reflect': 'MemoryBubble.vue',
  }
  return map[name] ?? name
}

// ── 选中工具与状态 ──
const selectedTool = ref(toolNames[0])
const currentState = ref<ToolStatus>('done')

function selectTool(name: string) {
  selectedTool.value = name
  currentState.value = 'done'
}

// ── Mock 数据生成 ──
const currentMock = computed<ToolCall>(() => {
  return buildMock(selectedTool.value, currentState.value)
})

interface MockTemplate {
  input: Record<string, unknown>
  doneOutput: string
  toolData?: Record<string, unknown>
}

const mockTemplates: Record<string, MockTemplate> = {}
function buildMock(name: string, status: ToolStatus): ToolCall {
  const tpl = mockTemplates[name]
  const input = tpl
    ? JSON.stringify(tpl.input, null, 2)
    : JSON.stringify({ example_param: '示例参数' }, null, 2)

  const base: ToolCall = {
    kind: 'tool',
    name,
    input,
    output: null,
    elapsed: null,
    status,
  }

  if (status === 'running') {
    return { ...base, elapsed: null, output: null }
  }

  if (status === 'error') {
    return { ...base, elapsed: 1.23, output: 'Error: 请求超时，请检查网络连接后重试' }
  }

  // done
  return {
    ...base,
    elapsed: name === 'tavily_search' ? 1.82 : name === 'tavily_extract' ? 2.64 : 2.35,
    output: tpl?.doneOutput ?? JSON.stringify({ success: true, data: { result: 'OK' } }),
    toolData: tpl?.toolData,
  }
}

// ── 交互日志 ──
interface LogEntry {
  time: string
  action: string
  data?: string
}

const actionLog = ref<LogEntry[]>([])

function logAction(payload: { action: string; data?: unknown }) {
  const now = new Date()
  const time = now.toLocaleTimeString('zh-CN', { hour12: false })
  actionLog.value.unshift({
    time,
    action: payload.action,
    data: payload.data ? JSON.stringify(payload.data, null, 2) : undefined,
  })
  if (actionLog.value.length > 50) {
    actionLog.value.pop()
  }
}
</script>

<style scoped>
.playground {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-primary);
}

/* ── Header ── */
.pg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
}

.pg-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pg-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.pg-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 100px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
  color: var(--status-warn);
  font-weight: 600;
}

.pg-stats {
  font-size: 13px;
  color: var(--text-secondary);
}

/* ── Body ── */
.pg-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ── Sidebar ── */
.pg-sidebar {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pg-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.pg-sidebar .pg-section-title {
  padding: 16px 16px 10px;
}

.tool-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 12px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
  font-size: 13px;
}

.tool-item:hover {
  background: var(--bg-card);
}

.tool-item.active {
  background: var(--bg-card);
  box-shadow: var(--shadow);
}

.tool-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}

.tool-dot.registered {
  background: var(--accent);
}

.tool-item-name {
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-item-id {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Consolas', monospace;
  display: none;
}

.chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 100px;
  font-weight: 600;
  flex-shrink: 0;
}

.chip.registered {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
  color: var(--status-ok);
}

.chip.fallback {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

/* ── Main ── */
.pg-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.state-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
}

.state-bar-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-right: 4px;
}

.state-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out),
              color 0.15s var(--ease-out);
  font-family: inherit;
}

.state-btn:hover {
  border-color: var(--accent-dark);
  color: var(--text-primary);
}

.state-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-card);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-card));
  font-weight: 600;
}

.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
}

.state-dot.running {
  background: var(--accent);
  animation: maxma-pulse 1.2s ease-in-out infinite;
}

.state-dot.done {
  background: var(--status-ok);
}

.state-dot.error {
  background: var(--status-error);
}


/* ── Preview ── */
.preview-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.preview-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-tool-id {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
}

.preview-using {
  font-size: 12px;
  color: var(--accent);
}

.preview-using.fallback-text {
  color: var(--text-secondary);
}

.preview-body {
  max-width: 600px;
}

/* ── Action Log ── */
.action-log {
  border-top: 1px solid var(--border);
  background: var(--bg-card);
  flex-shrink: 0;
  max-height: 160px;
  display: flex;
  flex-direction: column;
}

.action-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px 8px;
}

.clear-btn {
  font-size: 12px;
  color: var(--text-secondary);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.clear-btn:hover {
  color: var(--text-primary);
}

.log-entries {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.log-entry {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 12px;
  font-family: 'SF Mono', 'Consolas', monospace;
  line-height: 1.6;
}

.log-idx {
  color: var(--border);
  flex-shrink: 0;
  min-width: 24px;
}

.log-time {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.log-action {
  color: var(--accent);
  font-weight: 600;
}

.log-data {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-empty {
  font-size: 12px;
  color: var(--text-secondary);
  font-style: italic;
  padding: 4px 0;
}
</style>
