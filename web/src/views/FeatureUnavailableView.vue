<!-- web/src/views/FeatureUnavailableView.vue -->
<template>
  <div class="fu-view" ref="rootEl">
    <div class="fu-card">
      <div class="fu-icon">🚧</div>
      <h1 class="fu-title">功能不可用</h1>
      <p class="fu-text">
        <template v-if="featureTitle">「{{ featureTitle }}」</template>
        <template v-else>该功能</template>
        当前未启用。
      </p>
      <p class="fu-desc">
        此功能可能需要在设置中开启，或当前部署未包含相应能力。
        你可以返回对话继续，或前往能力仪表盘查看当前可用的特性。
      </p>
      <div class="fu-actions">
        <router-link to="/" class="fu-action fu-action-primary">
          <span class="fu-action-icon">💬</span>
          <span class="fu-action-body">
            <span class="fu-action-title">返回对话</span>
            <span class="fu-action-desc">继续与 AI 聊天</span>
          </span>
        </router-link>
        <router-link to="/capabilities" class="fu-action">
          <span class="fu-action-icon">📊</span>
          <span class="fu-action-body">
            <span class="fu-action-title">能力仪表盘</span>
            <span class="fu-action-desc">查看当前启用的特性</span>
          </span>
        </router-link>
        <button type="button" class="fu-action fu-action-btn" @click="retry">
          <span class="fu-action-icon">🔄</span>
          <span class="fu-action-body">
            <span class="fu-action-title">重新检测</span>
            <span class="fu-action-desc">刷新能力清单后返回</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'

defineOptions({ name: 'FeatureUnavailableView' })

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { blocks: '.fu-card' })

// 返回/重试等操作卡 hover 弹性放大（含 2 个 router-link CTA 与重新检测按钮）
useButtonFx(() => rootEl.value, '.fu-action')

const route = useRoute()
const router = useRouter()
const capabilitiesStore = useCapabilitiesStore()

const featureTitle = computed(() => {
  const t = route.query.title
  return Array.isArray(t) ? t[0] : t || ''
})

const featureKey = computed(() => {
  const f = route.query.feature
  return Array.isArray(f) ? f[0] : f || ''
})

// 重新拉取能力清单；若该特性其实已启用，则返回原页面。
async function retry() {
  await capabilitiesStore.refreshCapabilities()
  if (featureKey.value && capabilitiesStore.isFeatureEnabled(featureKey.value)) {
    const target = route.query.from
    const to = Array.isArray(target) ? target[0] : target
    if (to) {
      void router.replace(to)
      return
    }
  }
  void router.replace('/')
}
</script>

<style scoped>
.fu-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}
.fu-card {
  text-align: center;
  max-width: 480px;
  padding: 32px 28px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
}
.fu-icon {
  font-size: 2.4em;
  line-height: 1;
  margin-bottom: 8px;
}
.fu-title {
  font-size: 1.6em;
  font-weight: 700;
  color: var(--accent);
  margin: 0;
  letter-spacing: -0.5px;
}
.fu-text {
  color: var(--text-primary);
  font-size: 1.05em;
  font-weight: 600;
  margin: 8px 0 8px;
}
.fu-desc {
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
  margin: 0 0 20px;
}
.fu-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.fu-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-primary);
  color: var(--text-primary);
  text-decoration: none;
  cursor: pointer;
  font: inherit;
  transition: border-color 0.15s, background 0.15s, transform 0.15s;
}
.fu-action:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-primary));
  transform: translateY(-1px);
}
.fu-action-primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
}
.fu-action-icon {
  font-size: 1.5em;
  flex-shrink: 0;
}
.fu-action-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.fu-action-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
}
.fu-action-desc {
  font-size: 0.78em;
  color: var(--text-secondary);
  line-height: 1.35;
}
</style>
