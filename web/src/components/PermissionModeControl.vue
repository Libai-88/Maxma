<template>
  <section
    v-if="enabled"
    class="permission-mode-control"
    aria-label="会话权限模式"
  >
    <button
      class="permission-trigger"
      type="button"
      :aria-expanded="open"
      aria-controls="permission-mode-options"
      :disabled="busy"
      @click="open = !open"
    >
      <span class="permission-trigger-label">权限：{{ currentOption.label }}</span>
      <span class="permission-trigger-state">{{ busy ? '保存中…' : open ? '收起' : '设置' }}</span>
    </button>

    <div v-if="open" id="permission-mode-options" class="permission-panel">
      <p class="permission-summary">
        这是当前会话的额外限制，不会绕过工具白名单、路径保护、MCP 限制、审批或沙盒。
      </p>

      <div class="permission-options" role="radiogroup" aria-label="选择会话权限模式">
        <button
          v-for="option in options"
          :key="option.value"
          class="permission-option"
          :class="{ selected: currentMode === option.value }"
          type="button"
          role="radio"
          :aria-checked="currentMode === option.value"
          :disabled="busy"
          @click="requestMode(option.value)"
        >
          <span class="option-copy">
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </span>
          <span v-if="currentMode === option.value" class="option-current">当前</span>
        </button>
      </div>

      <div v-if="pendingMode" class="permission-confirmation" role="status" aria-live="polite">
        <strong>确认提高权限？</strong>
        <p>{{ optionFor(pendingMode).confirmation }}</p>
        <div class="confirmation-actions">
          <button class="confirm-change" type="button" :disabled="busy" @click="confirmPendingMode">
            确认切换
          </button>
          <button class="cancel-change" type="button" :disabled="busy" @click="pendingMode = null">
            保持当前模式
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type PermissionMode = 'read_only' | 'ask' | 'operate' | 'auto'

const props = withDefaults(defineProps<{
  /** Server-owned feature flag. False keeps the legacy approval UI unchanged. */
  enabled?: boolean
  mode?: PermissionMode
  busy?: boolean
}>(), {
  enabled: false,
  mode: 'ask',
  busy: false,
})

const emit = defineEmits<{
  /** Emitted only after the user confirms an increase in permission. */
  change: [mode: PermissionMode]
}>()

type PermissionOption = {
  value: PermissionMode
  label: string
  description: string
  confirmation: string
}

const options: PermissionOption[] = [
  {
    value: 'read_only',
    label: '只读',
    description: '允许读取；写入、本地执行、联网和未知工具都会被拒绝。',
    confirmation: '此模式会阻止写入和执行操作。',
  },
  {
    value: 'ask',
    label: '每次确认',
    description: '允许读取；写入、执行、联网和未知工具都需逐次确认。',
    confirmation: '此模式会在可能改变环境的操作前征求确认。',
  },
  {
    value: 'operate',
    label: '工作区操作',
    description: '允许受保护范围内的本地写入；执行、联网、破坏性和未知操作仍需确认。',
    confirmation: '本地写入将不再逐次确认；执行、联网和破坏性操作仍会要求确认。',
  },
  {
    value: 'auto',
    label: '受控自动',
    description: '仅明确允许的本地工具可自动运行；执行、联网、破坏性和未知操作仍需确认。',
    confirmation: '只有服务器白名单中的低风险本地工具可自动运行，其余高风险操作仍会要求确认。',
  },
]

const modeRank: Record<PermissionMode, number> = {
  read_only: 0,
  ask: 1,
  operate: 2,
  auto: 3,
}

const open = ref(false)
const pendingMode = ref<PermissionMode | null>(null)
const currentMode = computed(() => props.mode)
const currentOption = computed(() => optionFor(currentMode.value))

watch(() => props.enabled, enabled => {
  if (!enabled) {
    open.value = false
    pendingMode.value = null
  }
})

watch(() => props.mode, () => {
  pendingMode.value = null
})

function optionFor(mode: PermissionMode): PermissionOption {
  return options.find(option => option.value === mode) ?? options[1]
}

function requestMode(mode: PermissionMode) {
  if (props.busy || mode === currentMode.value) return

  if (modeRank[mode] > modeRank[currentMode.value]) {
    pendingMode.value = mode
    return
  }

  emit('change', mode)
}

function confirmPendingMode() {
  if (!pendingMode.value || props.busy) return
  emit('change', pendingMode.value)
}
</script>

<style scoped>
.permission-mode-control {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.permission-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.permission-trigger:hover:not(:disabled) {
  background: var(--bg-secondary);
}

.permission-trigger:focus-visible,
.permission-option:focus-visible,
.confirm-change:focus-visible,
.cancel-change:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.permission-trigger:disabled,
.permission-option:disabled,
.confirm-change:disabled,
.cancel-change:disabled {
  cursor: wait;
  opacity: 0.65;
}

.permission-trigger-state {
  color: var(--text-secondary);
}

.permission-panel {
  position: absolute;
  z-index: 220;
  top: calc(100% + 6px);
  right: 0;
  width: min(348px, calc(100vw - 32px));
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  background: var(--bg-card);
  box-shadow: var(--shadow-lg);
}

.permission-summary {
  margin: 0 0 9px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.permission-options {
  display: grid;
  gap: 5px;
}

.permission-option {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 8px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.permission-option:hover:not(:disabled),
.permission-option.selected {
  border-color: var(--border);
  background: var(--bg-secondary);
}

.option-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.option-copy strong {
  font-size: 13px;
  font-weight: 600;
}

.option-copy span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.option-current {
  flex: 0 0 auto;
  color: var(--accent);
  font-size: 12px;
}

.permission-confirmation {
  margin-top: 9px;
  border-left: 3px solid var(--status-warn);
  padding: 8px 0 0 9px;
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.45;
}

.permission-confirmation p {
  margin: 4px 0 8px;
  color: var(--text-secondary);
}

.confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.confirm-change,
.cancel-change {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.confirm-change {
  border-color: var(--status-warn);
  background: var(--status-warn);
  color: var(--bg-primary);
}

@media (max-width: 600px) {
  .permission-panel {
    position: fixed;
    top: auto;
    right: 16px;
    bottom: 16px;
  }
}
</style>
