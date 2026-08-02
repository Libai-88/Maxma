<template>
  <div class="settings-modal">
    <!-- Header -->
    <div class="settings-header">
      <h2 class="settings-title">设置中心</h2>
      <p class="settings-subtitle">选择要配置的功能模块</p>
    </div>

    <!-- Grid of setting items -->
    <div class="settings-grid">
      <button
        v-for="(item, i) in items"
        :key="i"
        class="settings-card"
        :style="{ '--i': i }"
        @click="$emit('select', item)"
      >
        <div class="card-icon">
          <Icon :name="item.icon" :size="20" decorative />
        </div>
        <div class="card-info">
          <div class="card-title">{{ item.title }}</div>
          <div class="card-subtitle">{{ item.subtitle }}</div>
        </div>
      </button>
    </div>

    <!-- Footer action buttons -->
    <div class="settings-actions">
      <button class="action-btn" :class="{ restarting }" :disabled="restarting" @click="$emit('restart')" title="重启服务">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <span>重启</span>
      </button>
      <button class="action-btn" @click="$emit('clear-session')" title="清空当前会话">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>清空</span>
      </button>
      <button class="action-btn" :class="{ exporting }" :disabled="exporting" @click="$emit('export-logs')" title="导出错误日志">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>日志</span>
      </button>
      <button class="action-btn" :class="{ managing }" :disabled="managing" @click="$emit('manage-logs')" title="日志管理">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span>日志管理</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'

export interface SettingsItem {
  icon: string
  title: string
  subtitle: string
  route: string
}

defineProps<{
  items: SettingsItem[]
  restarting?: boolean
  exporting?: boolean
  managing?: boolean
}>()

defineEmits<{
  select: [item: SettingsItem]
  restart: []
  'clear-session': []
  'export-logs': []
  'manage-logs': []
}>()
</script>

<style scoped>
.settings-modal {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Header ── */
.settings-header {
  text-align: center;
  padding: 4px 0 16px;
}
.settings-title {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
  margin: 0;
}
.settings-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin: 4px 0 0;
}

/* ── Grid ── */
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 0 0 4px;
}

.settings-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: #fff;
  transition: all 0.2s ease;
  animation: card-enter 0.4s ease both;
  animation-delay: calc(var(--i, 0) * 30ms);
}

@keyframes card-enter {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.settings-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.settings-card:active {
  transform: scale(0.97);
}

.card-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
  transition: background 0.2s;
}

.settings-card:hover .card-icon {
  background: rgba(255, 255, 255, 0.14);
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: #fff;
  margin-bottom: 2px;
}

.card-subtitle {
  font-size: 11px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.45);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── Action buttons ── */
.settings-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding-top: 16px;
  flex-wrap: wrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}
.action-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.restarting {
  color: #f59e0b;
  border-color: #f59e0b40;
}
.action-btn.exporting {
  color: #3b82f6;
  border-color: #3b82f640;
}
.action-btn svg {
  flex-shrink: 0;
}
</style>