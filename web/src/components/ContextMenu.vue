<template>
  <Teleport to="body">
    <div
      v-show="visible"
      class="context-backdrop"
      @click="close"
      @contextmenu.prevent="close"
    >
      <Transition
        :css="false"
        @before-enter="onBeforeEnter"
        @enter="onEnter"
        @leave="onLeave"
      >
        <div
          v-if="visible"
          ref="menuRef"
          role="menu"
          class="context-menu"
          @click.stop
          @contextmenu.stop
        >
          <button
            v-for="(item, idx) in items"
            :key="item.action"
            role="menuitem"
            :data-index="idx"
            class="context-menu-item"
            @click="select(item.action)"
          >
            <Icon v-if="item.icon" :name="item.icon" :size="14" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import { onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { gsap, useGsap } from '@/composables/useGsap'

export interface ContextMenuItem {
  label: string
  action: string
  icon?: string
}

export interface ContextMenuPosition {
  x: number
  y: number
}

const props = defineProps<{
  position: ContextMenuPosition
  items: ContextMenuItem[]
  visible: boolean
}>()

const emit = defineEmits<{
  select: [action: string]
  close: []
}>()

const menuRef = ref<HTMLElement | null>(null)

// CSP-safe CSSOM: position menu via style.setProperty (was :style binding)
watchEffect(() => {
  const el = menuRef.value
  if (!el || !props.visible) return
  el.style.setProperty('left', `${props.position.x}px`)
  el.style.setProperty('top', `${props.position.y}px`)
}, { flush: 'post' })

function getMenuItems(): HTMLElement[] {
  if (!menuRef.value) return []
  return Array.from(menuRef.value.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function focusItem(index: number) {
  const items = getMenuItems()
  const target = items[index]
  if (target) target.focus()
}

function select(action: string) {
  emit('select', action)
}

function close() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowDown':
      e.preventDefault()
      {
        const items = getMenuItems()
        const current = document.activeElement
        const idx = current ? items.indexOf(current as HTMLElement) : -1
        const next = (idx + 1) % items.length
        focusItem(next)
      }
      break
    case 'ArrowUp':
      e.preventDefault()
      {
        const items = getMenuItems()
        const current = document.activeElement
        const idx = current ? items.indexOf(current as HTMLElement) : -1
        const prev = (idx - 1 + items.length) % items.length
        focusItem(prev)
      }
      break
    case 'Home':
      e.preventDefault()
      focusItem(0)
      break
    case 'End':
      e.preventDefault()
      {
        const items = getMenuItems()
        if (items.length > 0) focusItem(items.length - 1)
      }
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      {
        const current = document.activeElement as HTMLElement | null
        if (current && current.getAttribute('role') === 'menuitem') {
          current.click()
        }
      }
      break
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

// ── 弹层动画：锚定左上角的 scale 弹出 + 菜单项 stagger（JS 过渡钩子，:css=false） ──
let onBeforeEnter = (_el: Element) => {}
let onEnter = (_el: Element, done: () => void) => done()
let onLeave = (_el: Element, done: () => void) => done()

useGsap((_ctx, contextSafe) => {
  function beforeEnter(el: Element) {
    gsap.set(el, { opacity: 0, scale: 0.92, transformOrigin: '0px 0px' })
  }
  function enter(el: Element, done: () => void) {
    gsap.to(el, { opacity: 1, scale: 1, duration: 0.16, ease: 'power2.out', onComplete: done })
    const items = gsap.utils.toArray<HTMLElement>('[role="menuitem"]', el as HTMLElement)
    if (items.length) {
      gsap.from(items, { y: 6, opacity: 0, duration: 0.16, ease: 'power2.out', stagger: 0.03 })
    }
  }
  function leave(el: Element, done: () => void) {
    gsap.to(el, { opacity: 0, scale: 0.96, duration: 0.1, ease: 'power1.in', onComplete: done })
  }
  // 这些回调在交互时触发，用 contextSafe 包裹以随 ctx.revert() 撤销
  onBeforeEnter = contextSafe(beforeEnter)
  onEnter = contextSafe(enter)
  onLeave = contextSafe(leave)
})
</script>

<style scoped>
.context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.context-menu {
  position: fixed;
  z-index: 1001;
  min-width: 120px;
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--bg-card) 70%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid transparent;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  padding: 4px 0;
  transform-origin: top left;
}

.context-menu::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.244);
  pointer-events: none;
  z-index: -1;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.12s, transform 0.1s;
}

.context-menu-item:hover {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.context-menu-item:active {
  transform: scale(0.96);
}

/* 弹出动画由 GSAP JS 过渡钩子控制（:css=false） */
</style>
