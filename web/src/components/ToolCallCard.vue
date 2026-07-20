<template>
  <div v-if="toolCall" class="tool-card" :class="[toolCall.status, { open: isOpen }]">
    <div class="tool-header" @click="toggle" role="button" :aria-expanded="isOpen">
      <span class="tool-icon">
        <span v-if="toolCall.status === 'running'" class="spinner-sm"></span>
        <Icon v-else-if="toolCall.status === 'done'" name="checkmark" :size="14" />
        <Icon v-else name="close" :size="14" />
      </span>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span class="tool-elapsed" v-if="toolCall.elapsed !== null">
        {{ toolCall.elapsed }}s
      </span>
      <PinButton @pin="$emit('pin', getPinPayload())" />
    </div>
    <div class="tool-body-wrapper" ref="bodyWrapper">
      <div class="tool-body" ref="bodyInner">
        <!-- 参数 section -->
        <div class="tool-section" v-if="toolCall.input && toolCall.input !== '{}'">
          <div class="tool-section-title">参数</div>
          <template v-if="inputDisplay.type === 'kv'">
            <div class="kv-list">
              <div class="kv-row" v-for="(item, idx) in inputDisplay.pairs" :key="idx">
                <span class="kv-key">{{ item.key }}</span>
                <span class="kv-value" v-if="item.primitive">{{ item.value }}</span>
                <pre class="kv-nested" v-else>{{ item.value }}</pre>
              </div>
            </div>
          </template>
          <RenderMarkdown v-if="inputDisplay.type === 'markdown'" :content="toolCall.input" />
        </div>

        <!-- 结果 section -->
        <div class="tool-section" v-if="toolCall.output">
          <div class="tool-section-title">结果</div>
          <!-- KV pairs (flat JSON object) -->
          <template v-if="outputDisplay.type === 'kv'">
            <div class="kv-list">
              <div class="kv-row" v-for="(item, idx) in outputDisplay.pairs" :key="idx">
                <span class="kv-key">{{ item.key }}</span>
                <span class="kv-value" v-if="item.primitive">{{ item.value }}</span>
                <pre class="kv-nested" v-else>{{ item.value }}</pre>
              </div>
            </div>
          </template>
          <!-- Image preview (browser screenshot etc.) -->
          <div v-else-if="outputDisplay.type === 'image'" class="image-preview">
            <img :src="outputDisplay.url" :alt="outputDisplay.alt" @click="openImage(outputDisplay.url)" />
          </div>
          <!-- Diff syntax highlighting (git diff, file edits) -->
          <div v-else-if="outputDisplay.type === 'diff'" class="diff-block">
            <div v-for="(line, i) in outputDisplay.lines" :key="i"
                 class="diff-line" :class="'diff-' + line.kind">
              <span class="diff-text">{{ line.text }}</span>
            </div>
          </div>
          <!-- Collapsible JSON (arrays / nested objects) -->
          <div v-else-if="outputDisplay.type === 'json'" class="json-block">
            <div class="json-header" @click="jsonExpanded = !jsonExpanded" role="button">
              <span class="json-toggle">{{ jsonExpanded ? '▼' : '▶' }}</span>
              <span class="json-summary">{{ outputDisplay.summary }}</span>
            </div>
            <pre v-if="jsonExpanded" class="code-block json-expanded">{{ outputDisplay.raw }}</pre>
          </div>
          <!-- Markdown rendered output -->
          <RenderMarkdown v-else-if="outputDisplay.type === 'markdown'" :content="toolCall.output || ''" />
          <!-- Plain code block (fallback) -->
          <pre v-else-if="outputDisplay.type === 'code'" class="code-block">{{ outputDisplay.raw }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { ToolCall } from '@/types'
import RenderMarkdown from './RenderMarkdown.vue'
import PinButton from '@/components/workbench/PinButton.vue'
import { useMediaViewer } from '@/composables/useMediaViewer'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ toolCall: ToolCall }>()

defineEmits<{
  pin: [payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }]
}>()

const isOpen = ref(false)
const bodyWrapper = ref<HTMLElement | null>(null)
const bodyInner = ref<HTMLElement | null>(null)

// ── JSON KV parsing ──
interface KvPair {
  key: string
  value: string
  primitive: boolean
}

interface KvDisplay {
  type: 'kv'
  pairs: KvPair[]
}

interface CodeDisplay {
  type: 'code'
  raw: string
  lang: string
  lines: number
}

interface MarkdownDisplay {
  type: 'markdown'
}

/** 图片预览（截图等） */
interface ImageDisplay {
  type: 'image'
  url: string
  alt: string
}

/** Diff 行类型 */
interface DiffLine {
  text: string
  kind: 'header' | 'add' | 'del' | 'context' | 'hunk'
}

/** 带语法高亮的 Diff 展示 */
interface DiffDisplay {
  type: 'diff'
  lines: DiffLine[]
  raw: string
}

/** 可折叠的 JSON 展示（嵌套对象/数组） */
interface JsonDisplay {
  type: 'json'
  raw: string
  summary: string
}

type SectionDisplay = KvDisplay | CodeDisplay | MarkdownDisplay | ImageDisplay | DiffDisplay | JsonDisplay

function parseJsonKv(raw: string): KvDisplay | null {
  // LangChain may pass Python-style dict strings (True/False/None, single quotes)
  const candidates = [
    raw,
    raw.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'),
    raw.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null'),
  ]
  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate)
      if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
      const pairs: KvPair[] = Object.entries(obj).map(([key, val]) => {
        const primitive = typeof val !== 'object' || val === null
        return {
          key,
          value: primitive ? String(val) : JSON.stringify(val, null, 2),
          primitive,
        }
      })
      return pairs.length > 0 ? { type: 'kv', pairs } : null
    } catch { /* try next candidate */ }
  }
  return null
}

/** 检测输出是否为 Markdown 格式 */
function isMarkdown(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  // 强信号：一个匹配即足够
  if (/^#{1,6}\s/m.test(trimmed)) return true       // 标题
  if (/^```/m.test(trimmed)) return true              // 代码围栏
  if (/^\|.+\|/m.test(trimmed)) return true           // 表格行
  if (/^>\s/m.test(trimmed)) return true              // 引用
  // 弱信号：需要至少两个匹配
  let score = 0
  if (/\*\*.*\*\*|__.*__/.test(trimmed)) score++     // 粗体
  if (/\[.+\]\(.+\)/.test(trimmed)) score++           // 链接
  if (/^[-*+]\s/m.test(trimmed)) score++              // 无序列表
  if (/^\d+\.\s/m.test(trimmed)) score++              // 有序列表
  if (/^---$/m.test(trimmed)) score++                 // 分隔线
  return score >= 2
}

/** 检测输出是否为图片（base64 data URI 或图片 URL） */
function detectImageDisplay(raw: string): ImageDisplay | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('data:image/')) {
    return { type: 'image', url: trimmed, alt: 'Tool result screenshot' }
  }
  // 检查是否整个输出是一个图片 URL
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']
  try {
    const url = new URL(trimmed)
    const ext = url.pathname.split('.').pop()?.toLowerCase()
    if (ext && imageExtensions.includes(ext)) {
      return { type: 'image', url: trimmed, alt: 'Tool result image' }
    }
  } catch {
    // 不是有效 URL
  }
  return null
}

/** 检测输出是否为 git diff 格式 */
function detectDiffDisplay(raw: string): DiffDisplay | null {
  const lines = raw.split('\n')
  // 必须包含 diff 头部或 hunk 标记
  const hasDiffHeader = lines.some(l => l.startsWith('diff --git'))
  const hasHunk = lines.some(l => l.startsWith('@@'))
  const hasAddDel = lines.some(l =>
    (l.startsWith('+') && !l.startsWith('+++ ')) ||
    (l.startsWith('-') && !l.startsWith('--- '))
  )
  if (!hasDiffHeader && !(hasHunk && hasAddDel)) return null
  // 至少 3 行 diff 特征
  let diffCount = 0
  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('--- ') ||
        line.startsWith('+++ ') || line.startsWith('@@') ||
        (line.startsWith('+') && !line.startsWith('+++ ')) ||
        (line.startsWith('-') && !line.startsWith('--- '))) {
      diffCount++
    }
  }
  if (diffCount < 3) return null
  const parsedLines: DiffLine[] = lines.map(line => {
    if (line.startsWith('diff --git') || line.startsWith('index ')) {
      return { text: line, kind: 'header' }
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      return { text: line, kind: 'header' }
    }
    if (line.startsWith('@@')) {
      return { text: line, kind: 'hunk' }
    }
    if (line.startsWith('+')) {
      return { text: line, kind: 'add' }
    }
    if (line.startsWith('-')) {
      return { text: line, kind: 'del' }
    }
    return { text: line, kind: 'context' }
  })
  return { type: 'diff', lines: parsedLines, raw }
}

/** 检测输出是否为可折叠的 JSON（数组或嵌套对象） */
function detectJsonDisplay(raw: string): JsonDisplay | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    // 扁平对象由 parseJsonKv 处理，这里处理数组和嵌套对象
    const summary = Array.isArray(parsed)
      ? `Array(${parsed.length})`
      : `Object(${Object.keys(parsed).length} keys)`
    return { type: 'json', raw: trimmed, summary }
  } catch {
    return null
  }
}

function detectCodeDisplay(raw: string): CodeDisplay | MarkdownDisplay {
  if (isMarkdown(raw)) {
    return { type: 'markdown' }
  }
  const lines = raw.split('\n').length
  const trimmed = raw.trimStart()
  let lang = 'TEXT'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) lang = 'JSON'
  else if (trimmed.startsWith('```')) {
    const firstLine = trimmed.split('\n')[0]
    const tag = firstLine.slice(3).trim()
    if (tag) lang = tag.toUpperCase()
  }
  return { type: 'code', raw: raw, lang, lines }
}

const inputDisplay = computed<SectionDisplay>(() => {
  const kv = parseJsonKv(props.toolCall.input)
  if (kv) return kv
  return { type: 'markdown' }
})

const outputDisplay = computed<SectionDisplay>(() => {
  const raw = props.toolCall.output
  if (!raw) return { type: 'markdown' }
  // 1) 图片预览
  const img = detectImageDisplay(raw)
  if (img) return img
  // 2) Diff 语法高亮
  const diff = detectDiffDisplay(raw)
  if (diff) return diff
  // 3) 扁平 JSON → KV 键值对
  const kv = parseJsonKv(raw)
  if (kv) return kv
  // 4) 嵌套 JSON → 可折叠展示
  const json = detectJsonDisplay(raw)
  if (json) return json
  // 5) Markdown 或纯文本代码块
  return detectCodeDisplay(raw)
})

// ── JSON 折叠状态（每次输出变化时重置） ──
const jsonExpanded = ref(false)
watch(() => props.toolCall.output, () => {
  jsonExpanded.value = false
})

// ── 图片预览 ──
const { open: openMediaViewer } = useMediaViewer()
function openImage(url: string) {
  openMediaViewer([{ src: url, alt: 'Tool result' }], 0)
}

// ── Pin payload detection ──
function getPinPayload(): { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string } {
  const name = props.toolCall.name
  const output = props.toolCall.output || ''
  const input = props.toolCall.input || ''

  // 代码类工具 → code card
  if (name === 'run_python' || name === 'file_edit' || name === 'file_write') {
    return { type: 'code', title: name, content: input, sourceTool: name }
  }

  // JSON 数组输出 → table card
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return { type: 'table', title: name, content: output, sourceTool: name }
    }
  } catch { /* not JSON */ }

  // 默认 → summary card
  return { type: 'summary', title: name, content: output || input, sourceTool: name }
}

// ── Expand / collapse ──
function toggle() {
  if (props.toolCall.status === 'running') return
  isOpen.value = !isOpen.value
}

watch(isOpen, (open) => {
  if (!bodyWrapper.value) return
  if (open) {
    bodyWrapper.value.style.maxHeight = bodyWrapper.value.scrollHeight + 'px'
  } else {
    bodyWrapper.value.style.maxHeight = bodyWrapper.value.scrollHeight + 'px'
    void bodyWrapper.value.offsetHeight
    bodyWrapper.value.style.maxHeight = '0px'
  }
})

watch(() => props.toolCall.status, (s) => {
  if (s === 'running') {
    isOpen.value = true
  }
})

watch(() => props.toolCall.output, () => {
  nextTick(() => {
    if (isOpen.value && bodyWrapper.value) {
      bodyWrapper.value.style.maxHeight = bodyWrapper.value.scrollHeight + 'px'
    }
  })
})
</script>

<style scoped>
.tool-card {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  box-shadow: var(--shadow);
  overflow: hidden;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
@media (prefers-reduced-motion: no-preference) {
  .tool-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
}
.tool-card.running {
  border-color: var(--accent-dark);
}
.tool-card.error {
  border-color: #fecaca;
}
.tool-header {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.tool-icon {
  font-size: 12px;
  width: 16px;
  text-align: center;
}
.spinner-sm {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: maxma-spin 0.8s linear infinite;
}
.tool-name {
  font-weight: 600;
  color: var(--text-primary);
}
.tool-elapsed {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── Body ── */
.tool-body-wrapper {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0, 0.3, 0, 1),
              opacity 0.25s ease;
  opacity: 0;
}
.tool-card.open > .tool-body-wrapper {
  opacity: 1;
}
.tool-body {
  border-top: 1px solid var(--border);
  padding: 12px 16px 16px;
}

/* ── Section ── */
.tool-section {
  margin-bottom: 14px;
}
.tool-section:last-child {
  margin-bottom: 0;
}
.tool-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  padding-bottom: 6px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

/* ── KV list ── */
.kv-list {
  background: var(--bg-primary);
  border-radius: 6px;
  padding: 8px 14px;
}
.kv-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 3px 0;
  line-height: 1.6;
}
.kv-key {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 6em;
}
.kv-key::after {
  content: ':';
}
.kv-value {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
}
.kv-nested {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  background: var(--bg-secondary);
  padding: 6px 10px;
  border-radius: 4px;
  flex: 1;
  max-height: 120px;
  overflow-y: auto;
}

/* ── Output code block ── */
.code-block {
  margin: 0;
  padding: 10px 14px;
  background: var(--bg-primary);
  border-radius: 6px;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

/* ── Image preview ── */
.image-preview {
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-primary);
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 300px;
  cursor: zoom-in;
}
.image-preview img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  display: block;
}

/* ── Diff syntax highlighting ── */
.diff-block {
  background: var(--bg-primary);
  border-radius: 6px;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
  padding: 8px 0;
}
.diff-line {
  padding: 0 14px;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 18px;
}
.diff-header {
  color: var(--text-secondary);
  font-weight: 600;
  background: var(--bg-secondary);
}
.diff-hunk {
	  color: var(--status-info);
	  background: color-mix(in srgb, var(--status-info) 8%, transparent);
	  font-weight: 500;
	}
	.diff-add {
	  color: var(--status-ok);
	  background: color-mix(in srgb, var(--status-ok) 8%, transparent);
	}
	.diff-del {
	  color: var(--status-error);
	  background: color-mix(in srgb, var(--status-error) 8%, transparent);
	}
.diff-context {
  color: var(--text-primary);
}

/* ── Collapsible JSON ── */
.json-block {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.json-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  transition: background 0.15s ease;
}
.json-header:hover {
  background: var(--bg-secondary);
}
.json-toggle {
  font-size: 10px;
  color: var(--text-secondary);
  width: 12px;
  flex-shrink: 0;
  text-align: center;
}
.json-summary {
  color: var(--text-primary);
  font-weight: 500;
}
.json-expanded {
  border-top: 1px solid var(--border);
  border-radius: 0 0 6px 6px;
  max-height: 300px;
}

/* ── Compact markdown overrides inside tool cards ── */
.tool-section :deep(.markdown-body) {
  font-size: 13px;
  line-height: 1.5;
}
.tool-section :deep(.markdown-body pre) {
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  margin: 4px 0;
  max-height: 200px;
  overflow-y: auto;
}
.tool-section :deep(.markdown-body code) {
  font-size: 12px;
}
.tool-section :deep(.markdown-body) > *:first-child {
  margin-top: 0;
}
.tool-section :deep(.markdown-body) > *:last-child {
  margin-bottom: 0;
}
</style>
