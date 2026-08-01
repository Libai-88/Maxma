<template>
  <div class="gradient-glow">
    <!-- 泛光模糊层 -->
    <div
      class="gg-glow"
      :style="{
        borderRadius: `${props.borderRadius + props.borderWidth + 3}px`,
        filter: `blur(${props.blur}px)`,
        animationDuration: `${props.duration}s`,
        inset: `-${props.borderWidth + 3}px`,
      }"
    />
    <!-- 渐变边框层（padding 撑出边框宽度） -->
    <div
      class="gg-border"
      :style="{
        borderRadius: `${props.borderRadius + props.borderWidth}px`,
        padding: `${props.borderWidth}px`,
        animationDuration: `${props.duration}s`,
      }"
    >
      <!-- 内容层（覆盖中心渐变） -->
      <div
        class="gg-content"
        :style="{
          borderRadius: `${props.borderRadius}px`,
          background: props.bgColor,
        }"
      >
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  duration?: number
  borderWidth?: number
  borderRadius?: number
  blur?: number
  bgColor?: string
}>(), {
  duration: 3,
  borderWidth: 1.5,
  borderRadius: 12,
  blur: 4,
  bgColor: 'transparent',
})
</script>

<style scoped>
.gradient-glow {
  position: relative;
  overflow: visible;
}

/* 泛光层：在边框背后扩散模糊 */
.gg-glow {
  position: absolute;
  z-index: 0;
  background: conic-gradient(
    from var(--gg-angle, 0deg),
    var(--accent) 0%,
    transparent 25%,
    transparent 50%,
    color-mix(in srgb, var(--accent) 50%, transparent) 65%,
    transparent 80%,
    var(--accent) 100%
  );
  animation: gg-spin var(--duration, 3s) linear infinite;
  pointer-events: none;
  opacity: 0.5;
}

/* 渐变边框层：padding 区域显示渐变，content 区域被 gg-content 遮盖 */
.gg-border {
  position: relative;
  z-index: 1;
  background: conic-gradient(
    from var(--gg-angle, 0deg),
    var(--accent) 0%,
    transparent 20%,
    transparent 40%,
    color-mix(in srgb, var(--accent) 70%, transparent) 50%,
    transparent 60%,
    transparent 80%,
    var(--accent) 100%
  );
  animation: gg-spin var(--duration, 3s) linear infinite;
}

/* 内容层：覆盖渐变中心，只留边框可见 */
.gg-content {
  overflow: hidden;
}

@keyframes gg-spin {
  0% { --gg-angle: 0deg; }
  100% { --gg-angle: 360deg; }
}

@property --gg-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
</style>