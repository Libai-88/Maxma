<template>
  <button
    :class="['shimmer-btn', props.class]"
    :style="{ '--shimmer-size': shimmerSize }"
  >
    <span class="shimmer-btn-content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
interface ShimmerButtonProps {
  /** Additional CSS classes to merge onto the root button element */
  class?: string
  /** Controls the spread/glow extent of the shimmer overlay */
  shimmerSize?: string
}

const props = withDefaults(defineProps<ShimmerButtonProps>(), {
  shimmerSize: '2px',
})
</script>

<style scoped>
.shimmer-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  padding: 12px 24px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--text-inverse);
  font-size: var(--fs-body);
  font-family: var(--font-body);
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
  user-select: none;
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.shimmer-btn:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

/* ── Shimmer 流光伪元素 ── */
.shimmer-btn::after {
  content: '';
  position: absolute;
  inset: calc(var(--shimmer-size) * -1);
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgba(255, 255, 255, 0.12) 45%,
    rgba(255, 255, 255, 0.28) 50%,
    rgba(255, 255, 255, 0.12) 55%,
    transparent 60%
  );
  background-size: 200% 100%;
  background-position: 200% 0;
  animation: shimmer-flow 3s ease-in-out infinite;
  pointer-events: none;
  z-index: 1;
  border-radius: inherit;
}

/* 内容层叠在流光之上 */
.shimmer-btn-content {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}

@keyframes shimmer-flow {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── 磁吸交互：GSAP quickTo 接管 transform，CSS 放弃 transform 过渡 ── */
.shimmer-btn.magnetic {
  transition-property: background, color, border-color, box-shadow;
}

/* ── 悬停阴影 & 点击缩放 ── */
@media (prefers-reduced-motion: no-preference) {
  .shimmer-btn:hover {
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .shimmer-btn:active {
    transform: scale(0.98);
  }
}

/* ── 无障碍：关闭动画 ── */
@media (prefers-reduced-motion: reduce) {
  .shimmer-btn::after {
    animation: none;
    opacity: 0;
  }
}

/* ── 窄屏适配 ── */
@media (max-width: 480px) {
  .shimmer-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>