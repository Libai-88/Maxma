<template>
  <div class="bg-glow" aria-hidden="true">
    <span class="bg-glow__blob bg-glow__blob--1"></span>
    <span class="bg-glow__blob bg-glow__blob--2"></span>
    <span class="bg-glow__blob bg-glow__blob--3"></span>
  </div>
</template>

<script setup lang="ts">
// 常驻背景氛围：3 个 accent 光斑缓慢漂移，任何页面打开即有可见动画
</script>

<style scoped>
.bg-glow {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}
.bg-glow__blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  will-change: transform;
}
.bg-glow__blob--1 {
  width: 520px;
  height: 520px;
  left: -140px;
  top: -120px;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  animation: bg-glow-drift-1 26s ease-in-out infinite alternate;
}
.bg-glow__blob--2 {
  width: 460px;
  height: 460px;
  right: -120px;
  bottom: -100px;
  background: color-mix(in srgb, var(--accent-pink, var(--accent)) 6%, transparent);
  animation: bg-glow-drift-2 34s ease-in-out infinite alternate;
}
.bg-glow__blob--3 {
  width: 380px;
  height: 380px;
  left: 42%;
  top: 55%;
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  animation: bg-glow-drift-3 42s ease-in-out infinite alternate;
}
@keyframes bg-glow-drift-1 {
  0%   { transform: translate(0, 0) scale(1); }
  100% { transform: translate(70px, 40px) scale(1.12); }
}
@keyframes bg-glow-drift-2 {
  0%   { transform: translate(0, 0) scale(1.05); }
  100% { transform: translate(-60px, -50px) scale(0.95); }
}
@keyframes bg-glow-drift-3 {
  0%   { transform: translate(0, 0) scale(0.95); }
  100% { transform: translate(40px, -60px) scale(1.1); }
}
</style>
