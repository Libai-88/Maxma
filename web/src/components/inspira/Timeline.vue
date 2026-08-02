<template>
  <div :class="cn('timeline', props.class)" ref="timelineRef">
    <div class="timeline-track"></div>
    <div
      v-for="(item, index) in props.items"
      :key="index"
      class="timeline-item"
      :ref="el => { if (el) itemRefs[index] = el as HTMLElement }"
    >
      <div class="timeline-dot">
        <div class="timeline-dot-inner"></div>
      </div>
      <div class="timeline-content">
        <div v-if="item.date" class="timeline-date">{{ item.date }}</div>
        <h4 class="timeline-title">{{ item.title }}</h4>
        <p class="timeline-desc">{{ item.description }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { gsap, easeMap } from '@/composables/useGsap'
import { cn } from '@/lib/utils'

interface TimelineItem {
  title: string
  description: string
  date?: string
  icon?: string
}

interface TimelineProps {
  items: TimelineItem[]
  class?: string
}

const props = withDefaults(defineProps<TimelineProps>(), {
  items: () => [],
  class: '',
})

const timelineRef = ref<HTMLElement | null>(null)
const itemRefs = ref<HTMLElement[]>([])

onMounted(async () => {
  await nextTick()

  const items = itemRefs.value.filter(Boolean)
  if (!items.length) return

  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (mq.matches) {
    gsap.set(items, { opacity: 1, y: 0 })
    return
  }

  gsap.from(items, {
    opacity: 0,
    y: 20,
    duration: 0.5,
    stagger: 0.1,
    ease: easeMap.out,
  })
})
</script>

<style scoped>
.timeline {
  position: relative;
  padding: var(--space-16, 1rem) 0;
}

.timeline-track {
  position: absolute;
  left: 11px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border);
  border-radius: 1px;
}

.timeline-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-16, 1rem);
  padding-bottom: var(--space-24, 1.5rem);
}

.timeline-item:last-child {
  padding-bottom: 0;
}

.timeline-dot {
  position: relative;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.timeline-dot-inner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-card, var(--bg-primary));
  box-shadow: 0 0 0 2px var(--accent);
  transition: background var(--duration-fast, 0.15s) var(--ease-out, ease-out),
              transform var(--duration-instant, 0.1s) var(--ease-spring, ease-out);
}

.timeline-item:hover .timeline-dot-inner {
  transform: scale(1.3);
  background: var(--accent-hover, var(--accent));
}

.timeline-content {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}

.timeline-date {
  font-size: var(--fs-hint, 0.78rem);
  color: var(--text-tertiary);
  margin-bottom: var(--space-4, 0.25rem);
  font-family: var(--font-mono, monospace);
  letter-spacing: 0.02em;
}

.timeline-title {
  font-size: var(--fs-display-sm, 1.05rem);
  font-family: var(--font-display, var(--font-serif));
  color: var(--text-primary);
  font-weight: 600;
  margin: 0 0 var(--space-4, 0.25rem);
  line-height: 1.4;
}

.timeline-desc {
  font-size: var(--fs-body, 0.95rem);
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
  font-family: var(--font-body, var(--font-ui));
}

@media (prefers-reduced-motion: reduce) {
  .timeline-dot-inner {
    transition: none;
  }

  .timeline-item:hover .timeline-dot-inner {
    transform: none;
  }
}
</style>