<template>
  <button class="interactive-hover-btn" :class="[wide ? 'wide' : '', `tone--${tone}`]">
    <span class="ihb-bg" />
    <span class="ihb-content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  wide?: boolean
  tone?: 'default' | 'office' | 'tech' | 'daily'
}>(), {
  wide: false,
  tone: 'default',
})
</script>

<style scoped>
.interactive-hover-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 100px;
  background: transparent;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  overflow: hidden;
  transition: color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
  white-space: nowrap;
}

.interactive-hover-btn.wide {
  min-width: 14rem;
}

/* 背景滑动层 */
.ihb-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(
    120deg,
    color-mix(in srgb, var(--accent) 10%, transparent) 0%,
    color-mix(in srgb, var(--accent) 6%, transparent) 100%
  );
  transform: translateX(-100%) skewX(-15deg);
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}

.interactive-hover-btn:hover .ihb-bg {
  transform: translateX(0) skewX(-15deg);
}

/* 内容层 */
.ihb-content {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Hover 状态 */
.interactive-hover-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 15%, transparent);
}

/* 点击反馈 */
.interactive-hover-btn:active {
  transform: scale(0.97);
}

/* 过渡 */
@media (prefers-reduced-motion: no-preference) {
  .interactive-hover-btn {
    transition: color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, transform 0.1s ease;
  }
}

/* 色调变体 */
.tone--office {
  --ihb-hover-color: var(--accent);
}
.tone--tech {
  --ihb-hover-color: var(--status-ok, #22c55e);
}
.tone--daily {
  --ihb-hover-color: var(--text-secondary);
}

.tone--office,
.tone--tech,
.tone--daily {
  border-color: color-mix(in srgb, var(--ihb-hover-color) 24%, var(--border));
}

.tone--office:hover,
.tone--tech:hover,
.tone--daily:hover {
  border-color: var(--ihb-hover-color);
  color: var(--ihb-hover-color);
  box-shadow: 0 0 12px color-mix(in srgb, var(--ihb-hover-color) 15%, transparent);
}

.tone--office .ihb-bg {
  background: linear-gradient(120deg,
    color-mix(in srgb, var(--ihb-hover-color) 10%, transparent) 0%,
    color-mix(in srgb, var(--ihb-hover-color) 6%, transparent) 100%
  );
}
.tone--tech .ihb-bg,
.tone--daily .ihb-bg {
  background: linear-gradient(120deg,
    color-mix(in srgb, var(--ihb-hover-color) 10%, transparent) 0%,
    color-mix(in srgb, var(--ihb-hover-color) 6%, transparent) 100%
  );
}
</style>