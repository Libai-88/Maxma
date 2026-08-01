<template>
  <span
    class="text-glitch"
    :class="{ hovering: enableOnHover }"
    :data-text="displayText"
    @mouseenter="onHover(true)"
    @mouseleave="onHover(false)"
  >
    <span class="glitch-char" aria-hidden="true">{{ displayText }}</span>
    <span v-if="enableShadows" class="glitch-shadow glitch-shadow--cyan" aria-hidden="true">{{ displayText }}</span>
    <span v-if="enableShadows" class="glitch-shadow glitch-shadow--magenta" aria-hidden="true">{{ displayText }}</span>
    <span class="glitch-main">{{ displayText }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  text?: string
  speed?: number
  enableShadows?: boolean
  enableOnHover?: boolean
}>(), {
  text: 'Maxma',
  speed: 1,
  enableShadows: true,
  enableOnHover: false,
})

const GLITCH_CHARS = '!@#$%^&*<>?/{}|~+=_0123456789ABCDEF'

const displayText = ref(props.text)
let intervalId: ReturnType<typeof setInterval> | null = null
let isHovering = false

function getGlitched(text: string): string {
  const chars = text.split('')
  const count = Math.max(1, Math.floor(chars.length * 0.3))
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * chars.length)
    if (chars[idx] !== ' ') {
      chars[idx] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
    }
  }
  return chars.join('')
}

function startGlitch() {
  stopGlitch()
  intervalId = setInterval(() => {
    if (props.enableOnHover && !isHovering) {
      displayText.value = props.text
      return
    }
    displayText.value = getGlitched(props.text)
  }, Math.max(50, 120 / props.speed))
}

function stopGlitch() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function onHover(hovering: boolean) {
  isHovering = hovering
  if (!hovering) {
    displayText.value = props.text
  }
}

watch(() => props.text, (val) => {
  displayText.value = val
})

watch(() => props.speed, () => {
  startGlitch()
})

startGlitch()

onUnmounted(() => {
  stopGlitch()
})
</script>

<style scoped>
.text-glitch {
  position: relative;
  display: inline-block;
}

.glitch-main {
  position: relative;
  z-index: 1;
}

/* 实际的文字用 aria-hidden 隐藏，让屏幕阅读器只读一次 */
.glitch-char {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
}

/* ── 故障阴影 ── */
.glitch-shadow {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

.glitch-shadow--cyan {
  color: #00ffff;
  animation: glitch-cyan 3s infinite linear;
}

.glitch-shadow--magenta {
  color: #ff00ff;
  animation: glitch-magenta 3s infinite linear;
}

/* 只在 hover 时才启用阴影动画（当 enableOnHover=true 时） */
.text-glitch.hovering .glitch-shadow {
  animation-play-state: paused;
}
.text-glitch.hovering:hover .glitch-shadow {
  animation-play-state: running;
}

@keyframes glitch-cyan {
  0%, 85%, 100% { opacity: 0; transform: translate(0); }
  86% { opacity: 0.6; transform: translate(-2px, 1px); }
  88% { opacity: 0.3; transform: translate(-3px, -1px); }
  90% { opacity: 0; transform: translate(0); }
  92% { opacity: 0.5; transform: translate(-1px, 2px); }
  94% { opacity: 0; transform: translate(0); }
}

@keyframes glitch-magenta {
  0%, 85%, 100% { opacity: 0; transform: translate(0); }
  86% { opacity: 0.6; transform: translate(2px, -1px); }
  88% { opacity: 0.3; transform: translate(3px, 1px); }
  90% { opacity: 0; transform: translate(0); }
  92% { opacity: 0.5; transform: translate(1px, -2px); }
  94% { opacity: 0; transform: translate(0); }
}
</style>