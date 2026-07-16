<template>
  <div class="model-settings">
    <div class="settings-header">模型参数</div>
    <div class="setting-row">
      <label class="setting-label">Temperature</label>
      <div class="setting-control">
        <input type="range" min="0" max="2" step="0.1" :value="store.temperature" @input="store.setTemperature(Number(($event.target as HTMLInputElement).value))" class="setting-slider" />
        <span class="setting-value">{{ store.temperature.toFixed(1) }}</span>
      </div>
    </div>
    <div class="setting-row">
      <label class="setting-label">Max Tokens</label>
      <div class="setting-control">
        <input type="range" min="256" max="128000" step="256" :value="store.maxTokens" @input="store.setMaxTokens(Number(($event.target as HTMLInputElement).value))" class="setting-slider" />
        <span class="setting-value">{{ formatNum(store.maxTokens) }}</span>
      </div>
    </div>
    <div class="setting-row">
      <label class="setting-label">Thinking</label>
      <div class="setting-control">
        <button class="toggle-btn" :class="{ active: store.thinkingEnabled }" @click="store.toggleThinking(!store.thinkingEnabled)">{{ store.thinkingEnabled ? '开启' : '关闭' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '../stores/chat'
const store = useChatStore()
function formatNum(n: number): string { return n >= 1000 ? (n / 1000).toFixed(0) + 'k' : String(n) }
</script>

<style scoped>
.model-settings { padding: 12px; }
.settings-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); margin-bottom: 12px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 12px; }
.setting-row + .setting-row { border-top: 1px solid var(--border, #e5e7eb); }
.setting-label { font-size: 13px; color: var(--text-primary, #1f2937); min-width: 90px; }
.setting-control { display: flex; align-items: center; gap: 8px; }
.setting-slider { width: 120px; height: 4px; appearance: none; background: var(--border, #e5e7eb); border-radius: 2px; outline: none; cursor: pointer; }
.setting-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; background: var(--accent, #000); border-radius: 50%; cursor: pointer; }
.setting-value { min-width: 40px; text-align: right; font-size: 12px; font-family: 'SF Mono', monospace; color: var(--text-primary, #1f2937); }
.toggle-btn { padding: 4px 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: transparent; font-size: 12px; color: var(--text-secondary, #6b7280); cursor: pointer; }
.toggle-btn.active { background: #000; color: #fff; border-color: #000; }
</style>
