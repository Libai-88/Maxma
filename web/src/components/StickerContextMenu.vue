<template>
  <div
    v-if="visible"
    ref="menuRef"
    class="sticker-context-menu"
    @click.stop
  >
    <button class="menu-item" @click="onToggleFavorite" @mouseenter="bounceIcon($event)">
      <Icon class="menu-icon" :name="isFavorited ? 'star-filled' : 'star'" :size="16" />
      <span>{{ isFavorited ? '取消收藏' : '收藏' }}</span>
    </button>
    <button class="menu-item" @click="onCopyPath" @mouseenter="bounceIcon($event)">
      <Icon class="menu-icon" name="copy" :size="16" />
      <span>复制路径</span>
    </button>
    <button class="menu-item" @click="onReduceRecommendation" @mouseenter="bounceIcon($event)">
      <Icon class="menu-icon" name="minus" :size="16" />
      <span>减少推荐</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, watchEffect } from 'vue'
import { getApiBase, tauriFetch } from '@/utils/env'
import Icon from '@/components/Icon.vue'
import { createLogger } from '@/utils/logger'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

const log = createLogger('StickerContextMenu')

interface Sticker {
  category: string
  filename: string
  path: string
}

const props = defineProps<{
  visible: boolean
  position: { x: number; y: number }
  sticker: Sticker | null
}>()

const emit = defineEmits<{
  close: []
  refresh: []
}>()

const isFavorited = ref(false)
const loading = ref(false)

const menuRef = ref<HTMLElement | null>(null)

// 弹出面板入场：从锚点（左上）scale pop + fade（visible 变 true 时播放）
useGsap((_ctx, contextSafe) => {
  watch(() => props.visible, contextSafe((vis) => {
    if (!vis) return
    const el = menuRef.value
    if (!el) return
    gsap.fromTo(el,
      { opacity: 0, scale: 0.95, y: -4, transformOrigin: 'top left' },
      { opacity: 1, scale: 1, y: 0, duration: 0.18, ease: easeMap.out },
    )
  }), { immediate: true, flush: 'post' })
})

// CSP-safe CSSOM: position menu via style.setProperty (was :style binding)
watchEffect(() => {
  const el = menuRef.value
  if (!el || !props.visible) return
  el.style.setProperty('left', `${props.position.x}px`)
  el.style.setProperty('top', `${props.position.y}px`)
}, { flush: 'post' })

// 菜单项 hover：图标弹性蹦跳，反馈「可操作」
function bounceIcon(e: MouseEvent) {
  const icon = (e.currentTarget as HTMLElement).querySelector('.menu-icon')
  if (!icon) return
  gsap.fromTo(icon,
    { scale: 1, rotation: 0 },
    { scale: 1.35, rotation: 10, duration: 0.25, ease: 'elastic.out(1, 0.5)', yoyo: true, repeat: 1 })
}

// 检查是否已收藏
async function checkFavoriteStatus() {
  if (!props.sticker) return
  
  try {
    const res = await tauriFetch(`${getApiBase()}/stickers/favorites`)
    const data = await res.json()
    const favorites = data.favorites || []
    isFavorited.value = favorites.some(
      (f: { filename: string; category: string }) => f.filename === props.sticker?.filename && f.category === props.sticker?.category
    )
  } catch (err) {
    log.error('检查收藏状态失败:', err)
  }
}

// 切换收藏
async function onToggleFavorite() {
  if (!props.sticker || loading.value) return
  
  loading.value = true
  try {
    if (isFavorited.value) {
      // 取消收藏
      await tauriFetch(`${getApiBase()}/stickers/favorites?filename=${encodeURIComponent(props.sticker.filename)}&category=${encodeURIComponent(props.sticker.category)}`, {
        method: 'DELETE'
      })
      isFavorited.value = false
    } else {
      // 添加收藏
      await tauriFetch(`${getApiBase()}/stickers/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: props.sticker.category,
          filename: props.sticker.filename
        })
      })
      isFavorited.value = true
    }
    emit('refresh')
  } catch (err) {
    log.error('收藏操作失败:', err)
  } finally {
    loading.value = false
    emit('close')
  }
}

// 复制路径
function onCopyPath() {
  if (!props.sticker) return
  
  const path = `${getApiBase()}/stickers/${props.sticker.path}`
  navigator.clipboard.writeText(path).then(() => {
    emit('close')
  }).catch(err => {
    log.error('复制失败:', err)
  })
}

async function onReduceRecommendation() {
  if (!props.sticker || loading.value) return

  loading.value = true
  try {
    await tauriFetch(`${getApiBase()}/stickers/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: props.sticker.category,
        filename: props.sticker.filename
      })
    })
    emit('refresh')
  } catch (err) {
    log.error('减少推荐失败:', err)
  } finally {
    loading.value = false
    emit('close')
  }
}

// 监听 sticker 变化，更新收藏状态
watch(() => props.sticker, () => {
  if (props.sticker) {
    checkFavoriteStatus()
  }
}, { immediate: true })
</script>

<style scoped>
.sticker-context-menu {
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  z-index: 1000;
  min-width: 140px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.9em;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s;
  text-align: left;
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-icon {
  width: 20px;
  text-align: center;
}
</style>
