<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-avatar">{{ store.profile.avatar }}</div>
      <h1 class="welcome-name">{{ store.profile.name }}</h1>
      <p class="welcome-scene">{{ store.profile.scene }}，Maxma 正趴在桌上等你。</p>
      <p class="welcome-greeting">{{ store.profile.greeting }}</p>
      <div class="welcome-actions">
        <button class="action-btn" @click="$emit('start', '随便聊聊')">💬 随便聊聊</button>
        <button class="action-btn" @click="$emit('start', '帮我看看最近有什么好玩的')">🔍 帮我个忙</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePersonaStore } from '../stores/persona'
const store = usePersonaStore()
defineEmits<{ start: [message: string] }>()
</script>

<style scoped>
.welcome-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
.welcome-content { text-align: center; max-width: 400px; }
.welcome-avatar { font-size: 48px; margin-bottom: 12px; }
.welcome-name { font-size: 24px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0 0 16px; }
.welcome-scene { font-size: 14px; color: var(--text-secondary, #6b7280); line-height: 1.7; margin: 0 0 8px; }
.welcome-greeting { font-size: 16px; color: var(--text-primary, #1f2937); font-weight: 500; margin: 0 0 32px; }
.welcome-actions { display: flex; gap: 12px; justify-content: center; }
.action-btn { padding: 10px 20px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: var(--bg-card, #fff); font-size: 14px; color: var(--text-primary, #1f2937); cursor: pointer; transition: all 0.15s; }
.action-btn:hover { background: #000; color: #fff; border-color: #000; }
</style>
