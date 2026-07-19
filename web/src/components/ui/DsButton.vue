<template>
  <button
    class="ds-btn"
    :class="[
      `ds-btn--${variant}`,
      { 'ds-btn--sm': size === 'sm', 'ds-btn--icon-only': iconOnly, 'ds-btn--loading': loading },
    ]"
    :type="type"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading ? 'true' : undefined"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="onClick"
  >
    <span v-if="loading" class="ds-btn__spinner" aria-hidden="true"></span>
    <span v-if="loading && hideLabelWhenLoading" class="ds-btn__label-hidden" aria-hidden="true">
      <slot />
    </span>
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
import { watchEffect } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'subtle' | 'success'
  size?: 'sm' | 'md'
  disabled?: boolean
  loading?: boolean
  iconOnly?: boolean
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
  /** loading 时是否隐藏默认 slot 文本（避免 spinner + 文本并存的布局抖动） */
  hideLabelWhenLoading?: boolean
}>(), {
  variant: 'default',
  size: 'md',
  disabled: false,
  loading: false,
  iconOnly: false,
  type: 'button',
  hideLabelWhenLoading: true,
})

const emit = defineEmits<{ click: [e: MouseEvent] }>()

function onClick(e: MouseEvent) {
  if (props.disabled || props.loading) return
  emit('click', e)
}

// 仅用于在 dev 模式下提醒：iconOnly 必须配 ariaLabel
// 生产构建中不会执行此 warn
watchEffect(() => {
  if (props.iconOnly && !props.ariaLabel) {
    // eslint-disable-next-line no-console
    console.warn('[DsButton] iconOnly 模式必须提供 ariaLabel')
  }
})
</script>

<style scoped>
/* 新增 variant 与状态样式。default/primary/danger 由全局 design-system.css 提供，
   此处仅补充 ghost/subtle/success/icon-only/loading/spinner/focus-visible 兜底。 */

.ds-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}
.ds-btn--ghost:hover:not(:disabled) {
	  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
	  border-color: transparent;
	  color: var(--text-primary);
	}

.ds-btn--subtle {
  background: var(--bg-secondary);
  border-color: transparent;
  color: var(--text-primary);
}
.ds-btn--subtle:hover:not(:disabled) {
	  background: color-mix(in srgb, var(--text-primary) 10%, transparent);
	}

.ds-btn--success {
  background: var(--status-success, #16a34a);
  color: #fff;
  border-color: var(--status-success, #16a34a);
}
.ds-btn--success:hover:not(:disabled) {
  opacity: 0.9;
}

.ds-btn--icon-only {
  padding: 0;
  width: 32px;
  height: 32px;
  gap: 0;
}
.ds-btn--icon-only.ds-btn--sm {
  width: 28px;
  height: 28px;
}

/* 兜底 focus-visible（design-system.css 已有，此处避免局部使用 DsButton 时丢失） */
.ds-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* loading spinner */
.ds-btn--loading {
  cursor: progress;
  position: relative;
}
.ds-btn__spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ds-btn-spin 0.6s linear infinite;
  flex-shrink: 0;
}
.ds-btn__label-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@keyframes ds-btn-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ds-btn__spinner {
    animation-duration: 1.5s;
  }
}
</style>
