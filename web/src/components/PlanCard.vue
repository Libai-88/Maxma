<template>
  <div class="plan-card" :class="plan.status">
    <div class="plan-header">
      <span class="plan-icon">&#128203;</span>
      <span class="plan-title">执行计划</span>
      <span class="plan-status">{{ statusText }}</span>
    </div>

    <div class="plan-steps">
      <div v-for="(step, i) in plan.steps" :key="i" class="plan-step">
        <span class="step-num">{{ i + 1 }}</span>
        <span class="step-text">{{ step }}</span>
      </div>
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
    default: return ''
  }
})

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

.pending .plan-status {
  background: #fef3c7;
  color: #92400e;
}

.approved .plan-status {
  background: #dcfce7;
  color: #166534;
}

.modified .plan-status {
  background: #dbeafe;
  color: #1e40af;
}

.rejected .plan-status {
  background: #fee2e2;
  color: #991b1b;
}

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
}

.step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}

.step-text {
  color: var(--text-primary);
  flex: 1;
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
