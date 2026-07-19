<template>
  <div class="file-diff-view" v-if="diffText">
    <!-- 统计栏 -->
    <div class="diff-header">
      <div class="diff-stats">
        <span class="stat additions">+{{ additions }}</span>
        <span class="stat deletions">-{{ deletions }}</span>
      </div>
      <div class="diff-file" v-if="fileName">{{ fileName }}</div>
    </div>

    <!-- Diff 内容 -->
    <div class="diff-container">
      <div
        v-for="(line, i) in visibleLines"
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  diff: string
  additions?: number
  deletions?: number
  fileName?: string
}>()

const maxLines = 300

const diffText = computed(() => props.diff || '')

const diffLines = computed(() => {
  const text = diffText.value
  if (!text) return []
  return text.split('\n').slice(0, maxLines)
})

const visibleLines = computed(() => diffLines.value)

const isTruncated = computed(() => {
  const text = diffText.value
  if (!text) return false
  return text.split('\n').length > maxLines
})

const additions = computed(() => {
  if (props.additions != null) return props.additions
  // fallback: count from diff
  return diffText.value.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length
})

const deletions = computed(() => {
  if (props.deletions != null) return props.deletions
  return diffText.value.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---')).length
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
    const parts = line.split(' ')
    return parts.length > 1 ? parts.slice(1).join(' ') : line
  }
  if (line.startsWith('@@')) return line
  if (line.length > 0) return line.substring(1)
  return ''
}
</script>

<style scoped>
.file-diff-view {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── 统计栏 ── */
.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
}

.diff-stats {
  display: flex;
  gap: 8px;
}

.stat {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.stat.additions {
	  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
	  color: var(--status-ok);
	}

	.stat.deletions {
	  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
	  color: var(--status-error);
	}

.diff-file {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  max-height: 360px;
  overflow-y: auto;
}

.diff-line {
  display: flex;
  padding: 0 10px;
  white-space: pre;
  min-height: 19px;
}

.diff-line.file-header {
	  background: var(--bg-secondary);
	  color: var(--text-secondary);
	  font-weight: 600;
	  padding: 4px 10px;
	  border-bottom: 1px solid var(--border);
	}

	.diff-line.hunk-header {
	  background: color-mix(in srgb, var(--status-info) 12%, var(--bg-card));
	  color: var(--status-info);
	  padding: 2px 10px;
	}

	.diff-line.addition {
	  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
	  color: var(--status-ok);
	}

	.diff-line.deletion {
	  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
	  color: var(--status-error);
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
</style>
