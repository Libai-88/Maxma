<template>
  <div ref="rootEl" class="model-settings">
    <div class="settings-header">模型参数</div>
    <div class="setting-row">
      <label class="setting-label">Temperature</label>
      <div class="setting-control">
        <!-- TEMP-END2END-001：温度已端到端接线（前端 → chat.py → sidecar
             → OMP settings.temperature），控件不再禁用 -->
        <input type="range" min="0" max="2" step="0.1" :value="store.temperature" @input="store.setTemperature(Number(($event.target as HTMLInputElement).value))" class="setting-slider" />
        <span class="setting-value">{{ store.temperature.toFixed(1) }}</span>
      </div>
    </div>
    <p class="setting-note">Temperature：0 确定性 · 1 创造性 · 2 自由发挥。</p>
    <div class="setting-row">
      <label class="setting-label">Max Tokens</label>
      <div class="setting-control">
        <input type="range" min="256" max="65536" step="256" :value="store.maxTokens" @input="store.setMaxTokens(Number(($event.target as HTMLInputElement).value))" class="setting-slider" />
        <span class="setting-value">{{ formatNum(store.maxTokens) }}</span>
      </div>
    </div>
    <!-- THINKING-LEVELS-001：思考强度从开关升级为多级（OMP 支持
         off/minimal/low/medium/high/xhigh/max）——简单问题用 low 省 token，
         复杂任务用 xhigh 深推理 -->
    <div class="setting-row">
      <label class="setting-label">思考强度</label>
      <div class="setting-control">
        <select
          class="thinking-select"
          :value="store.thinkingLevel"
          @change="store.setThinkingLevel(($event.target as HTMLSelectElement).value)"
          :aria-label="'思考强度'"
        >
          <option value="off">关闭</option>
          <option value="minimal">极简</option>
          <option value="low">轻度</option>
          <option value="medium">适中</option>
          <option value="high">深度</option>
          <option value="xhigh">极深</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import { gsap, useGsap } from '@/composables/useGsap'
import { watch } from 'vue'
import { ref } from 'vue'

const store = useChatStore()
function formatNum(n: number): string { return n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n) }

// Thinking 强度切换：选择框弹性弹跳
const rootEl = ref<HTMLElement | null>(null)
useGsap((_ctx, contextSafe) => {
  watch(() => store.thinkingLevel, contextSafe(() => {
    const sel = rootEl.value?.querySelector<HTMLElement>('.thinking-select')
    if (!sel) return
    gsap.fromTo(sel,
      { scale: 0.94 },
      { scale: 1.04, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.out', overwrite: 'auto',
        onComplete: () => gsap.set(sel, { clearProps: 'transform' }) })
  }))
})
</script>

<style scoped>
.model-settings { padding: 12px; }
.settings-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 12px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 12px; }
.setting-row + .setting-row { border-top: 1px solid var(--border); }
.setting-label { font-size: 13px; color: var(--text-primary); min-width: 90px; }
.setting-control { display: flex; align-items: center; gap: 8px; }
.setting-slider { width: 120px; height: 4px; appearance: none; background: var(--border); border-radius: 2px; outline: none; cursor: pointer; }
.setting-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; background: var(--accent); border-radius: 50%; cursor: pointer; }
/* 修复 FOCUS-001：滑块键盘焦点可见（此前 outline:none 且无任何焦点样式） */
.setting-slider:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.setting-note { font-size: 11px; color: var(--text-tertiary); line-height: 1.5; padding-top: 4px; }
.setting-value { min-width: 40px; text-align: right; font-size: 12px; font-family: 'SF Mono', monospace; color: var(--text-primary); }
.thinking-select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
}
.thinking-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
