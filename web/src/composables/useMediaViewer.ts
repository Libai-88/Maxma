// web/src/composables/useMediaViewer.ts
import { ref, computed } from 'vue'

export interface MediaItem {
  src: string
  alt?: string
}

// 模块级状态（全局单例，所有组件共享）
const items = ref<MediaItem[]>([])
const currentIndex = ref(-1)
const isOpen = computed(() => currentIndex.value >= 0)
const currentItem = computed(() =>
  currentIndex.value >= 0 ? items.value[currentIndex.value] : null
)

function open(list: MediaItem[], startIndex = 0) {
  if (!list.length) return
  items.value = list
  currentIndex.value = Math.max(0, Math.min(startIndex, list.length - 1))
}

function close() {
  currentIndex.value = -1
}

function next() {
  if (currentIndex.value < items.value.length - 1) currentIndex.value++
}

function prev() {
  if (currentIndex.value > 0) currentIndex.value--
}

export function useMediaViewer() {
  return { items, currentIndex, isOpen, currentItem, open, close, next, prev }
}
