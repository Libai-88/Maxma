<!-- web/src/components/LeavesOverlay.vue -->
<template>
  <div
    v-if="enabled"
    class="leaves-overlay"
    :style="overlayStyle"
    aria-hidden="true"
  >
    <div class="leaves-layer leaves-layer--1"></div>
    <div class="leaves-layer leaves-layer--2"></div>
    <div class="leaves-layer leaves-layer--3"></div>
    <div class="leaves-compensation" :style="compensationStyle"></div>
    <button
      type="button"
      class="leaves-toggle"
      :title="enabled ? '点击关闭树阴光影' : '点击开启树阴光影'"
      aria-label="切换树阴光影"
      @click.stop="onToggle"
    >
      <span class="leaves-toggle-icon">🍂</span>
    </button>
  </div>
  <button
    v-else
    type="button"
    class="leaves-toggle leaves-toggle--off"
    title="点击开启树阴光影"
    aria-label="开启树阴光影"
    @click.stop="onToggle"
  >
    <span class="leaves-toggle-icon">🍂</span>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'

const STORAGE_KEY = 'maxma.leaves_overlay'
const enabled = ref(true)

const { isDark } = useTheme()

const overlayStyle = computed(() => ({
  mixBlendMode: isDark.value ? 'screen' as const : 'multiply' as const,
  opacity: isDark.value ? 0.12 : 0.28,
}))

const compensationStyle = computed(() => ({
  background: isDark.value ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 253, 247, 0.12)',
}))

onMounted(() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) enabled.value = saved === 'true'
  } catch { /* noop */ }
})

function onToggle() {
  enabled.value = !enabled.value
  try { localStorage.setItem(STORAGE_KEY, String(enabled.value)) } catch { /* noop */ }
}
</script>

<style scoped>
.leaves-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.leaves-layer {
  position: absolute;
  inset: -20%;
  background-repeat: no-repeat;
  background-size: 50% 50%;
  will-change: transform;
}

/* 第一层：大叶片光斑，缓慢漂移 */
.leaves-layer--1 {
  background-image:
    radial-gradient(ellipse 40% 30% at 20% 30%, rgba(80, 120, 70, 0.4) 0%, transparent 70%),
    radial-gradient(ellipse 35% 25% at 70% 60%, rgba(60, 100, 50, 0.35) 0%, transparent 70%),
    radial-gradient(ellipse 30% 20% at 50% 80%, rgba(70, 110, 60, 0.3) 0%, transparent 70%);
  filter: blur(8px);
  animation: leaves-drift-1 25s ease-in-out infinite alternate;
}

/* 第二层：中等光斑，不同速度漂移 */
.leaves-layer--2 {
  background-image:
    radial-gradient(ellipse 25% 20% at 80% 20%, rgba(90, 130, 75, 0.3) 0%, transparent 65%),
    radial-gradient(ellipse 20% 15% at 30% 70%, rgba(75, 115, 65, 0.25) 0%, transparent 65%),
    radial-gradient(ellipse 18% 12% at 60% 40%, rgba(85, 125, 70, 0.2) 0%, transparent 65%);
  filter: blur(6px);
  animation: leaves-drift-2 20s ease-in-out infinite alternate;
}

/* 第三层：小光斑，快速闪烁模拟风动 */
.leaves-layer--3 {
  background-image:
    radial-gradient(ellipse 15% 10% at 40% 50%, rgba(100, 140, 80, 0.25) 0%, transparent 60%),
    radial-gradient(ellipse 12% 8% at 75% 35%, rgba(80, 120, 65, 0.2) 0%, transparent 60%);
  filter: blur(4px);
  animation: leaves-drift-3 15s ease-in-out infinite alternate;
}

/* 亮度补偿层：在 multiply 混合下提亮画面 */
.leaves-compensation {
  position: absolute;
  inset: 0;
  background: rgba(255, 253, 247, 0.12);
  mix-blend-mode: normal;
  pointer-events: none;
}

/* 角落 toggle 按钮：唯一接收 pointer events 的元素 */
.leaves-toggle {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 10;
  pointer-events: auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  background: var(--bg-card, rgba(255, 255, 255, 0.7));
  color: var(--text-secondary, #666);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  opacity: 0.45;
  transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  backdrop-filter: blur(4px);
}

.leaves-toggle:hover {
  opacity: 1;
  border-color: var(--accent, #4a90e2);
}

.leaves-toggle--off {
  opacity: 0.35;
}

.leaves-toggle-icon {
  pointer-events: none;
  user-select: none;
}

@keyframes leaves-drift-1 {
  0% { transform: translate(0, 0) rotate(0deg); }
  100% { transform: translate(3%, 2%) rotate(2deg); }
}
@keyframes leaves-drift-2 {
  0% { transform: translate(0, 0) rotate(0deg); }
  100% { transform: translate(-2%, 3%) rotate(-1.5deg); }
}
@keyframes leaves-drift-3 {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(1%, -1%) scale(1.05); }
  100% { transform: translate(-1%, 1%) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .leaves-layer { animation: none; }
}
</style>
