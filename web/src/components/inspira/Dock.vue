<template>
  <aside class="dock" ref="rootEl" aria-label="主导航">
    <div class="dock-inner">
      <!-- Brand logo -->
      <div class="dock-section dock-top" id="logo">
        <router-link to="/" class="dock-link" aria-label="Maxma" title="Maxma">
          <div class="icon-wrapper">
            <div class="logo-glow-wrapper">
              <GlowingEffect
                v-if="!calmMotion"
                :spread="30"
                :glow="true"
                :disabled="false"
                :proximity="40"
                :inactive-zone="0.3"
                :blur="4"
                :movement-duration="1.5"
                :border-width="1"
                class="ds-decor"
              />
              <div class="imageBox">
                <LiquidLogo :image-url="logoUrl" />
              </div>
            </div>
          </div>
          <div class="dock-label">Maxma</div>
        </router-link>
      </div>

      <!-- Nav items: 分组 + 分隔线，把 9 个平铺图标分成「工作 / 工具」两级 -->
      <nav class="dock-section dock-nav" aria-label="页面导航">
        <span
          ref="activeBarEl"
          class="dock-active-bar"
          aria-hidden="true"
        ></span>
        <AnimatedBeam
          v-if="!calmMotion && visibleNavItems.length > 1"
          class="dock-beam ds-decor"
          :width="4"
          :height="beamHeight"
          :path-d="`M 2 0 Q 2 ${beamHeight / 2}, 2 ${beamHeight}`"
          :color="'var(--accent)'"
          :blur="4"
          :duration="4"
          :delay="0.5"
        />
        <div
          v-for="(group, index) in visibleGroups"
          :key="group.key"
          class="dock-group"
          :class="{ 'dock-group--divided': index > 0 }"
          role="group"
          :aria-label="group.label"
        >
          <p class="dock-group-label" aria-hidden="true">{{ group.label }}</p>
          <DockIcon
            v-for="item in group.items"
            :key="item.to"
            :icon="item.icon"
            :label="item.label"
            :group-label="group.label"
            :to="item.to"
            :active="isActive(item.to)"
            :busy="item.to === '/' && hasStreaming"
          />
        </div>
      </nav>

      <!-- Spacer -->
      <div class="dock-spacer"></div>

      <!-- Bottom items -->
      <div class="dock-section dock-bottom">
        <div class="dock-group dock-group--divided" role="group" aria-label="会话与设置">
          <p class="dock-group-label" aria-hidden="true">系统</p>
          <!-- Session toggle -->
          <DockIcon
            icon="sessions"
            label="会话"
            group-label="系统"
            :active="sessionDrawerOpen"
            @click="emit('toggle-session-drawer')"
          />

          <!-- Settings -->
          <div class="settings-item">
            <AppSettingsMenu
              compact
              :onboarding-enabled="onboardingEnabled"
              @restart-onboarding="emit('restart-onboarding')"
            />
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DockIcon from '@/components/inspira/DockIcon.vue'
import AppSettingsMenu from '@/components/AppSettingsMenu.vue'
import LiquidLogo from '@/components/LiquidLogo.vue'
import GlowingEffect from '@/components/inspira/GlowingEffect.vue'
import AnimatedBeam from '@/components/inspira/AnimatedBeam.vue'
import { useCapabilities } from '@/composables/useCapabilities'
import { useChatStore } from '@/stores/chat'
import { useMotion } from '@/composables/useMotion'
import { gsap, easeMap } from '@/composables/useGsap'
import logoUrl from '@/assets/images/brand/favicon.png'

const rootEl = ref<HTMLElement | null>(null)
const route = useRoute()
const { calm: calmMotion } = useMotion()

onMounted(() => {
  const el = rootEl.value
  if (!el || calmMotion.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // 克制模式仍需指示条落位（只是不补间）
    void nextTick(() => positionActiveBar(true))
  } else {
    const q = gsap.utils.selector(el)

    // 只做一次轻量入场；导航宽度保持固定，避免 hover 时覆盖主内容。
    gsap.timeline({ defaults: { ease: easeMap.out }, onComplete: () => positionActiveBar(true) })
      .from(q('.dock-section.dock-top'), { autoAlpha: 0, y: -4, duration: 0.24 })
      .from(q('.dock-section.dock-nav .dock-icon'), { autoAlpha: 0, y: 4, duration: 0.22, stagger: 0.035 }, '-=0.12')
  }

  // 窄窗口断点（820px）切换 --icon-rail-width 时图标高度不变，但保险起见跟随尺寸
  barResizeObserver = new ResizeObserver(() => positionActiveBar(true))
  if (el) barResizeObserver.observe(el)
})

onUnmounted(() => {
  barResizeObserver?.disconnect()
  barResizeObserver = null
})

withDefaults(defineProps<{
  onboardingEnabled?: boolean
  sessionDrawerOpen?: boolean
}>(), {
  onboardingEnabled: false,
  sessionDrawerOpen: false,
})

const emit = defineEmits<{
  (event: 'toggle-session-drawer'): void
  (event: 'restart-onboarding'): void
}>()

const { hasFeature } = useCapabilities()
const chatStore = useChatStore()
const hasStreaming = computed(() => Array.from(chatStore.channels.values()).some(channel => channel.isStreaming))

interface NavItem {
  to: string
  label: string
  icon: string
  /** 若指定，则仅当该后端能力启用时显示。 */
  feature?: string
}

interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

// 能力门控保留：后端不发 deferred_subagent_submitted 时 Agent 项必须消失。
const navGroups: NavGroup[] = [
  {
    key: 'work',
    label: '工作',
    items: [
      { to: '/', label: '对话', icon: 'chat' },
      { to: '/providers', label: '模型', icon: 'model' },
      { to: '/memory', label: '记忆', icon: 'memory', feature: 'memory' },
      { to: '/evolution', label: '成长', icon: 'sparkles', feature: 'memory' },
      { to: '/agent-tasks', label: 'Agent', icon: 'cpu', feature: 'sub_agents' },
    ],
  },
  {
    key: 'tools',
    label: '工具',
    items: [
      { to: '/metrics', label: '运行指标', icon: 'metrics' },
      { to: '/extensions', label: '扩展', icon: 'extensions' },
      { to: '/plugins', label: '插件', icon: 'puzzle', feature: 'plugins' },
      { to: '/activity', label: '活动', icon: 'activity' },
    ],
  },
]

const visibleGroups = computed(() => navGroups
  .map(group => ({ ...group, items: group.items.filter(item => !item.feature || hasFeature(item.feature)) }))
  .filter(group => group.items.length > 0))

const visibleNavItems = computed(() => visibleGroups.value.flatMap(group => group.items))

/** 光柱高度 = 图标总高 + 分组分隔线预留 */
const beamHeight = computed(() => visibleNavItems.value.length * 56 + (visibleGroups.value.length - 1) * 26)

function isActive(path: string): boolean {
  return path === '/' ? route.path === path : route.path === path || route.path.startsWith(`${path}/`)
}

// ── 滑动指示条（DOCK-BAR-001）──────────────────────────────
// 当前页的朱砂标尺不再随路由跳变，而是在分组间滑动过去；
// 克制模式/减少动效下直接落位不补间。首次出现时不播动画。
const activeBarEl = ref<HTMLElement | null>(null)
let barReady = false
let barResizeObserver: ResizeObserver | null = null

function positionActiveBar(instant = false) {
  const nav = rootEl.value?.querySelector<HTMLElement>('.dock-nav')
  const bar = activeBarEl.value
  if (!nav || !bar) return
  const active = nav.querySelector<HTMLElement>('.dock-icon.active')
  if (!active) {
    bar.style.opacity = '0'
    return
  }
  const navRect = nav.getBoundingClientRect()
  const rect = active.getBoundingClientRect()
  const y = rect.top - navRect.top
  const noTween = instant || !barReady || calmMotion.value
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (noTween) {
    gsap.set(bar, { y, height: rect.height, opacity: 1 })
  } else {
    gsap.to(bar, { y, height: rect.height, opacity: 1, duration: 0.35, ease: easeMap.out, overwrite: 'auto' })
  }
  barReady = true
}

watch(() => route.path, () => { void nextTick(() => positionActiveBar()) })
watch(visibleGroups, () => { void nextTick(() => positionActiveBar(true)) })
</script>

<style scoped>
.dock {
  position: fixed;
  top: 0;
  left: 0;
  width: var(--icon-rail-width, 84px);
  height: 100%;
  background: var(--bg-card);
  z-index: 120;
  padding-left: 6px;
  overflow: visible;
  border-right: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  box-shadow: 2px 0 14px color-mix(in srgb, var(--text-primary) 4%, transparent);
  isolation: isolate;
}

@media (max-width: 820px) {
  .dock { padding-left: 2px; }
}

.dock-inner {
  position: relative;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
}

.dock-section {
  display: flex;
  flex-direction: column;
}

.dock-top {
  margin: 16px 0 12px 0;
}

.dock-nav {
  flex-shrink: 0;
  position: relative;
}

/* ── 滑动指示条（DOCK-BAR-001）：当前页的朱砂标尺在分组间滑动，
 * 由 Dock.vue 测位 + GSAP 补间；克制模式 v-if 移除，落位即静态。 */
.dock-active-bar {
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--accent);
  opacity: 0;
  z-index: 1;
  pointer-events: none;
}

.dock-spacer {
  flex: 1;
}

.dock-bottom {
  margin-top: auto;
}

/* ── 分组：细分隔线 + 小标签，让平铺图标有层级 ── */
.dock-group {
  display: flex;
  flex-direction: column;
}
.dock-group--divided {
  margin-top: var(--space-12);
  padding-top: var(--space-12);
  border-top: 1px solid var(--border);
}
.dock-group-label {
  margin: 0 0 2px;
  text-align: center;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
  user-select: none;
}

.imageBox {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.imageBox img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.dock-link {
  position: relative;
  display: flex;
  align-items: center;
  white-space: nowrap;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-decoration: none;
  padding: 0;
}

#logo .icon-wrapper {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 36px;
  height: 52px;
  color: var(--accent);
}

#logo .dock-label {
  position: relative;
  height: 52px;
  display: flex;
  align-items: center;
  font-size: 15px;
  color: var(--text-primary);
  padding-left: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 800;
  font-family: var(--font-display);
  overflow: hidden;
  white-space: nowrap;
  max-width: 0;
  opacity: 0;
}

/* ── Settings button integration ── */
.settings-item :deep(.settings-area) {
  margin: 0;
  width: 100%;
}

.settings-item :deep(.settings-btn) {
  width: 100%;
  min-width: 0;
  min-height: 52px;
  height: 52px;
  padding: 5px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  border-radius: 0;
  gap: 0;
  background: transparent;
  color: var(--accent);
  transition: color var(--duration-fast, .15s), background var(--duration-fast, .15s);
}

.settings-item :deep(.settings-btn:hover) {
  background: transparent;
  color: var(--accent-text);
}

.settings-item :deep(.settings-btn .icon) {
  min-width: 36px;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 52px;
}

/* ── Glowing Effect wrapper ── */
.logo-glow-wrapper {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: visible;
}

.logo-glow-wrapper .imageBox {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}
</style>
