<template>
  <BubbleChrome :tool-call="toolCall">
    <!-- 运行中 -->
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>正在计算差异...</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || 'Diff 操作失败' }}
    </div>

    <!-- 完成 -->
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="toolCall.toolData" class="diff-result">
        <!-- 无差异 -->
        <div v-if="!diffText" class="no-diff">
          {{ td.message || '没有差异' }}
        </div>

        <!-- 有差异 -->
        <template v-else>
          <!-- 统计栏 -->
          <div class="diff-stats">
            <span class="stat-item files">{{ td.files_changed }} 个文件</span>
            <span class="stat-item additions">+{{ td.additions }}</span>
            <span class="stat-item deletions">-{{ td.deletions }}</span>
          </div>

          <!-- Diff 内容 -->
          <div class="diff-container">
            <div
              v-for="(line, i) in diffLines"
              :key="i"
              class="diff-line"
              :class="lineClass(line)"
            >
              <span class="line-prefix">{{ linePrefix(line) }}</span>
              <span class="line-content">{{ lineText(line) }}</span>
            </div>
          </div>

          <!-- 截断提示 -->
          <div v-if="isTruncated" class="diff-footer">
            仅显示前 {{ maxLines }} 行
          </div>
        </template>
      </div>

      <!-- 无 toolData 降级 -->
      <div v-else class="raw-output">{{ toolCall.output }}</div>
    </template>
  </BubbleChrome>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'

const props = defineProps<{ toolCall: ToolCall }>()

const td = computed(() => props.toolCall.toolData ?? {})

const diffText = computed(() => {
  return (td.value.diff as string) || ''
})

const maxLines = 500

const diffLines = computed(() => {
  const text = diffText.value
  if (!text) return []
  const lines = text.split('\n')
  return lines.slice(0, maxLines)
})

const isTruncated = computed(() => {
  const text = diffText.value
  if (!text) return false
  return text.split('\n').length > maxLines
})

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'file-header'
  if (line.startsWith('@@')) return 'hunk-header'
  if (line.startsWith('+')) return 'addition'
  if (line.startsWith('-')) return 'deletion'
  return 'context'
}

function linePrefix(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return ''
  if (line.startsWith('@@')) return ''
  if (line.startsWith('+')) return '+'
  if (line.startsWith('-')) return '-'
  return ' '
}

function lineText(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) {
    // 提取文件名
    const parts = line.split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : line
  }
  if (line.startsWith('@@')) return line
  if (line.length > 0) return line.substring(1)
  return ''
}
</script>

<style scoped>
.diff-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-diff {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 8px 0;
  text-align: center;
  font-style: italic;
}

/* ── 统计栏 ── */
.diff-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.stat-item {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.stat-item.files {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.stat-item.additions {
  background: #dcfce7;
  color: #166534;
}

.stat-item.deletions {
  background: #fee2e2;
  color: #991b1b;
}

/* ── Diff 内容 ── */
.diff-container {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}

.diff-line {
  display: flex;
  padding: 0 10px;
  white-space: pre;
  min-height: 19px;
}

.diff-line.file-header {
  background: #f0f4f8;
  color: var(--text-secondary);
  font-weight: 600;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border);
}

.diff-line.hunk-header {
  background: #eff6ff;
  color: #1d4ed8;
  padding: 2px 10px;
}

.diff-line.addition {
  background: #dcfce7;
  color: #166534;
}

.diff-line.deletion {
  background: #fee2e2;
  color: #991b1b;
}

.diff-line.context {
  color: var(--text-primary);
}

.line-prefix {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
  opacity: 0.6;
}

.line-content {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diff-footer {
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  padding: 2px 0;
}

/* ── 运行中 / 错误 / 降级 ── */
.bubble-running {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

.bubble-error {
  font-size: 13px;
  color: #b91c1c;
  padding: 4px 0;
}

.raw-output {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-radius: 6px;
}
</style>
