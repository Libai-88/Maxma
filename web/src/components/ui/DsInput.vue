<template>
  <input
    class="ds-input"
    :class="{ 'ds-input--mono': mono }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>

<script setup lang="ts">
defineProps<{
  modelValue?: string
  type?: string
  placeholder?: string
  mono?: boolean
  disabled?: boolean
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
