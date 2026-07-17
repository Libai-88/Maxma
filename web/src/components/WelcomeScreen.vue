<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-avatar">{{ store.profile.avatar }}</div>
      <h1 class="welcome-name">{{ store.profile.name }}</h1>
      <p class="welcome-scene">{{ store.profile.scene }}，Maxma 正趴在桌上等你。</p>
      <p class="welcome-greeting">{{ store.profile.greeting }}</p>
      <div class="welcome-actions">
        <button class="action-btn" @click="$emit('start', '随便聊聊')">
          <span class="action-icon" v-html="chatBubbleSvg"></span>
          <span>随便聊聊</span>
        </button>
        <button class="action-btn" @click="$emit('start', '帮我看看最近有什么好玩的')">
          <span class="action-icon" v-html="searchSvg"></span>
          <span>帮我个忙</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePersonaStore } from '../stores/persona'
import chatBubbleRaw from '../assets/icons/welcome/chat-bubble.svg?raw'
import searchRaw from '../assets/icons/welcome/search.svg?raw'

const store = usePersonaStore()
defineEmits<{ start: [message: string] }>()

const chatBubbleSvg = computed(() => chatBubbleRaw.replace(/<\?xml[^>]*\?>/, '').trim())
const searchSvg = computed(() => searchRaw.replace(/<\?xml[^>]*\?>/, '').trim())
</script>

<style scoped>
.welcome-screen { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
.welcome-content { text-align: center; max-width: 400px; }
.welcome-avatar { font-size: 48px; margin-bottom: 12px; }
.welcome-name { font-size: 24px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0 0 16px; }
.welcome-scene { font-size: 14px; color: var(--text-secondary, #6b7280); line-height: 1.7; margin: 0 0 8px; }
.welcome-greeting { font-size: 16px; color: var(--text-primary, #1f2937); font-weight: 500; margin: 0 0 32px; }
.welcome-actions { display: flex; gap: 12px; justify-content: center; }
.action-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: var(--bg-card, #fff); font-size: 14px; color: var(--text-primary, #1f2937); cursor: pointer; transition: background 0.15s, color 0.15s, border-color 0.15s; }
.action-btn:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.action-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 0; flex-shrink: 0; }
.action-icon :deep(svg) { width: 100%; height: 100%; }
</style>
