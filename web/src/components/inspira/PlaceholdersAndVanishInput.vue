<template>
  <div :class="cn('vanish-input', props.class)">
    <div class="vanish-input-wrapper">
      <div class="placeholder-wrapper" :style="placeholderStyle">
        <span class="placeholder-text">{{ currentPlaceholder }}</span>
      </div>
      <input
        ref="inputRef"
        :value="modelValue"
        @input="onInput"
        @keydown.enter.prevent="onSubmit"
        class="vanish-input-field"
      />
      <div v-if="vanishing" ref="vanishOverlayRef" class="vanish-overlay" :style="vanishStyle">
        {{ modelValue }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { cn } from '@/lib/utils'
import { gsap, easeMap } from '@/composables/useGsap'

interface Props {
  modelValue: string
  placeholders?: string[]
  placeholderDuration?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  placeholders: () => ['Ask me anything...'],
  placeholderDuration: 3000,
  class: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const vanishOverlayRef = ref<HTMLDivElement | null>(null)
const currentPlaceholderIndex = ref(0)
const placeholderPhase = ref<'visible' | 'exiting' | 'entering'>('visible')
const vanishing = ref(false)
const vanishStyle = ref<Record<string, string>>({})
let placeholderTimer: number | null = null

const currentPlaceholder = computed(() => {
  return props.placeholders[currentPlaceholderIndex.value] || ''
})

const placeholderStyle = computed(() => {
  const base = {
    transition: 'opacity 0.3s ease, transform 0.3s ease',
  }
  if (placeholderPhase.value === 'visible') {
    return { ...base, opacity: 1, transform: 'translateY(0)' }
  }
  if (placeholderPhase.value === 'exiting') {
    return { ...base, opacity: 0, transform: 'translateY(-10px)' }
  }
  return { ...base, opacity: 0, transform: 'translateY(10px)' }
})

function cyclePlaceholder() {
  if (props.placeholders.length < 2) return
  placeholderPhase.value = 'exiting'
  setTimeout(() => {
    const nextIndex = (currentPlaceholderIndex.value + 1) % props.placeholders.length
    currentPlaceholderIndex.value = nextIndex
    placeholderPhase.value = 'entering'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        placeholderPhase.value = 'visible'
      })
    })
  }, 300)
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
}

function onSubmit() {
  if (!props.modelValue.trim()) return
  vanishing.value = true
  nextTick(() => {
    if (vanishOverlayRef.value) {
      gsap.fromTo(
        vanishOverlayRef.value,
        { opacity: 1, scale: 1, y: 0 },
        {
          opacity: 0,
          scale: 1.1,
          y: -20,
          duration: 0.3,
          ease: easeMap.standard,
          onComplete: () => {
            vanishing.value = false
            emit('submit')
          },
        },
      )
    }
  })
}

onMounted(() => {
  if (props.placeholders.length > 1) {
    placeholderTimer = window.setInterval(cyclePlaceholder, props.placeholderDuration)
  }
})

onUnmounted(() => {
  if (placeholderTimer !== null) {
    clearInterval(placeholderTimer)
  }
})
</script>

<style scoped>
.vanish-input {
  position: relative;
  width: 100%;
}

.vanish-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.placeholder-wrapper {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
  max-width: calc(100% - 2rem);
}

.placeholder-text {
  color: var(--text-tertiary);
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.vanish-input-field {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 0.75rem 1rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  color: var(--text-primary);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.2s ease;
  caret-color: var(--accent);
}

.vanish-input-field:focus {
  border-color: var(--accent);
}

.vanish-input-field::placeholder {
  color: transparent;
}

.vanish-overlay {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  z-index: 3;
  color: var(--text-primary);
  font-size: 0.875rem;
  white-space: nowrap;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .placeholder-wrapper {
    transition: none !important;
  }

  .vanish-overlay {
    transition: none !important;
  }
}
</style>