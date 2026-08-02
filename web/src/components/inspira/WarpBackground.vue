<template>
  <div class="warp-wrapper" :class="wrapperClass">
    <div class="warp-bg-layer" aria-hidden="true" />
    <div class="warp-content">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  wrapperClass?: string
}>()
</script>

<style scoped>
.warp-wrapper {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
}

/* ── 背景扭曲层 ── */
.warp-bg-layer {
  position: absolute;
  inset: -50%;
  z-index: 0;
  pointer-events: none;

  background:
    radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
    conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg,
      rgba(255, 255, 255, 0.03) 60deg,
      transparent 120deg,
      rgba(255, 255, 255, 0.02) 180deg,
      transparent 240deg,
      rgba(255, 255, 255, 0.03) 300deg,
      transparent 360deg
    );

  will-change: transform, filter;
  transition:
    transform 0.8s cubic-bezier(0.23, 1, 0.32, 1),
    filter 0.8s cubic-bezier(0.23, 1, 0.32, 1);
}

.warp-wrapper:hover .warp-bg-layer {
  transform:
    scale(1.2)
    rotate(8deg)
    translate(4%, 2%);
  filter: blur(1px);
}

/* ── 内容层 ── */
.warp-content {
  position: relative;
  z-index: 1;
}

/* ── 无障碍：减少动效 ── */
@media (prefers-reduced-motion: reduce) {
  .warp-bg-layer {
    transition: none;
  }
  .warp-wrapper:hover .warp-bg-layer {
    transform: none;
    filter: none;
  }
}
</style>