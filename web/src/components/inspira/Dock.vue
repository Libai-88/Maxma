<template>
  <aside class="dock" ref="rootEl" aria-label="主导航">
    <div class="dock-inner">
      <!-- Brand logo -->
      <div class="dock-section dock-top" id="logo">
        <router-link to="/" class="dock-link" aria-label="Maxma" title="Maxma">
          <div class="icon-wrapper">
            <div class="logo-glow-wrapper">
              <GlowingEffect
                :spread="30"
                :glow="true"
                :disabled="false"
                :proximity="40"
                :inactive-zone="0.3"
                :blur="4"
                :movement-duration="1.5"
                :border-width="1"
              />
              <div class="imageBox">
                <LiquidLogo :image-url="logoUrl" />
              </div>
            </div>
          </div>
          <div class="dock-label">Maxma</div>
        </router-link>
      </div>

      <!-- Nav items -->
      <div class="dock-section dock-nav">
        <AnimatedBeam
          v-if="visibleNavItems.length > 1"
          class="dock-beam"
          :width="4"
          :height="visibleNavItems.length * 56"
          :path-d="`M 2 0 Q 2 ${visibleNavItems.length * 28}, 2 ${visibleNavItems.length * 56}`"
          :color="'var(--accent)'"
          :blur="4"
          :duration="4"
          :delay="0.5"
        />
        <DockIcon
          v-for="item in visibleNavItems"
          :key="item.to"
          :icon="item.icon"
          :label="item.label"
          :to="item.to"
          :active="isActive(item.to)"
        />
      </div>

      <!-- Spacer -->
      <div class="dock-spacer"></div>

      <!-- Bottom items -->
      <div class="dock-section dock-bottom">
        <!-- Session toggle -->
        <DockIcon
          icon="sessions"
          label="会话"
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

        <!-- ME / User -->
        <DockIcon
          icon="user"
          label="ME"
          to="/user"
          :active="isActive('/user')"
        />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DockIcon from '@/components/inspira/DockIcon.vue'
import AppSettingsMenu from '@/components/AppSettingsMenu.vue'
import LiquidLogo from '@/components/LiquidLogo.vue'
import GlowingEffect from '@/components/inspira/GlowingEffect.vue'
import AnimatedBeam from '@/components/inspira/AnimatedBeam.vue'
import { useCapabilities } from '@/composables/useCapabilities'
import { gsap, easeMap } from '@/composables/useGsap'
import logoUrl from '@/assets/images/brand/favicon.png'

const rootEl = ref<HTMLElement | null>(null)
const route = useRoute()

let cleanupHover: (() => void) | null = null

onMounted(() => {
  const el = rootEl.value
  if (!el) return
  const q = gsap.utils.selector(el)

  // 导航图标入场：品牌 + 导航项依次淡入
  gsap.timeline({ defaults: { ease: easeMap.out } })
    .from(q('.dock-section.dock-top'), { autoAlpha: 0, duration: 0.3 })
    .from(q('.dock-section.dock-nav .dock-icon'), { autoAlpha: 0, duration: 0.3, stagger: 0.04 }, '-=0.15')

  // 侧边栏 hover 错落展开
  const hoverTl = gsap.timeline({ paused: true })
  hoverTl
    .to(el, { width: 300, duration: 0.35, ease: easeMap.out })
    .to(q('.dock-label'), {
      opacity: 1,
      maxWidth: 200,
      paddingLeft: 12,
      duration: 0.2,
      ease: easeMap.smooth,
      stagger: 0.03,
    }, '-=0.1')

  const onEnter = () => hoverTl.play()
  const onLeave = () => hoverTl.reverse()
  el.addEventListener('mouseenter', onEnter)
  el.addEventListener('mouseleave', onLeave)

  cleanupHover = () => {
    el.removeEventListener('mouseenter', onEnter)
    el.removeEventListener('mouseleave', onLeave)
    hoverTl.kill()
  }
})

onUnmounted(() => {
  cleanupHover?.()
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

interface NavItem {
  to: string
  label: string
  icon: string
  /** 若指定，则仅当该后端能力启用时显示。 */
  feature?: string
}

const navItems: NavItem[] = [
  { to: '/', label: '对话', icon: 'chat' },
  { to: '/capabilities', label: '能力仪表盘', icon: 'dashboard' },
  { to: '/plugins', label: '插件管理', icon: 'puzzle', feature: 'plugins' },
  { to: '/collab', label: '协作', icon: 'collab', feature: 'collab' },
  { to: '/activity', label: '活动', icon: 'activity' },
  { to: '/help', label: '帮助', icon: 'help' },
]

// 根据能力清单动态隐藏被禁用的导航项
const visibleNavItems = computed(() =>
  navItems.filter(item => !item.feature || hasFeature(item.feature)),
)

function isActive(path: string): boolean {
  return route.path === path
}
</script>

<style scoped>
.dock {
  position: fixed;
  top: 0;
  left: 0;
  width: 84px;
  height: 100%;
  background: var(--bg-card, #fff);
  z-index: 120;
  padding-left: 10px;
  overflow: hidden;
}

.dock-inner {
  position: relative;
  height: 100vh;
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
  margin: 20px 0 24px 0;
}

.dock-nav {
  flex-shrink: 0;
}

.dock-spacer {
  flex: 1;
}

.dock-bottom {
  margin-top: auto;
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
  color: var(--accent, rgb(110, 90, 240));
}

#logo .dock-label {
  position: relative;
  height: 52px;
  display: flex;
  align-items: center;
  font-size: 15px;
  color: var(--text-primary, #333);
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
  color: var(--accent, rgb(110, 90, 240));
  transition: color 0.5s;
}

.settings-item :deep(.settings-btn:hover) {
  background: transparent;
  color: #ffa117;
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