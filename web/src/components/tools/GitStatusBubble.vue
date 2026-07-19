<template>
  <BubbleChrome :tool-call="toolCall">
    <!-- 运行中 -->
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>{{ runningLabel }}</span>
    </div>

    <!-- 错误 -->
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || 'Git 操作失败' }}
    </div>

    <!-- 完成 -->
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="toolCall.toolData" class="git-result">
        <!-- ===== git_status ===== -->
        <template v-if="toolName === 'git_status'">
          <div class="status-header">
            <span class="status-icon">&#128268;</span>
            <div class="status-header-text">
              <div class="status-branch" v-if="td.branch">
                <span class="branch-label">&#128256;</span>
                <code class="branch-name">{{ td.branch }}</code>
              </div>
              <div class="status-summary">{{ td.summary || '工作目录干净' }}</div>
            </div>
          </div>

          <!-- 已暂存 -->
          <div v-if="stagedFiles.length > 0" class="file-group">
            <div class="group-header">
              <span class="group-badge staged">已暂存</span>
              <span class="group-count">{{ stagedFiles.length }}</span>
            </div>
            <div class="file-list">
              <div v-for="(f, i) in stagedFiles" :key="'s'+i" class="file-row">
                <span class="file-status-badge" :class="f.status">{{ statusIcon(f.status) }}</span>
                <span class="file-name">{{ f.file }}</span>
              </div>
            </div>
          </div>

          <!-- 未暂存 -->
          <div v-if="unstagedFiles.length > 0" class="file-group">
            <div class="group-header">
              <span class="group-badge unstaged">未暂存</span>
              <span class="group-count">{{ unstagedFiles.length }}</span>
            </div>
            <div class="file-list">
              <div v-for="(f, i) in unstagedFiles" :key="'u'+i" class="file-row">
                <span class="file-status-badge" :class="f.status">{{ statusIcon(f.status) }}</span>
                <span class="file-name">{{ f.file }}</span>
              </div>
            </div>
          </div>

          <!-- 未跟踪 -->
          <div v-if="untrackedFiles.length > 0" class="file-group">
            <div class="group-header">
              <span class="group-badge untracked">未跟踪</span>
              <span class="group-count">{{ untrackedFiles.length }}</span>
            </div>
            <div class="file-list">
              <div v-for="(f, i) in untrackedFiles" :key="'t'+i" class="file-row">
                <span class="file-status-badge untracked">?</span>
                <span class="file-name">{{ f.file }}</span>
              </div>
            </div>
          </div>

          <div v-if="stagedFiles.length === 0 && unstagedFiles.length === 0 && untrackedFiles.length === 0" class="clean-state">
            工作目录干净，没有变更
          </div>
        </template>

        <!-- ===== git_commit ===== -->
        <template v-else-if="toolName === 'git_commit'">
          <div class="commit-success">
            <span class="success-icon">&#10003;</span>
            <div class="commit-text">
              <div class="commit-title">{{ td.commit_hash || '' }} {{ td.commit_message }}</div>
              <div class="commit-detail">{{ td.message }}</div>
            </div>
          </div>
        </template>

        <!-- ===== git_branch ===== -->
        <template v-else-if="toolName === 'git_branch'">
          <div class="branch-result">
            <div class="branch-summary">{{ td.summary }}</div>
            <div v-if="branches.length > 0" class="branch-list">
              <div v-for="(b, i) in branches" :key="i" class="branch-row" :class="{ current: b.current }">
                <span class="branch-indicator" v-if="b.current">&#9654;</span>
                <span class="branch-indicator" v-else>&nbsp;</span>
                <code class="branch-name-text">{{ b.name }}</code>
              </div>
            </div>
          </div>
        </template>

        <!-- ===== git_push ===== -->
        <template v-else-if="toolName === 'git_push'">
          <div class="push-success">
            <span class="success-icon">&#10003;</span>
            <div class="push-text">
              <div class="push-title">{{ td.message }}</div>
              <div class="push-detail" v-if="td.remote">Remote: {{ td.remote }}</div>
            </div>
          </div>
        </template>

        <!-- ===== git_pr ===== -->
        <template v-else-if="toolName === 'git_pr'">
          <div class="pr-success">
            <span class="success-icon">&#10003;</span>
            <div class="pr-text">
              <div class="pr-title">PR 已创建</div>
              <a v-if="td.url" :href="String(td.url)" target="_blank" class="pr-link">{{ td.url }}</a>
              <div class="pr-detail" v-if="td.base">Target: {{ td.base }}</div>
            </div>
          </div>
        </template>

        <!-- ===== git_log ===== -->
        <template v-else-if="toolName === 'git_log'">
          <div class="log-header">
            <span class="log-icon">&#128203;</span>
            <div class="log-summary">{{ td.summary || `${td.count} 条提交` }}</div>
          </div>
          <div v-if="commits.length > 0" class="commit-list">
            <div v-for="(c, i) in commits" :key="i" class="commit-row">
              <code class="commit-hash">{{ c.hash }}</code>
              <span class="commit-msg">{{ c.message }}</span>
            </div>
          </div>
        </template>

        <!-- ===== fallback ===== -->
        <div v-else class="raw-output">{{ JSON.stringify(toolCall.toolData, null, 2) }}</div>
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
const toolName = computed(() => props.toolCall.name)

const runningLabel = computed(() => {
  switch (toolName.value) {
    case 'git_status': return '正在检查仓库状态...'
    case 'git_diff': return '正在计算差异...'
    case 'git_log': return '正在读取提交历史...'
    case 'git_commit': return '正在提交...'
    case 'git_branch': return '正在管理分支...'
    case 'git_push': return '正在推送到远程...'
    case 'git_pr': return '正在创建 PR...'
    default: return '正在执行 Git 操作...'
  }
})

// git_status 解析
const stagedFiles = computed(() => {
  const arr = td.value.staged
  return Array.isArray(arr) ? arr : []
})
const unstagedFiles = computed(() => {
  const arr = td.value.unstaged
  return Array.isArray(arr) ? arr : []
})
const untrackedFiles = computed(() => {
  const arr = td.value.untracked
  if (!Array.isArray(arr)) return []
  // 统一为对象数组，兼容字符串数组与对象数组两种后端返回格式
  return arr.map(f => typeof f === 'string' ? { file: f } : f)
})

// git_branch 解析
const branches = computed(() => {
  const arr = td.value.branches
  return Array.isArray(arr) ? arr : []
})

// git_log 解析
const commits = computed(() => {
  const arr = td.value.commits
  return Array.isArray(arr) ? arr : []
})

function statusIcon(status: string): string {
  switch (status) {
    case 'added': return 'A'
    case 'modified': return 'M'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    default: return status.charAt(0).toUpperCase()
  }
}
</script>

<style scoped>
.git-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── 状态头 ── */
.status-header,
.log-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.status-icon,
.log-icon {
  font-size: 20px;
  line-height: 1.2;
  flex-shrink: 0;
}

.status-header-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.status-branch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.branch-label {
  font-size: 14px;
}

.branch-name {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-secondary);
  padding: 1px 6px;
  border-radius: 4px;
}

.status-summary,
.log-summary {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── 文件分组 ── */
.file-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.group-badge.staged {
	  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
	  color: var(--status-ok);
	}

	.group-badge.unstaged {
	  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
	  color: var(--status-warn);
	}

	.group-badge.untracked {
	  background: color-mix(in srgb, var(--status-info) 12%, var(--bg-card));
	  color: var(--status-info);
	}

.group-count {
  font-size: 11px;
  color: var(--text-secondary);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  max-height: 200px;
  overflow-y: auto;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  transition: background 0.1s;
}

.file-row:hover {
  background: var(--bg-secondary);
}

.file-status-badge {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 700;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.file-status-badge.added {
	  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
	  color: var(--status-ok);
	}

	.file-status-badge.modified {
	  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
	  color: var(--status-warn);
	}

	.file-status-badge.deleted {
	  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
	  color: var(--status-error);
	}

	.file-status-badge.renamed,
	.file-status-badge.copied {
	  background: color-mix(in srgb, var(--status-info) 12%, var(--bg-card));
	  color: var(--status-info);
	}

	.file-status-badge.untracked {
	  background: color-mix(in srgb, var(--status-info) 12%, var(--bg-card));
	  color: var(--status-info);
	}

.file-name {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clean-state {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 8px 0;
  text-align: center;
  font-style: italic;
}

/* ── 提交成功 ── */
.commit-success,
.push-success,
.pr-success {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: #eaf6ea;
  border: 1px solid #b8d8b8;
  border-radius: 6px;
}

.success-icon {
  font-size: 18px;
  color: #3d8b3d;
  font-weight: 700;
  flex-shrink: 0;
}

.commit-text,
.push-text,
.pr-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.commit-title {
  font-size: 13px;
  font-weight: 600;
  color: #2d5a2d;
  font-family: 'SF Mono', 'Consolas', monospace;
}

.commit-detail,
.push-detail,
.pr-detail {
  font-size: 12px;
  color: #3d7a3d;
}

.pr-link {
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.pr-link:hover {
  text-decoration: underline;
}

.pr-title {
  font-size: 14px;
  font-weight: 600;
  color: #2d5a2d;
}

/* ── 分支列表 ── */
.branch-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-summary {
  font-size: 12px;
  color: var(--text-secondary);
}

.branch-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  max-height: 200px;
  overflow-y: auto;
}

.branch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  transition: background 0.1s;
}

.branch-row:hover {
  background: var(--bg-secondary);
}

.branch-row.current {
  background: #dcfce7;
}

.branch-indicator {
  font-size: 10px;
  color: #166534;
  width: 14px;
  flex-shrink: 0;
}

.branch-name-text {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-primary);
}

/* ── 提交历史 ── */
.commit-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
  max-height: 260px;
  overflow-y: auto;
}

.commit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 12px;
  transition: background 0.1s;
}

.commit-row:hover {
  background: var(--bg-secondary);
}

.commit-hash {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  color: var(--accent);
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.commit-msg {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  animation: maxma-spin 0.6s linear infinite;
  flex-shrink: 0;
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
