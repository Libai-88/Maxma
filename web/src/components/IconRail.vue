<template>
  <aside class="icon-rail" aria-label="主导航">
    <router-link
      to="/"
      class="icon-rail__brand icon-rail__control"
      style="min-width: 44px; min-height: 44px"
      aria-label="Maxma"
      title="Maxma"
      exact-active-class="is-active"
    >
      <img src="@/assets/images/brand/favicon.png" alt="" class="icon-rail__brand-mark" />
    </router-link>

    <nav class="icon-rail__nav" aria-label="主导航">
      <router-link
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="icon-rail__control icon-rail__nav-item"
        style="min-width: 44px; min-height: 44px"
        :aria-label="item.label"
        :title="item.label"
        exact-active-class="is-active"
      >
        <Icon :name="item.icon" :size="20" />
      </router-link>
    </nav>

    <div class="icon-rail__footer">
      <AppSettingsMenu
        compact
        :onboarding-enabled="onboardingEnabled"
        @restart-onboarding="emit('restart-onboarding')"
      />
      <button
        type="button"
        class="icon-rail__control icon-rail__session-toggle"
        style="min-width: 44px; min-height: 44px"
        aria-label="会话"
        title="会话"
        @click="emit('toggle-session-drawer')"
      >
        <Icon name="sessions" :size="20" />
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import AppSettingsMenu from '@/components/AppSettingsMenu.vue'

withDefaults(defineProps<{
  onboardingEnabled: boolean
}>(), {
  onboardingEnabled: false,
})

const emit = defineEmits<{
  (event: 'toggle-session-drawer'): void
  (event: 'restart-onboarding'): void
}>()

const navItems = [
  { to: '/', label: '对话', icon: 'chat' },
  { to: '/activity', label: '活动', icon: 'activity' },
  { to: '/help', label: '帮助', icon: 'help' },
] as const
</script>

<style scoped>
.icon-rail {
  position: sticky;
  top: 0;
  z-index: 120;
  display: flex;
  flex: 0 0 var(--icon-rail-width, 56px);
  flex-direction: column;
  align-items: center;
  width: var(--icon-rail-width, 56px);
  min-width: var(--icon-rail-width, 56px);
  height: 100%;
  max-height: 100dvh;
  min-height: 0;
  padding: 8px 4px;
  gap: 20px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.icon-rail__control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  min-width: var(--touch-target-min, 44px);
  height: 48px;
  min-height: var(--touch-target-min, 44px);
  flex: 0 0 48px;
  color: inherit;
  border: 0;
  border-radius: var(--radius, 8px);
  background: transparent;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.icon-rail__control:hover,
.icon-rail__control:focus-visible,
.icon-rail__control.is-active {
  color: var(--accent);
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
}

.icon-rail__control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.icon-rail__brand {
  color: var(--accent);
}

.icon-rail__brand-mark {
  width: 30px;
  height: 30px;
  object-fit: cover;
  border-radius: 50%;
}

.icon-rail__nav,
.icon-rail__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.icon-rail__nav {
  flex: 1;
}

.icon-rail__session-toggle {
  color: var(--accent);
}

@media (max-width: 640px) {
  .icon-rail {
    flex-basis: var(--icon-rail-width, 56px);
    width: var(--icon-rail-width, 56px);
    min-width: var(--icon-rail-width, 56px);
  }

  .icon-rail__control {
    width: 48px;
  }
}
</style>
