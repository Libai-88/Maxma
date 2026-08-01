<template>
  <div class="animated-list" ref="rootEl">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  delay?: number
}>(), {
  delay: 1000,
})

const rootEl = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function build() {
  const el = rootEl.value
  if (!el) return
  const children = Array.from(el.children) as HTMLElement[]
  // 初始全部隐藏
  for (const child of children) {
    child.style.opacity = '0'
    child.style.transform = 'translateY(12px) scale(0.96)'
    child.style.transition = 'opacity 0.45s cubic-bezier(0.22,1,0.36,1), transform 0.45s cubic-bezier(0.22,1,0.36,1)'
  }
  // 逐个显示
  let idx = 0
  const show = () => {
    if (idx >= children.length) {
      if (timer) { clearInterval(timer); timer = null }
      return
    }
    const child = children[idx]
    child.style.opacity = '1'
    child.style.transform = 'translateY(0) scale(1)'
    idx++
  }
  show()
  timer = setInterval(show, props.delay)
}

onMounted(() => {
  requestAnimationFrame(() => build())
})

onUnmounted(() => {
  if (timer) { clearInterval(timer); timer = null }
})
</script>