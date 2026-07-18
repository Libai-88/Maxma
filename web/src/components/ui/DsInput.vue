<template>
  <div class="ds-input-wrapper" :class="{ 'ds-input-wrapper--error': error }">
    <input
      class="ds-input"
      :class="{ 'ds-input--mono': mono, 'ds-input--error': error }"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :id="id"
      :name="name"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabelledby"
      :aria-invalid="error ? 'true' : undefined"
      :aria-errormessage="error ? `${id || 'ds-input'}-error` : undefined"
      @input="onInput"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    />
    <p
      v-if="error && (id || ariaLabel)"
      :id="`${id || 'ds-input'}-error`"
      class="ds-input__error"
      role="alert"
    >{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  modelValue?: string
  type?: string
  placeholder?: string
  mono?: boolean
  disabled?: boolean
  id?: string
  name?: string
  ariaLabel?: string
  ariaLabelledby?: string
  /** 验证错误信息。设置后输入框会显示红色边框并关联 aria-invalid/aria-errormessage */
  error?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const isComposing = ref(false)

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd(e: CompositionEvent) {
  isComposing.value = false
  // IME 合成结束后手动提交最终值
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onInput(e: Event) {
  // 合成期间不提交，避免 v-model 收到中间拼音
  if (isComposing.value) return
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<style scoped>
.ds-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ds-input {
  display: block;
  width: 100%;
  height: var(--ds-input-h, 36px);
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--fs-body);
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
.ds-input--error {
  border-color: var(--status-error);
  box-shadow: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--status-error) 20%, transparent);
}
.ds-input-wrapper--error .ds-input {
  border-color: var(--status-error);
  box-shadow: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--status-error) 20%, transparent);
}
.ds-input__error {
  margin: 0;
  font-size: 0.78em;
  color: var(--status-error);
  line-height: 1.4;
}
.ds-input--mono {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 0.92em;
}
.ds-input:focus {
  border-color: var(--accent);
  box-shadow: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
}
.ds-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ds-input::placeholder {
  color: var(--text-tertiary);
}
</style>
