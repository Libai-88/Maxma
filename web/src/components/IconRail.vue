<template>
  <aside class="shell" ref="rootEl" aria-label="主导航">
    <ul class="nav">
      <!-- Brand logo -->
      <li id="logo">
        <router-link to="/" aria-label="Maxma" title="Maxma">
          <div class="icon">
            <div class="imageBox">
              <img src="@/assets/images/brand/favicon.png" alt="" />
            </div>
          </div>
          <div class="text">Maxma</div>
        </router-link>
      </li>

      <!-- Nav items -->
      <li
        v-for="item in visibleNavItems"
        :key="item.to"
        :class="{ active: isActive(item.to) }"
      >
        <router-link :to="item.to" :aria-label="item.label" :title="item.label">
          <div class="icon">
            <Icon :name="item.icon" :size="12" />
          </div>
          <div class="text">{{ item.label }}</div>
        </router-link>
      </li>

      <!-- Spacer -->
      <li class="spacer"></li>

      <!-- Session toggle -->
      <li :class="{ active: sessionDrawerOpen }">
        <button
          type="button"
          class="session-btn"
          aria-label="会话"
          title="会话"
          aria-controls="session-drawer"
          :aria-expanded="sessionDrawerOpen"
          @click="emit('toggle-session-drawer')"
        >
          <div class="icon">
            <Icon name="sessions" :size="12" />
          </div>
          <div class="text">会话</div>
        </button>
      </li>

      <!-- Settings -->
      <li class="settings-item">
        <AppSettingsMenu
          compact
          :onboarding-enabled="onboardingEnabled"
          @restart-onboarding="emit('restart-onboarding')"
        />
      </li>

      <!-- ME / User -->
      <li :class="{ active: isActive('/user') }">
        <router-link to="/user" aria-label="用户" title="用户">
          <div class="icon">
            <div class="imageBox">
              <img src="@/assets/images/brand/favicon.png" alt="" />
            </div>
          </div>
          <div class="text">ME</div>
        </router-link>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import AppSettingsMenu from '@/components/AppSettingsMenu.vue'
import { useCapabilities } from '@/composables/useCapabilities'
import { gsap, easeMap } from '@/composables/useGsap'

const rootEl = ref<HTMLElement | null>(null)
const route = useRoute()

let cleanupHover: (() => void) | null = null

onMounted(() => {
  const el = rootEl.value
  if (!el) return
  const q = gsap.utils.selector(el)

  // 导航图标入场：品牌 + 导航项依次淡入
  gsap.timeline({ defaults: { ease: easeMap.out } })
    .from(q('#logo'), { autoAlpha: 0, duration: 0.3 })
    .from(q('.nav li:not(#logo):not(.spacer)'), { autoAlpha: 0, duration: 0.3, stagger: 0.04 }, '-=0.15')

  // 侧边栏 hover 错落展开
  const hoverTl = gsap.timeline({ paused: true })
  hoverTl
    .to(el, { width: 300, duration: 0.35, ease: easeMap.out })
    .to(q('.text'), {
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
.shell {
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

.shell ul {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.shell ul li {
  position: relative;
  padding: 4px 5px;
}

.shell ul li.spacer {
  flex: 1;
}

/* ── Active cut-corner effect ── */
.active {
  background: var(--bg-primary, #e4e9f5);
  border-top-left-radius: 50px;
  border-bottom-left-radius: 50px;
}

.active::before {
  content: "";
  position: absolute;
  top: -24px;
  right: 0;
  width: 24px;
  height: 24px;
  border-bottom-right-radius: 20px;
  box-shadow: 5px 5px 0 5px var(--bg-primary, #e4e9f5);
  background: transparent;
  pointer-events: none;
}

.active::after {
  content: "";
  position: absolute;
  bottom: -24px;
  right: 0;
  width: 24px;
  height: 24px;
  border-top-right-radius: 20px;
  box-shadow: 5px -5px 0 5px var(--bg-primary, #e4e9f5);
  background: transparent;
  pointer-events: none;
}

#logo {
  margin: 20px 0 24px 0;
}

.shell ul li a,
.shell ul li button {
  position: relative;
  display: flex;
  white-space: nowrap;
  width: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  align-items: center;
  font-family: inherit;
  text-decoration: none;
  padding: 0;
}

.icon {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 36px;
  height: 52px;
  color: var(--accent, rgb(110, 90, 240));
  transition: color 0.5s;
}

.text {
  position: relative;
  height: 52px;
  display: flex;
  align-items: center;
  font-size: 15px;
  color: var(--text-primary, #333);
  padding-left: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color 0.5s;
  font-weight: 800;
  font-family: var(--font-display);
  overflow: hidden;
  white-space: nowrap;
  max-width: 0;
  opacity: 0;
}

/* ── Hover warm accent ── */
.shell ul li:hover a .icon,
.shell ul li:hover a .text,
.shell ul li:hover button .icon,
.shell ul li:hover button .text {
  color: #ffa117;
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
</style>