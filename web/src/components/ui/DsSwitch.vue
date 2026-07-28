<template>
  <label class="ds-switch" :class="{ 'is-disabled': disabled }">
    <span v-if="label" class="ds-switch__label">{{ label }}</span>
    <button
      type="button"
      role="switch"
      class="ds-switch__track"
      :class="{ 'is-on': modelValue }"
      :aria-checked="modelValue"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="ds-switch__thumb" />
    </button>
  </label>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean
  label?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
function toggle() { emit('update:modelValue', !props.modelValue) }
</script>

<style scoped>
.ds-switch { display: inline-flex; align-items: center; gap: var(--space-8); cursor: pointer; }
.ds-switch.is-disabled { opacity: 0.5; cursor: not-allowed; }
.ds-switch__label { font-size: var(--fs-body); color: var(--text-primary); user-select: none; }
.ds-switch__track {
  position: relative; width: 40px; height: 22px; border-radius: 11px;
  border: 1px solid var(--border); background: var(--bg-primary);
  cursor: pointer; transition: background var(--duration-fast) var(--ease-out),
  border-color var(--duration-fast) var(--ease-out); padding: 0; outline: none;
}
.ds-switch__track:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ds-switch__track.is-on { background: var(--accent); border-color: var(--accent); }
.ds-switch__track:disabled { opacity: 0.5; cursor: not-allowed; }
.ds-switch__thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform var(--duration-fast) var(--ease-out);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.ds-switch__track.is-on .ds-switch__thumb { transform: translateX(18px); }
</style>
