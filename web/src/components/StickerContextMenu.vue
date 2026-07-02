<template>
  <div
    v-if="visible"
    class="sticker-context-menu"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    @click.stop
  >
    <button class="menu-item" @click="onToggleFavorite">
      <span class="menu-icon">{{ isFavorited ? '★' : '☆' }}</span>
      <span>{{ isFavorited ? '取消收藏' : '收藏' }}</span>
    </button>
    <button class="menu-item" @click="onCopyPath">
      <span class="menu-icon">📋</span>
      <span>复制路径</span>
    </button>
    <button class="menu-item" @click="onReduceRecommendation">
      <span class="menu-icon">−</span>
      <span>减少推荐</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getApiBase, tauriFetch } from '@/utils/env'

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

// 检查是否已收藏
async function checkFavoriteStatus() {
  if (!props.sticker) return
  
  try {
    const res = await tauriFetch(`${getApiBase()}/stickers/favorites`)
    const data = await res.json()
    const favorites = data.favorites || []
    isFavorited.value = favorites.some(
      (f: any) => f.filename === props.sticker?.filename && f.category === props.sticker?.category
    )
  } catch (err) {
    console.error('检查收藏状态失败:', err)
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
    console.error('收藏操作失败:', err)
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
    console.error('复制失败:', err)
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
    console.error('减少推荐失败:', err)
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
  font-size: 1.1em;
  width: 20px;
  text-align: center;
}
</style>
