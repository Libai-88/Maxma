<!-- web/src/views/FeatureUnavailableView.vue -->
<template>
  <div class="fu-view ds-view ds-view--narrow" ref="rootEl">
    <div class="fu-card">
      <div class="fu-icon">{{ availabilityIcon }}</div>
      <h1 class="fu-title">功能不可用</h1>
      <p class="fu-text">
        <template v-if="featureTitle">「{{ featureTitle }}」</template>
        <template v-else>该功能</template>
        当前未启用。
      </p>
      <!-- CAP-HONESTY-001：照实说原因。后端能力清单特意发布了
           engine_supported / reason（bun-backend/src/routes/capabilities.ts
           features.sub_agents），此前这里只读 route.query.title，于是
           「引擎做不到」被渲染成「你可能在设置里关了」——把引擎的缺陷
           谎报成用户的操作。 -->
      <p class="fu-desc">
        {{ availability.reason }}
      </p>
      <p v-if="availability.kind === 'engine_unsupported'" class="fu-note">
        这一条由 Agent 引擎的能力清单报告，调整本地设置不会改变结果；
        引擎支持后重新检测即可恢复入口。
      </p>
      <p v-else-if="availability.kind === 'user_disabled'" class="fu-note">
        前往「运行设置」或能力仪表盘可以重新开启。
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
import { useRoute, useRouter, type LocationQueryValue } from 'vue-router'
import { useCapabilitiesStore } from '@/stores/capabilities'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'

defineOptions({ name: 'FeatureUnavailableView' })

/** query 值 → 字符串：数组取首个，`null`（?x= / ?x）与缺项一律收敛成空串。 */
function firstQueryValue(
  value: LocationQueryValue | LocationQueryValue[],
): string {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { blocks: '.fu-card' })

// 返回/重试等操作卡 hover 弹性放大（含 2 个 router-link CTA 与重新检测按钮）
useButtonFx(() => rootEl.value, '.fu-action')

const route = useRoute()
const router = useRouter()
const capabilitiesStore = useCapabilitiesStore()

const featureTitle = computed<string>(() => firstQueryValue(route.query.title))

// ?feature= / ?feature 这类残缺 query 会让数组分支取到 null，而旧写法只在
// 非数组分支上兜了 `|| ''`；describeFeature 的形参是 string，必须收敛。
const featureKey = computed<string>(() => firstQueryValue(route.query.feature))

// CAP-HONESTY-001：真实原因取自能力清单（engine_supported / reason），
// 不再靠 route.query 猜「用户可能关掉了」。清单未加载时也只说「无法判断」。
const availability = computed(() => capabilitiesStore.describeFeature(featureKey.value))

const availabilityIcon = computed(() => {
  if (availability.value.kind === 'engine_unsupported') return '🚫'
  if (availability.value.kind === 'user_disabled') return '🔌'
  return '🚧'
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
}
.fu-card {
  text-align: center;
  max-width: 480px;
  padding: 32px 28px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
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

/* 补充说明：负上边距只在它真的渲染时生效（不用 :has，兼容旧 WebView2） */
.fu-note {
  color: var(--text-tertiary);
  font-size: 0.78em;
  line-height: 1.5;
  margin: -12px 0 20px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--text-primary) 3%, transparent);
  text-align: left;
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
  border-radius: var(--radius-lg);
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
