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
      :aria-label="label"
      :title="label"
    >
      <div class="icon-wrapper" ref="iconEl">
        <Icon :name="icon" :size="20" />
      </div>
      <div class="dock-label" ref="labelEl">{{ label }}</div>
    </router-link>
    <button
      v-else
      type="button"
      class="dock-link"
      :aria-label="label"
      :title="label"
      @click="$emit('click')"
    >
      <div class="icon-wrapper" ref="iconEl">
        <Icon :name="icon" :size="20" />
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
}>(), {
  active: false,
  expanded: false,
})

defineEmits<{
  (event: 'click'): void
}>()

const rootEl = ref<HTMLElement | null>(null)
const iconEl = ref<HTMLElement | null>(null)
const labelEl = ref<HTMLElement | null>(null)

// ── macOS 风格的图标放大效果 ──
let hoverTween: gsap.core.Tween | null = null

function onEnter() {
  if (!iconEl.value) return
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
  background: var(--bg-primary, #e4e9f5);
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
  transition: color 0.5s;
  will-change: transform;
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
  transition: color 0.5s;
  font-weight: 800;
  font-family: var(--font-display);
  overflow: hidden;
  white-space: nowrap;
  max-width: 0;
  opacity: 0;
}

/* ── Hover warm accent ── */
.dock-icon:hover .icon-wrapper,
.dock-icon:hover .dock-label {
  color: #ffa117;
}
</style>