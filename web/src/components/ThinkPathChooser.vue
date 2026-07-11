<template>
  <section
    v-if="enabled && shouldOffer"
    class="think-path-chooser"
    aria-label="思考路径"
  >
    <div class="think-path-heading">
      <span>选择思考深度</span>
      <span class="think-path-note">仅影响本轮，可随时跳过</span>
    </div>
    <div class="think-path-options" role="radiogroup" aria-label="选择思考深度">
      <button
        v-for="path in options"
        :key="path.id"
        class="think-path-option"
        :class="{ selected: modelValue === path.id }"
        type="button"
        role="radio"
        :aria-checked="modelValue === path.id"
        :disabled="disabled"
        @click="select(path.id)"
      >
        <span class="option-main">
          <strong>{{ path.label }}</strong>
          <span>{{ path.description }}</span>
        </span>
        <span class="option-meta">{{ path.depth }} · {{ path.estimatedCost }}</span>
      </button>
    </div>
    <button
      v-if="modelValue"
      class="think-path-clear"
      type="button"
      :disabled="disabled"
      @click="clear"
    >
      本轮不指定路径
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { THINK_PATH_OPTIONS, shouldOfferThinkPaths, type ThinkPathId } from '@/utils/thinkPath'

const props = withDefaults(defineProps<{
  /** This is server-owned. False preserves the existing composer unchanged. */
  enabled?: boolean
  text?: string
  modelValue?: ThinkPathId | null
  disabled?: boolean
}>(), {
  enabled: false,
  text: '',
  modelValue: null,
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: ThinkPathId | null]
}>()

const options = THINK_PATH_OPTIONS
const shouldOffer = computed(() => shouldOfferThinkPaths(props.text))

function select(pathId: ThinkPathId) {
  emit('update:modelValue', pathId)
}

function clear() {
  emit('update:modelValue', null)
}
</script>

<style scoped>
.think-path-chooser {
  display: grid;
  gap: 6px;
  margin: 0 10px 8px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 11px;
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-card));
}
.think-path-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
  font-size: .82em;
  font-weight: 600;
}
.think-path-note { color: var(--text-tertiary); font-size: .9em; font-weight: 400; }
.think-path-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.think-path-option {
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 8px;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color .15s, background-color .15s, transform .15s;
}
.think-path-option:hover:not(:disabled), .think-path-option.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--bg-card));
}
.think-path-option:active:not(:disabled) { transform: scale(.98); }
.think-path-option:focus-visible, .think-path-clear:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.think-path-option:disabled, .think-path-clear:disabled { cursor: default; opacity: .55; }
.option-main { display: grid; gap: 2px; min-width: 0; font-size: .78em; line-height: 1.35; }
.option-main strong { color: var(--text-primary); font-size: 1.08em; }
.option-meta { color: var(--text-tertiary); font-size: .72em; }
.think-path-clear {
  justify-self: start;
  padding: 1px 0;
  color: var(--text-tertiary);
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: .76em;
}
.think-path-clear:hover:not(:disabled) { color: var(--text-primary); text-decoration: underline; }
@media (max-width: 560px) { .think-path-options { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .think-path-option { transition: none; } }
</style>
