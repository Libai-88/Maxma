<template>
  <div class="appearance-view">
    <div class="header">
      <h2>外观</h2>
    </div>

    <!-- 主题 -->
    <div class="section">
      <h3>主题</h3>
      <p class="section-desc">旗艦主题定义了 Maxma 的视觉风格基调，变体和保留主题提供更多选择。</p>

      <!-- 旗艦 -->
      <h4 class="theme-group-label">★ 旗艦</h4>
      <div class="theme-grid">
        <button
          v-for="t in flagshipThemes"
          :key="t.id"
          class="theme-card flagship"
          :class="{ active: storedTheme === t.id }"
          @click="setTheme(t.id)"
          :title="t.description"
        >
          <div class="theme-preview" :ref="(el) => setCssProp(el, 'background', t.preview.bg)">
            <span class="theme-preview-accent" :ref="(el) => setCssProp(el, 'background', t.preview.accent)"></span>
            <span class="theme-preview-text" :ref="(el) => setCssProp(el, 'color', t.preview.text)">Aa</span>
          </div>
          <div class="theme-name">{{ t.name }}</div>
        </button>
      </div>

      <!-- 变体 -->
      <h4 class="theme-group-label">◇ 氛围变体</h4>
      <div class="theme-grid">
        <button
          v-for="t in variantThemes"
          :key="t.id"
          class="theme-card"
          :class="{ active: storedTheme === t.id }"
          @click="setTheme(t.id)"
          :title="t.description"
        >
          <div class="theme-preview" :ref="(el) => setCssProp(el, 'background', t.preview.bg)">
            <span class="theme-preview-accent" :ref="(el) => setCssProp(el, 'background', t.preview.accent)"></span>
            <span class="theme-preview-text" :ref="(el) => setCssProp(el, 'color', t.preview.text)">Aa</span>
          </div>
          <div class="theme-name">{{ t.name }}</div>
        </button>
      </div>

      <!-- 保留 -->
      <details class="theme-legacy-group">
        <summary class="theme-group-label legacy">○ 经典保留（点击展开）</summary>
        <div class="theme-grid">
          <button
            v-for="t in legacyThemes"
            :key="t.id"
            class="theme-card legacy"
            :class="{ active: storedTheme === t.id }"
            @click="setTheme(t.id)"
            :title="t.description"
          >
            <div class="theme-preview" :ref="(el) => setCssProp(el, 'background', t.preview.bg)">
              <span class="theme-preview-accent" :ref="(el) => setCssProp(el, 'background', t.preview.accent)"></span>
              <span class="theme-preview-text" :ref="(el) => setCssProp(el, 'color', t.preview.text)">Aa</span>
            </div>
            <div class="theme-name">{{ t.name }}</div>
          </button>
        </div>
      </details>
    </div>

    <!-- 字体 -->
    <div class="section">
      <h3>字体</h3>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">衬线字体</div>
          <div class="toggle-desc">使用衬线字体渲染正文内容，关闭则使用无衬线字体。</div>
        </div>
        <button class="toggle-btn" :class="{ on: serifFont }" @click="toggleSerif">
          {{ serifFont ? '开' : '关' }}
        </button>
      </div>
    </div>

    <!-- 纹理 -->
    <div class="section">
      <h3>纹理</h3>
      <div class="toggle-row">
        <div class="toggle-info">
          <div class="toggle-label">纸质纹理</div>
          <div class="toggle-desc">在背景和卡片上叠加纸质纹理，营造纸张质感。关闭则使用纯色背景。</div>
        </div>
        <button class="toggle-btn" :class="{ on: paperTexture }" @click="togglePaperTexture">
          {{ paperTexture ? '开' : '关' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { usePaperTexture } from '@/composables/usePaperTexture'

const { storedTheme, setTheme, THEMES } = useTheme()

const flagshipThemes = computed(() => THEMES.filter(t => t.id !== 'auto' && t.group === 'flagship'))
const variantThemes = computed(() => THEMES.filter(t => t.group === 'variant'))
const legacyThemes = computed(() => THEMES.filter(t => t.group === 'legacy'))

// CSP-safe CSSOM helper: apply style property via setProperty (replaces :style binding)
function setCssProp(el: Element | ComponentPublicInstance | null, prop: string, value: string) {
  if (el instanceof HTMLElement) el.style.setProperty(prop, value)
}

const serifFont = ref(localStorage.getItem('maxma.fontSerif') !== 'off')

function toggleSerif() {
  serifFont.value = !serifFont.value
  localStorage.setItem('maxma.fontSerif', serifFont.value ? 'on' : 'off')
  document.body.classList.toggle('font-sans', !serifFont.value)
}

const { enabled: paperTexture, toggle: togglePaperTexture } = usePaperTexture()
</script>

<style scoped>
.appearance-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
.header {
  margin-bottom: 24px;
}
.header h2 {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--text-primary);
}
.section {
  margin-bottom: 32px;
}
.section h3 {
	  font-size: 1rem;
	  font-weight: 600;
	  color: var(--text-primary);
	  margin-bottom: 4px;
	}
	.section-desc {
	  font-size: 0.85rem;
	  color: var(--text-tertiary);
	  margin-bottom: 14px;
	}

/* 主题分组标签 */
.theme-group-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 18px 0 8px;
  letter-spacing: 0.3px;
}
.theme-group-label.legacy {
  cursor: pointer;
  color: var(--text-tertiary);
  font-weight: 500;
}
.theme-group-label.legacy:hover {
  color: var(--text-secondary);
}
.theme-legacy-group {
  margin-top: 10px;
}
.theme-legacy-group .theme-grid {
  margin-top: 8px;
}

/* 主题网格 */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              transform var(--duration-fast) var(--ease-out);
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
  height: 56px;
  border-radius: var(--radius-sm);
  display: flex;
  position: relative;
  overflow: hidden;
}
.theme-preview::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 32%;
  opacity: 0.4;
  background: var(--bg-secondary, rgba(0,0,0,.06));
  border-right: 1px solid var(--border, rgba(0,0,0,.08));
}
.theme-preview::after {
  content: '';
  position: absolute;
  right: 8px; bottom: 8px;
  width: 42%;
  height: 4px;
  border-radius: 2px;
  background: var(--text-secondary);
  opacity: 0.25;
  box-shadow: 0 8px 0 0 var(--text-secondary, currentColor),
              0 16px 0 0 var(--text-secondary, currentColor);
}
.theme-preview-accent {
  position: absolute;
  left: 8px; top: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  z-index: 1;
}
.theme-preview-text {
  display: none;
}
.theme-name {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.theme-card.active .theme-name {
  color: var(--accent);
  font-weight: 500;
}

/* 开关行 */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.toggle-row:last-child {
  border-bottom: none;
}
.toggle-info {
  flex: 1;
}
.toggle-label {
  font-size: 0.85rem;
  color: var(--text-primary);
  font-weight: 500;
}
.toggle-desc {
  font-size: 0.78rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.toggle-btn {
  flex-shrink: 0;
  padding: 4px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
  min-width: 48px;
}
.toggle-btn.on {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
</style>
