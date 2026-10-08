<script setup lang="ts">
/**
 * JetHubUsageBadge.vue — 会话输入区的用量徽标（PLUGIN-001 / P7）。
 *
 * 这是插件 README 的头号卖点之一，也是 Maxma 里**唯一嵌进聊天界面**的插件 UI
 * （其余都在 Jet Hub 管理页）。对应插件客户端注册在 `conversation.input.right` 槽位的组件。
 *
 * 折叠态那一行文案**完全交给搬运过来的 `badgeView()`** 计算 —— 口径是
 * 「窗口 > 套餐包 > 积分」（插件 2026-10-01 定的），并由插件自带的 74 条单测锁住。
 * 这里只负责取数、轮询与渲染，不自己拼文案（自己拼就会与插件口径分叉）。
 *
 * ⚠️ 两个由插件踩过坑定下的行为，不要"优化"掉：
 *   1. `loading`（首次读数未回）**必须**与「没有启用账号」区分，否则首屏会说
 *      「未配置启用账号」，用户以为账号丢了（真实报障 2026-10-02）；
 *   2. 读失败**保留上次读数**，只在「首次且无数据」时才显示「用量不可用」。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useJetHubStore } from '@/stores/jetHub'
import {
  badgeView,
  BADGE_PREFERENCE_LABELS,
  formatUpdatedAt,
} from '@/utils/jetHub/badge-model.js'
import { formatUnits } from '@/utils/jetHub/credits-format.js'
import { formatQuotaPercent } from '@/utils/jetHub/quota-format.js'
import { supportsCreditBalance } from '@/utils/jetHub/credits-capabilities.js'

const props = defineProps<{
  /** 当前会话选中的模型（形如 `provider/modelId`，与 Maxma 其它地方一致）。 */
  model: string
}>()

const store = useJetHubStore()
const open = ref(false)

const PREFERENCE_ORDER = ['auto', 'subscription', 'credits'] as const

/**
 * 模型串里的 provider 段。
 *
 * ⚠️ 判断「是不是插件渠道」用的是**后端给的渠道清单**（`/plugins/:name/providers`），
 * 不在前端硬编码那 15 个 id —— 上游增删渠道时硬编码那份会静默过期，
 * 表现为「某个渠道的徽标永远不出现」。
 */
const providerId = computed(() => {
  const raw = String(props.model ?? '')
  const slash = raw.indexOf('/')
  return slash > 0 ? raw.slice(0, slash) : ''
})

const route = computed(() => store.routes.find((item) => item.id === providerId.value))
/**
 * 非插件渠道（如内置免费通道、用户自配 provider）不显示徽标。
 *
 * ⚠️ 还要按能力矩阵再挡一道：`jet-hub-auto`（自动选号）**在渠道清单里**，
 * 但 `usage.badge` 对它回 `unsupported provider` —— 不挡的话，聊天页每选一次
 * 自动选号，徽标就每 60 秒发一个必然失败的请求、永久刷报错。
 * 插件客户端自己的面板挂载也是这么门控的（`canLoadCredits = supportsCreditBalance(provider)`，
 * 文件头记录的历史缺陷正是「对不支持的 provider 无条件发请求」）。
 */
const active = computed(() => Boolean(route.value) && supportsCreditBalance(providerId.value))

const view = computed(() =>
  badgeView({
    providerLabel: route.value?.name || providerId.value || 'Jet Hub',
    preference: store.badgePreference,
    subscription: store.badge?.subscription,
    accounts: store.badge?.accounts ?? [],
    loading: store.badgeLoading,
    failed: store.badgeFailed,
  }),
)

const updatedAt = computed(() => (store.badge?.generatedAt ? formatUpdatedAt(store.badge.generatedAt) : ''))

function toggle() {
  open.value = !open.value
}

async function refresh() {
  try {
    await store.loadBadgeProvider(providerId.value, { force: true })
  } catch {
    // 错误已在 store.badgeError；读失败保留上次读数
  }
}

async function pickPreference(preference: (typeof PREFERENCE_ORDER)[number]) {
  try {
    await store.setBadgePreference(preference)
  } catch {
    // 同上
  }
}

/** 每日自动签到开关（全局一个，与渠道无关）。 */
async function toggleAutoCheckin(enabled: boolean) {
  try {
    await store.setAutoCheckin(enabled)
  } catch {
    // 错误已在 store.error
  }
}

let stopPolling: (() => void) | null = null

async function start() {
  stopPolling?.()
  stopPolling = null
  if (!providerId.value) return
  // 渠道清单可能还没加载过（用户直接进对话页，没去过 Jet Hub）
  if (store.routes.length === 0) {
    try {
      await store.loadProviders()
    } catch {
      return
    }
  }
  if (!active.value) return
  await store.loadBadgePreference()
  stopPolling = store.startBadgePolling(providerId.value)
}

onMounted(() => {
  void start()
  void store.loadAutoCheckin()
})

watch(() => props.model, () => {
  open.value = false
  void start()
})

onBeforeUnmount(() => {
  stopPolling?.()
  stopPolling = null
  store.stopBadgePolling()
})
</script>

<template>
  <div v-if="active" class="badge-root">
    <button
      type="button"
      class="badge"
      :class="`tone-${view.tone}`"
      :title="`${view.text}${updatedAt ? ` · ${updatedAt}` : ''}`"
      :aria-label="view.text"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{{ view.name }}</span>
      <span v-if="view.detail" class="detail">{{ view.detail }}</span>
      <span v-if="view.reading" class="reading">{{ view.reading }}</span>
      <span v-if="view.incompleteNote" class="warn-mark" :title="view.incompleteNote" aria-hidden="true">*</span>
    </button>

    <div v-if="open" class="popover" role="dialog" aria-label="用量详情">
      <div class="pop-head">
        <span class="pop-title">{{ view.name }}</span>
        <span v-if="updatedAt" class="pop-sub">{{ updatedAt }}{{ store.badge?.cached ? '（缓存）' : '' }}</span>
      </div>

      <p v-if="store.badgeError" class="pop-warn">{{ store.badgeError }}</p>

      <!-- 窗口读数（订阅型渠道）：百分比 + 重置倒计时 -->
      <ul v-if="view.windows.length" class="pop-list">
        <li v-for="(w, idx) in view.windows" :key="`w${idx}`">
          <span>{{ w.label }}</span>
          <span>{{ formatQuotaPercent(w.percent) }}</span>
        </li>
      </ul>

      <!-- 逐账号余额（按单位归组；单位标签由搬运过来的 unitLabel 给出，不写死「积分」） -->
      <ul v-if="view.groups.length" class="pop-list">
        <li v-for="(g, idx) in view.groups" :key="`g${idx}`">
          <span>{{ g.label }}</span>
          <span>{{ formatUnits(g.total, g.unit) }}</span>
        </li>
      </ul>

      <p v-if="view.failedCount" class="pop-sub">另有 {{ view.failedCount }} 个账号读取失败（不计入合计，也不画成 0）</p>

      <p v-if="!view.windows.length && !view.groups.length" class="pop-sub">{{ view.reading || '暂无可展示的用量' }}</p>

      <div class="pop-section">
        <span class="pop-label">显示偏好</span>
        <div class="pop-prefs">
          <button
            v-for="pref in PREFERENCE_ORDER"
            :key="pref"
            type="button"
            class="pref-btn"
            :class="{ active: store.badgePreference === pref }"
            :disabled="store.pending === 'badge:preference'"
            @click="pickPreference(pref)"
          >
            {{ BADGE_PREFERENCE_LABELS[pref] || pref }}
          </button>
        </div>
      </div>

      <!-- 每日首次启动自动签到（全局一个开关，与渠道无关） -->
      <div class="pop-section">
        <label class="pop-toggle">
          <input
            type="checkbox"
            :checked="store.autoCheckin?.enabled === true"
            :disabled="store.pending === 'auto-checkin'"
            @change="toggleAutoCheckin(($event.target as HTMLInputElement).checked)"
          />
          <span>每日自动签到</span>
        </label>
        <span v-if="store.autoCheckin?.lastDate" class="pop-sub">
          上次：{{ store.autoCheckin.lastDate }}{{ store.autoCheckin.ranToday ? '（今日已跑）' : '' }}
        </span>
      </div>

      <div class="pop-actions">
        <button type="button" class="pop-btn" @click="refresh">刷新</button>
        <button type="button" class="pop-btn" @click="open = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.badge-root {
  position: relative;
  display: inline-flex;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 340px;
  padding: 3px 10px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 999px;
  background: var(--bg-secondary, #faf8f4);
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.badge:hover {
  background: var(--bg-card, #fff);
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.5;
}

.tone-ok .dot {
  background: #3f9c5a;
  opacity: 1;
}

.tone-warn .dot {
  background: #d9a441;
  opacity: 1;
}

.tone-error .dot {
  background: #b23b2e;
  opacity: 1;
}

.name {
  font-weight: 600;
}

.detail,
.reading {
  color: var(--text-tertiary, #8a8a8a);
  overflow: hidden;
  text-overflow: ellipsis;
}

.warn-mark {
  color: #d9a441;
}

.popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 260px;
  max-width: 380px;
  padding: 12px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 10px;
  background: var(--bg-card, #fff);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
}

.pop-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.pop-title {
  font-size: 12px;
  font-weight: 600;
}

.pop-sub {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.pop-warn {
  margin: 0;
  font-size: 11px;
  color: #a5731a;
}

.pop-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 220px;
  overflow: auto;
}

.pop-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.pop-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--border, #e6e2da);
}

.pop-label {
  font-size: 11px;
  color: var(--text-tertiary, #8a8a8a);
}

.pop-prefs {
  display: flex;
  gap: 6px;
}

.pref-btn,
.pop-btn {
  padding: 3px 9px;
  border: 1px solid var(--border, #e6e2da);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.pref-btn.active {
  border-color: var(--accent, #b4552d);
  color: var(--accent, #b4552d);
}

.pop-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.pop-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
}
</style>
