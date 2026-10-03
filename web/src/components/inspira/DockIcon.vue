<template>
  <div
    class="dock-icon"
    :class="{ active, expanded }"
    ref="rootEl"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <Meteors
      v-if="active"
      :count="3"
      :size="0.8"
      :speed="1.2"
      :color="'var(--accent)'"
      class="dock-meteors"
    />
    <router-link
      v-if="to"
      :to="to"
      class="dock-link"
      :aria-label="busy ? `${label}，正在生成回复` : label"
      :title="label"
      :data-label="label"
    >
      <div class="icon-wrapper" ref="iconEl">
        <Icon :name="icon" :size="20" />
        <span v-if="busy" class="busy-dot" aria-hidden="true"></span>
      </div>
      <div class="dock-label" ref="labelEl">{{ label }}</div>
    </router-link>
    <button
      v-else
      type="button"
      class="dock-link"
      :aria-label="label"
      :title="label"
      :data-label="label"
        @click="$emit('click')"
    >
      <div class="icon-wrapper" ref="iconEl">
        <Icon :name="icon" :size="20" />
        <span v-if="busy" class="busy-dot" aria-hidden="true"></span>
      </div>
      <div class="dock-label" ref="labelEl">{{ label }}</div>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import Icon from '@/components/Icon.vue'
import { gsap, easeMap } from '@/composables/useGsap'
import Meteors from '@/components/inspira/Meteors.vue'

withDefaults(defineProps<{
  icon: string
  label: string
  to?: string
  active?: boolean
  expanded?: boolean
  busy?: boolean
}>(), {
  active: false,
  expanded: false,
  busy: false,
})

defineEmits<{
  (event: 'click'): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const iconEl = ref<HTMLElement | null>(null)
const labelEl = ref<HTMLElement | null>(null)

// ── macOS 风格的图标放大效果 ──
let hoverTween: gsap.core.Tween | null = null

function canAnimateHover(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches
}

function onEnter() {
  if (!iconEl.value) return
  if (!canAnimateHover()) return
  hoverTween?.kill()
  hoverTween = gsap.to(iconEl.value, {
    scale: 1.35,
    duration: 0.2,
    ease: easeMap.out,
    overwrite: 'auto',
  })
}

function onLeave() {
  if (!iconEl.value) return
  if (!canAnimateHover()) {
    hoverTween?.kill()
    hoverTween = null
    gsap.set(iconEl.value, { clearProps: 'transform' })
    return
  }
  hoverTween?.kill()
  hoverTween = gsap.to(iconEl.value, {
    scale: 1,
    duration: 0.2,
    ease: easeMap.out,
    overwrite: 'auto',
  })
}

onUnmounted(() => {
  hoverTween?.kill()
  hoverTween = null
})
</script>

<style scoped>
.dock-icon {
  position: relative;
  padding: 4px 5px;
}

.dock-icon.active {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
  border-top-left-radius: 50px;
  border-bottom-left-radius: 50px;
}

.dock-icon.active::before {
  content: "";
  position: absolute;
  top: -24px;
  right: 0;
  width: 24px;
  height: 24px;
  border-bottom-right-radius: 20px;
  box-shadow: 5px 5px 0 5px var(--bg-primary, #e4e9f5);
  background: transparent;
  pointer-events: none;
}

.dock-link::after {
  content: attr(data-label);
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  z-index: 20;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
  font: 600 12px/1.2 var(--font-body, sans-serif);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(-4px, -50%);
  transition: opacity var(--duration-fast, .15s) var(--ease-out), transform var(--duration-fast, .15s) var(--ease-out);
}

.dock-icon:hover .dock-link::after,
.dock-icon:focus-within .dock-link::after {
  opacity: 1;
  transform: translate(0, -50%);
}

.dock-icon.active::after {
  content: "";
  position: absolute;
  bottom: -24px;
  right: 0;
  width: 24px;
  height: 24px;
  border-top-right-radius: 20px;
  box-shadow: 5px -5px 0 5px var(--bg-primary, #e4e9f5);
  background: transparent;
  pointer-events: none;
}

.dock-link {
  position: relative;
  display: flex;
  align-items: center;
  white-space: nowrap;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-decoration: none;
  padding: 0;
}

.icon-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 36px;
  height: 52px;
  color: var(--accent, rgb(110, 90, 240));
  transition: color var(--duration-fast, .15s), background var(--duration-fast, .15s);
}

.busy-dot {
  position: absolute;
  top: -1px;
  right: -2px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--bg-card);
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  animation: dock-busy-pulse 1.2s ease-in-out infinite;
}

@keyframes dock-busy-pulse {
  0%, 100% { transform: scale(.82); opacity: .7; }
  50% { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .busy-dot { animation: none; }
}

.dock-label {
  position: relative;
  height: 52px;
  display: flex;
  align-items: center;
  font-size: 15px;
  color: var(--text-primary, #333);
  padding-left: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color var(--duration-fast, .15s), background var(--duration-fast, .15s);
  font-weight: 800;
  font-family: var(--font-display);
  overflow: hidden;
  white-space: nowrap;
  max-width: 0;
  opacity: 0;
}

/* ── Hover warm accent ── */
.dock-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 12px;
}

.dock-icon:hover .icon-wrapper,
.dock-icon:hover .dock-label {
  color: var(--status-warn);
}
</style>
