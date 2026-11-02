<template>
  <section
    ref="rootRef"
    v-if="visibleOptions.length > 0"
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
        这是当前会话的附加限制，只能收紧：它不会绕过拒止锚（MaxmaBlocker）、
        MCP stdio 命令白名单或 Provider URL 校验。
      </p>

      <div class="permission-options" role="radiogroup" aria-label="选择会话权限模式">
        <button
          v-for="option in visibleOptions"
          :key="option.value"
          class="permission-option"
          :class="{ selected: currentMode === option.value }"
          type="button"
          role="radio"
          :aria-checked="currentMode === option.value"
          :data-mode="option.value"
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
import { gsap, useGsap, easeMap, durationMap } from '@/composables/useGsap'
import type { PermissionMode } from '@/types'

const props = withDefaults(defineProps<{
  /**
   * 服务端 `available_permission_modes` 的投影：可用档位 + 展示顺序。
   * 空数组 = 该会话没有可用的权限模式，控件整体不渲染（不摆一个拨不动的开关）。
   */
  availableModes?: PermissionMode[]
  mode?: PermissionMode
  busy?: boolean
}>(), {
  availableModes: () => ['read_only', 'ask', 'operate', 'auto'],
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

/**
 * 档位文案表（唯一一份 UI 文案）；可见性与顺序由服务端 availableModes 决定。
 *
 * 文案必须与 `bun-sidecar/src/kernel/approval-gate.ts` 的 `needsApprovalForMode`
 * 逐句对得上，判据只有官方 `Tool.annotations`（readOnlyHint / destructiveHint）与
 * 工具名族：
 *   - read_only 与 ask 走**同一个分支**（非只读即审批），今天没有行为差别，
 *     所以文案不许编造"只读会拒绝写入"这种差别；
 *   - operate 只拦执行族（bash / powershell）与 destructiveHint，未标注的写入放行；
 *   - auto 全部放行、**不再弹任何确认**（旧文案"仅明确允许的本地工具可自动运行，
 *     其余仍需确认"是反的，等于向用户承诺了一层不存在的保护）；
 *   - 不存在"路径白名单"或"沙盒"这一层（docs/security-contract.md §1/§3），
 *     所以也不许把它们列为"不会被绕过"的保证。
 */
const options: PermissionOption[] = [
  {
    value: 'read_only',
    label: '只读',
    description: '只有标注为只读的工具自动放行；写入、执行、联网一律逐次确认。',
    confirmation: '此模式会让所有非只读工具先征求确认。',
  },
  {
    value: 'ask',
    label: '每次确认',
    description: '与「只读」判定相同：只读工具放行，其余逐次确认。会话默认档。',
    confirmation: '此模式会在可能改变环境的操作前征求确认。',
  },
  {
    value: 'operate',
    label: '工作区操作',
    description: '本地写入自动放行；执行类（bash / PowerShell）与破坏性操作仍需确认。',
    confirmation: '本地写入将不再逐次确认；执行与破坏性操作仍会要求确认。',
  },
  {
    value: 'auto',
    label: '受控自动',
    description: '所有工具直接放行，不再弹确认；只剩拒止锚与 MCP / Provider 校验拦截。',
    confirmation: '此模式不再有任何逐次确认，除下层拦截（拒止锚、MCP 命令白名单、Provider URL 校验）外无额外保护。',
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

const rootRef = ref<HTMLElement | null>(null)

// 入场 + 展开面板 pop（面板 v-if 渲染，open 变化后 flush: post 再取 DOM）
useGsap((_ctx, contextSafe) => {
  const el = rootRef.value
  if (el) gsap.from(el, { opacity: 0, y: -6, duration: 0.3, ease: easeMap.out })

  watch(open, contextSafe((isOpen) => {
    if (!isOpen) return
    const panel = rootRef.value?.querySelector<HTMLElement>('.permission-panel')
    if (!panel) return
    gsap.fromTo(panel,
      { opacity: 0, scale: 0.96, y: -6, transformOrigin: 'top right' },
      { opacity: 1, scale: 1, y: 0, duration: durationMap.slow, ease: easeMap.smooth, clearProps: 'transform' })
  }), { flush: 'post' })
})
/**
 * 实际渲染的选项：按服务端给的档位顺序取文案，服务端认得但 UI 没有文案的档位
 * 会被丢弃（宁可少摆一个开关，也不摆一个标签是英文原始值的选项）。
 */
const visibleOptions = computed<PermissionOption[]>(() =>
  props.availableModes
    .map(mode => options.find(option => option.value === mode))
    .filter((option): option is PermissionOption => option !== undefined),
)

const currentOption = computed(() => optionFor(currentMode.value))

watch(visibleOptions, modes => {
  if (modes.length === 0) {
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
