<!-- web/src/components/ThemePicker.vue -->
<!-- 主题选择器 — 在设置弹窗内展示 12 个主题预览块 -->
<template>
  <div class="theme-picker">
    <div class="theme-picker-header">主题</div>
    <div class="theme-grid">
      <button
        v-for="t in THEMES"
        :key="t.id"
        class="theme-card"
        :class="{ active: storedTheme === t.id }"
        @click="setTheme(t.id)"
        :title="t.description"
      >
        <div class="theme-preview" :style="{ background: t.preview.bg }">
          <span class="theme-preview-accent" :style="{ background: t.preview.accent }"></span>
          <span class="theme-preview-text" :style="{ color: t.preview.text }">Aa</span>
        </div>
        <div class="theme-name">{{ t.name }}</div>
      </button>
    </div>
    <div class="font-toggle">
      <span class="font-toggle-label">衬线字体</span>
      <button
        class="font-toggle-btn"
        :class="{ on: serifFont }"
        @click="toggleSerif"
      >
        {{ serifFont ? '开' : '关' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { storedTheme, setTheme, THEMES } = useTheme()

const serifFont = ref(localStorage.getItem('maxma.fontSerif') !== 'off')

function toggleSerif() {
  serifFont.value = !serifFont.value
  localStorage.setItem('maxma.fontSerif', serifFont.value ? 'on' : 'off')
  document.body.classList.toggle('font-sans', !serifFont.value)
}
</script>

<style scoped>
.theme-picker {
  padding: 8px 0;
}
.theme-picker-header {
  font-size: 0.78rem;
  color: var(--text-tertiary);
  padding: 0 12px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 0 8px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.theme-card:hover {
  background: var(--overlay-subtle, rgba(0, 0, 0, 0.03));
}
.theme-card.active {
  border-color: var(--accent);
  background: var(--overlay-light, rgba(0, 0, 0, 0.05));
}
.theme-preview {
  width: 100%;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
.theme-preview-accent {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
.theme-preview-text {
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-serif);
}
.theme-name {
  font-size: 0.7rem;
  color: var(--text-secondary);
}
.theme-card.active .theme-name {
  color: var(--accent);
  font-weight: 500;
}
.font-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
  margin-top: 6px;
  border-top: 1px solid var(--border);
}
.font-toggle-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.font-toggle-btn {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.font-toggle-btn.on {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
</style>
