<template>
  <div class="persona-card">
    <div class="card-header">当前人格</div>
    <div class="card-body">
      <div class="persona-avatar">
        <img class="persona-avatar-img" :src="avatarImg" alt="Maxma 人格头像" />
        <span class="persona-name">{{ store.profile.name }}</span>
      </div>
      <p class="persona-desc">"{{ store.profile.description }}"</p>
      <div class="persona-details">
        <div class="detail-row"><span class="label">称呼你</span><span class="value">{{ store.profile.nickname }}</span></div>
        <div class="detail-row"><span class="label">常驻地</span><span class="value">{{ store.profile.scene || '小书房' }}</span></div>
        <div class="detail-row"><span class="label">风格</span><span class="value">{{ store.profile.style }}</span></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePersonaStore } from '../stores/persona'
import avatarImg from '../assets/images/brand/logo-companion-opt.jpg'

const store = usePersonaStore()
</script>

<style scoped>
.persona-card { padding: 20px; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; background: var(--bg-card, #fff); }
.card-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); margin-bottom: 16px; }
.persona-avatar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.persona-avatar-img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid var(--border, #e5e7eb); }
.persona-name { font-size: 20px; font-weight: 600; color: var(--text-primary, #1f2937); }
.persona-desc { font-size: 14px; color: var(--text-secondary, #6b7280); font-style: italic; margin: 0 0 16px; }
.persona-details { display: flex; flex-direction: column; gap: 8px; }
.detail-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-top: 1px solid var(--border, #e5e7eb); }
.label { color: var(--text-secondary, #6b7280); }
.value { color: var(--text-primary, #1f2937); font-weight: 500; }
</style>
