<!-- web/src/components/ui/ConfirmDialog.vue
     全局确认对话框 — 由 useConfirm 驱动，挂载在 App.vue 顶层 -->
<template>
  <DsModal
    :model-value="state.visible"
    :title="state.options.title || '请确认'"
    @update:model-value="onOverlayClose"
  >
    <p class="confirm-message">{{ state.options.message }}</p>
    <template #actions>
      <button type="button" class="ds-btn" @click="respond(false)">
        {{ state.options.cancelText || '取消' }}
      </button>
      <button
        type="button"
        class="ds-btn"
        :class="state.options.danger ? 'ds-btn--danger-filled' : 'ds-btn--primary'"
        @click="respond(true)"
      >
        {{ state.options.confirmText || '确定' }}
      </button>
    </template>
  </DsModal>
</template>

<script setup lang="ts">
import DsModal from './DsModal.vue'
import { useConfirmDialog } from '@/composables/useConfirm'

const { state, respond } = useConfirmDialog()

/** 点击遮罩关闭 = 取消 */
function onOverlayClose(value: boolean) {
  if (!value) respond(false)
}
</script>

<style scoped>
.confirm-message {
  margin: 0;
  font-size: var(--fs-body);
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-line;
}
</style>
