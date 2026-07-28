<template>
  <span
    class="brand-seal"
    :class="[size, { clickable }]"
    :style="sealStyle"
    :aria-label="ariaLabel"
    role="img"
  >
    <span class="brand-seal__char">玛</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  accent?: string
  clickable?: boolean
}>(), {
  size: 'md',
})

const SIZES = { sm: 32, md: 52, lg: 80 }
const FONTS = { sm: 16, md: 26, lg: 40 }

const px = computed(() => SIZES[props.size])
const fontPx = computed(() => FONTS[props.size])

const sealStyle = computed(() => ({
  width: `${px.value}px`,
  height: `${px.value}px`,
  fontSize: `${fontPx.value}px`,
  backgroundColor: props.accent || 'var(--accent)',
  color: 'var(--text-inverse, #FFF)',
}))

const ariaLabel = computed(() => `Maxma 朱砂印「玛」${props.size === 'lg' ? '大版' : props.size === 'sm' ? '小版' : ''}`)
</script>

<style scoped>
.brand-seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-family: var(--font-serif);
  font-weight: 700;
  line-height: 1;
  flex-shrink: 0;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 25%, transparent),
              inset 0 1px 0 rgba(255,255,255,0.12);
  user-select: none;
}
.brand-seal.clickable {
  cursor: pointer;
  transition: transform var(--duration-instant) var(--ease-spring),
              box-shadow var(--duration-fast) var(--ease-out);
}
.brand-seal.clickable:hover {
  transform: scale(1.06);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 35%, transparent);
}
.brand-seal__char {
  letter-spacing: 0;
}
</style>
