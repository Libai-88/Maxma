<template>
  <div :class="cn('halo-search', props.class)">
    <div class="halo-rings">
      <div class="halo-ring halo-ring--outer"></div>
      <div class="halo-ring halo-ring--inner"></div>
    </div>
    <input
      ref="inputRef"
      :value="modelValue"
      @input="onInput"
      :placeholder="placeholder"
      class="halo-input"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  modelValue: string
  placeholder?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search...',
  class: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}
</script>

<style scoped>
.halo-search {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 320px;
}

.halo-rings {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.halo-ring {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  transition: opacity 0.3s ease, filter 0.3s ease;
}

.halo-ring--outer {
  width: 120%;
  height: 120%;
  top: -10%;
  left: -10%;
  background: conic-gradient(from 0deg, transparent, var(--accent), transparent 60%);
  animation: halo-rotate 4s linear infinite;
  mask: radial-gradient(circle at center, transparent 60%, black 61%);
  -webkit-mask: radial-gradient(circle at center, transparent 60%, black 61%);
  opacity: 0.4;
}

.halo-ring--inner {
  width: 110%;
  height: 110%;
  top: -5%;
  left: -5%;
  background: conic-gradient(from 180deg, transparent, var(--accent), transparent 60%);
  animation: halo-rotate 3s linear infinite reverse;
  mask: radial-gradient(circle at center, transparent 65%, black 66%);
  -webkit-mask: radial-gradient(circle at center, transparent 65%, black 66%);
  opacity: 0.25;
}

.halo-input {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 0.75rem 1.25rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 9999px;
  color: inherit;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.halo-input::placeholder {
  color: var(--border);
}

.halo-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 30%, transparent);
}

.halo-search:focus-within .halo-ring--outer {
  opacity: 0.8;
  filter: brightness(1.4);
}

.halo-search:focus-within .halo-ring--inner {
  opacity: 0.6;
  filter: brightness(1.3);
}

@keyframes halo-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .halo-ring {
    animation: none;
    opacity: 0.3;
  }

  .halo-search:focus-within .halo-ring {
    opacity: 0.5;
  }
}
</style>