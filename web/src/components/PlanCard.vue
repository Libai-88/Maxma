<template>
  <div class="plan-card" :class="plan.status">
    <div class="plan-header">
      <span class="plan-icon">&#128203;</span>
      <span class="plan-title">执行计划</span>
      <span class="plan-status" :class="plan.status">{{ statusText }}</span>
    </div>

    <div class="plan-steps">
      <div
        v-for="(step, i) in plan.steps"
        :key="i"
        class="plan-step"
        :class="getStepClass(i)"
      >
        <span class="step-num" :class="getStepClass(i)">
          <span v-if="getStepStatus(i) === 'done'">&#10003;</span>
          <span v-else-if="getStepStatus(i) === 'failed'">&#10007;</span>
          <span v-else-if="getStepStatus(i) === 'skipped'">&ndash;</span>
          <span v-else-if="getStepStatus(i) === 'running'" class="step-spinner"></span>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="step-text">{{ step }}</span>
        <span v-if="getStepStatus(i) === 'running'" class="step-badge running">执行中</span>
        <span v-else-if="getStepStatus(i) === 'failed'" class="step-badge failed">失败</span>
        <span v-else-if="getStepStatus(i) === 'skipped'" class="step-badge skipped">跳过</span>
        <span v-else-if="getStepStatus(i) === 'done'" class="step-badge done">完成</span>
      </div>
    </div>

    <!-- 重规划提示 -->
    <div v-if="plan.status === 'replanning'" class="plan-replan-hint">
      <span class="replan-icon">&#128260;</span>
      <span>步骤失败，正在重新规划... (第 {{ (plan.replanCount || 0) + 1 }} 次重规划)</span>
    </div>

    <!-- 失败信息 -->
    <div v-if="plan.status === 'failed'" class="plan-failed-hint">
      <span class="failed-icon">&#9888;</span>
      <span>步骤执行失败（共 {{ plan.failureCount || 0 }} 次失败）</span>
    </div>

    <!-- 编辑模式 -->
    <div v-if="isEditing" class="plan-edit">
      <textarea
        v-model="editedPlan"
        class="plan-textarea"
        rows="6"
        placeholder="修改计划内容..."
      ></textarea>
    </div>

    <!-- 操作按钮 -->
    <div v-if="plan.status === 'pending'" class="plan-actions">
      <button v-if="!isEditing" class="plan-btn approve" @click="approve">
        确认执行
      </button>
      <button v-if="!isEditing" class="plan-btn edit" @click="startEdit">
        编辑
      </button>
      <button v-if="!isEditing" class="plan-btn reject" @click="reject">
        拒绝
      </button>
      <template v-if="isEditing">
        <button class="plan-btn approve" @click="submitEdit">
          提交修改
        </button>
        <button class="plan-btn cancel" @click="cancelEdit">
          取消
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PlanCard } from '@/types'

const props = defineProps<{
  plan: PlanCard
}>()

const emit = defineEmits<{
  (e: 'respond', planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string): void
}>()

const isEditing = ref(false)
const editedPlan = ref('')

const statusText = computed(() => {
  switch (props.plan.status) {
    case 'pending': return '等待确认'
    case 'approved': return '已确认'
    case 'modified': return '已修改并确认'
    case 'rejected': return '已拒绝'
    case 'running': return '执行中'
    case 'failed': return '执行失败'
    case 'replanning': return '重规划中'
    default: return ''
  }
})

function getStepStatus(index: number): string {
  const statuses = props.plan.stepStatuses
  if (!statuses) return 'pending'
  return statuses[String(index)] || 'pending'
}

function getStepClass(index: number): string {
  return `step-${getStepStatus(index)}`
}

function approve() {
  emit('respond', props.plan.planId, 'approve')
}

function reject() {
  emit('respond', props.plan.planId, 'reject')
}

function startEdit() {
  editedPlan.value = props.plan.planText
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
  editedPlan.value = ''
}

function submitEdit() {
  if (editedPlan.value.trim()) {
    emit('respond', props.plan.planId, 'modify', editedPlan.value.trim())
  }
  isEditing.value = false
}
</script>

<style scoped>
.plan-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
  margin: 8px 0;
  background: var(--bg-card);
  transition: border-color 0.2s;
}

.plan-card.pending {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 4%, var(--bg-card));
}

.plan-card.approved {
  border-color: #86efac;
  background: #f0fdf4;
}

.plan-card.modified {
  border-color: #93c5fd;
  background: #eff6ff;
}

.plan-card.rejected {
  border-color: #fca5a5;
  background: #fef2f2;
  opacity: 0.7;
}

.plan-card.running {
  border-color: #93c5fd;
  background: #eff6ff;
}

.plan-card.failed {
  border-color: #fca5a5;
  background: #fef2f2;
}

.plan-card.replanning {
  border-color: #fbbf24;
  background: #fffbeb;
}

/* ── 头部 ── */
.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.plan-icon {
  font-size: 18px;
}

.plan-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.plan-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 500;
}

.pending .plan-status { background: #fef3c7; color: #92400e; }
.approved .plan-status { background: #dcfce7; color: #166534; }
.modified .plan-status { background: #dbeafe; color: #1e40af; }
.rejected .plan-status { background: #fee2e2; color: #991b1b; }
.running .plan-status { background: #dbeafe; color: #1e40af; }
.failed .plan-status { background: #fee2e2; color: #991b1b; }
.replanning .plan-status { background: #fef3c7; color: #92400e; }

/* ── 步骤列表 ── */
.plan-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.plan-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
  padding: 4px 6px;
  border-radius: 4px;
  transition: background 0.15s;
}

.plan-step.step-running {
  background: color-mix(in srgb, #93c5fd 12%, transparent);
}

.plan-step.step-done {
  opacity: 0.7;
}

.plan-step.step-failed {
  background: color-mix(in srgb, #fca5a5 12%, transparent);
}

.plan-step.step-skipped {
  opacity: 0.5;
  text-decoration: line-through;
}

.step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.step-num.step-done { background: var(--status-ok); }
.step-num.step-failed { background: var(--status-error); }
.step-num.step-skipped { background: #9ca3af; }
.step-num.step-running { background: var(--status-info); }

.step-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--bg-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.step-text {
  color: var(--text-primary);
  flex: 1;
}

.step-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-badge.running { background: #dbeafe; color: #1e40af; }
.step-badge.done { background: #dcfce7; color: #166534; }
.step-badge.failed { background: #fee2e2; color: #991b1b; }
.step-badge.skipped { background: #f3f4f6; color: #6b7280; }

/* ── 重规划/失败提示 ── */
.plan-replan-hint,
.plan-failed-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 6px;
  font-size: 12px;
}

.plan-replan-hint {
  background: #fffbeb;
  color: #92400e;
}

.plan-failed-hint {
  background: #fef2f2;
  color: #991b1b;
}

.replan-icon {
  display: inline-block;
  animation: spin 1.5s linear infinite;
}

/* ── 编辑区 ── */
.plan-edit {
  margin-bottom: 12px;
}

.plan-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--bg-primary);
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}

.plan-textarea:focus {
  border-color: var(--accent);
}

/* ── 按钮 ── */
.plan-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.plan-btn {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}

.plan-btn.approve {
  background: #16a34a;
  color: white;
  border-color: #16a34a;
}

.plan-btn.approve:hover {
  background: #15803d;
}

.plan-btn.edit {
  background: var(--bg-card);
  color: var(--text-primary);
}

.plan-btn.edit:hover {
  background: var(--bg-secondary);
}

.plan-btn.reject {
  background: var(--bg-card);
  color: #dc2626;
  border-color: #fca5a5;
}

.plan-btn.reject:hover {
  background: #fef2f2;
}

.plan-btn.cancel {
  background: var(--bg-card);
  color: var(--text-secondary);
}

.plan-btn.cancel:hover {
  background: var(--bg-secondary);
}
</style>
