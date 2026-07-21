<template>
  <div
    class="sticker-picker"
    :class="{ visible }"
    ref="pickerRootRef"
    @click.stop
  >
    <!-- 搜索框 + 上传按钮 -->
    <div class="picker-search">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        placeholder="搜索表情..."
        class="search-input"
        @input="onSearch"
        @keydown="onSearchKeydown"
      />
      <button class="upload-btn" @click="triggerUpload" title="上传自定义表情">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        class="file-input-hidden"
        @change="onFileSelected"
      />
    </div>
    <div v-if="searchSuggestions.length" class="search-suggestions">
      <button
        v-for="suggestion in searchSuggestions"
        :key="suggestion"
        class="suggestion-chip"
        @click="applySuggestion(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>

    <!-- Tab 切换 -->
    <div class="picker-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        @click="setActiveTab(tab.id)"
      >
        {{ tab.label }}
        <span v-if="tab.count !== null" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <section v-if="recommendedStickers.length" class="recommended-strip">
      <div class="recommended-title">
        <span>推荐</span>
        <small>{{ recommendationReason }}</small>
      </div>
      <div class="recommended-list">
        <button
          v-for="sticker in recommendedStickers"
          :key="sticker.path"
          class="recommended-item"
          :title="sticker.category"
          @click="selectSticker(sticker)"
          @contextmenu.prevent="onContextMenu($event, sticker)"
        >
          <img :src="getStickerUrl(sticker)" :alt="sticker.filename" loading="lazy" />
        </button>
      </div>
    </section>

    <div v-if="activeTab === 'favorites' && favoriteStickers.length > 1" class="sort-row">
      <span>收藏排序</span>
      <button :class="{ active: favoriteSort === 'recent' }" @click="favoriteSort = 'recent'">最近</button>
      <button :class="{ active: favoriteSort === 'usage' }" @click="favoriteSort = 'usage'">常用</button>
    </div>

    <!-- 表情网格 -->
    <div
      class="picker-grid"
      ref="gridEl"
      :class="{ 'drag-over': isDragOver }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div
        v-for="(sticker, index) in filteredStickers"
        :key="sticker.path"
        class="sticker-item"
        :class="{ highlighted: highlightedStickerIndex === index }"
        :data-sticker-index="index"
        @click="selectSticker(sticker)"
        @mouseenter="highlightedStickerIndex = index"
        @contextmenu.prevent="onContextMenu($event, sticker)"
      >
        <img
          :src="getStickerUrl(sticker)"
          :alt="sticker.filename"
          class="sticker-thumb"
          loading="lazy"
        />
      </div>
      <div v-if="filteredStickers.length === 0" class="empty-state">
        {{ emptyMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { getApiBase, tauriFetch } from '@/utils/env'

export interface Sticker {
  category: string
  filename: string
  path: string
  added_at?: string
  usage_count?: number
}

const props = defineProps<{
  visible: boolean
  contextText?: string
}>()

const emit = defineEmits<{
  select: [sticker: Sticker]
  close: []
  contextmenu: [event: MouseEvent, sticker: Sticker]
}>()

const searchQuery = ref('')
const activeTab = ref<'recent' | 'favorites' | 'all'>('all')
const gridEl = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const isUploading = ref(false)
const favoriteSort = ref<'recent' | 'usage'>('recent')
const highlightedStickerIndex = ref(0)
const dismissedSuggestionQuery = ref('')

// 数据
const allStickers = ref<Sticker[]>([])
const recentStickers = ref<Sticker[]>([])
const favoriteStickers = ref<Sticker[]>([])
const recommendedStickers = ref<Sticker[]>([])
const pickerRootRef = ref<HTMLElement | null>(null)
let recommendationTimer: number | null = null

// Tab 配置 — 使用 getter 确保响应式更新
const tabs = computed(() => [
  { id: 'recent' as const, label: '最近', get count() { return recentStickers.value.length } },
  { id: 'favorites' as const, label: '收藏', get count() { return favoriteStickers.value.length } },
  { id: 'all' as const, label: '全部', get count() { return allStickers.value.length } },
])

// 空状态消息
const emptyMessage = computed(() => {
  if (searchQuery.value) return '没有找到匹配的表情'
  if (activeTab.value === 'recent') return '还没有使用记录'
  if (activeTab.value === 'favorites') return '还没有收藏，长按表情可收藏'
  return '表情库为空'
})

const categories = computed(() => Array.from(new Set(allStickers.value.map(s => s.category))).sort())

const searchSuggestions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query || dismissedSuggestionQuery.value === query) return []

  const categoryHits = categories.value.filter(category => category.toLowerCase().includes(query))
  const filenameHits = allStickers.value
    .map(sticker => sticker.filename.replace(/\.webp$/i, ''))
    .filter(name => name.toLowerCase().includes(query))
    .slice(0, 4)

  return Array.from(new Set([...categoryHits, ...filenameHits])).slice(0, 6)
})

const sortedFavoriteStickers = computed(() => {
  const stickers = [...favoriteStickers.value]
  if (favoriteSort.value === 'usage') {
    return stickers.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
  }
  return stickers.sort((a, b) => {
    const bTime = b.added_at ? new Date(b.added_at).getTime() : 0
    const aTime = a.added_at ? new Date(a.added_at).getTime() : 0
    return bTime - aTime
  })
})

const recommendationReason = computed(() => {
  const text = props.contextText?.trim()
  if (text) return '根据当前输入'
  return '根据时间和偏好'
})

// 过滤后的表情列表
const filteredStickers = computed(() => {
  let stickers: Sticker[] = []
  
  if (activeTab.value === 'recent') {
    stickers = recentStickers.value
  } else if (activeTab.value === 'favorites') {
    stickers = sortedFavoriteStickers.value
  } else {
    stickers = allStickers.value
  }
  
  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    stickers = stickers.filter(s =>
      s.filename.toLowerCase().includes(query) ||
      s.category.toLowerCase().includes(query)
    )
  }
  
  return stickers
})

// 获取表情 URL
function getStickerUrl(sticker: Sticker): string {
  return `${getApiBase()}/stickers/${sticker.path}`
}

// ── 上传功能 ──────────────────────────────────────────────

function triggerUpload() {
  fileInputRef.value?.click()
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  await uploadFile(input.files[0])
  input.value = ''  // 重置，允许重复选择同一文件
}

async function uploadFile(file: File) {
  if (isUploading.value) return
  isUploading.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    const res = await tauriFetch(`${getApiBase()}/stickers/upload`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json()
    if (data.success) {
      // 刷新列表
      await loadData()
      // 切换到全部 Tab 查看新上传的表情
      activeTab.value = 'all'
    } else {
      console.error('[StickerPicker] 上传失败:', data)
    }
  } catch (err) {
    console.error('[StickerPicker] 上传错误:', err)
  } finally {
    isUploading.value = false
  }
}

// 拖拽上传
let dragCounter = 0

function onDragEnter() {
  dragCounter++
  isDragOver.value = true
}

function onDragOver() {}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    isDragOver.value = false
  }
}

async function onDrop(e: DragEvent) {
  isDragOver.value = false
  dragCounter = 0
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      await uploadFile(file)
    }
  }
}

// 选择表情
function selectSticker(sticker: Sticker) {
  console.log('[StickerPicker] selectSticker called with:', sticker)
  emit('select', sticker)
}

// 右键菜单
function onContextMenu(event: MouseEvent, sticker: Sticker) {
  console.log('[StickerPicker] onContextMenu called with:', sticker)
  emit('contextmenu', event, sticker)
}

// 搜索处理
function onSearch() {
  dismissedSuggestionQuery.value = ''
  // 搜索时自动切换到全部 Tab
  if (searchQuery.value && activeTab.value !== 'all') {
    activeTab.value = 'all'
  }
}

function applySuggestion(suggestion: string) {
  searchQuery.value = suggestion
  dismissedSuggestionQuery.value = suggestion.trim().toLowerCase()
  setActiveTab('all')
}

function setActiveTab(tab: 'recent' | 'favorites' | 'all') {
  activeTab.value = tab
  highlightedStickerIndex.value = 0
}

function scrollHighlightedIntoView() {
  nextTick(() => {
    const grid = gridEl.value
    if (!grid) return
    const item = grid.querySelector<HTMLElement>(`[data-sticker-index="${highlightedStickerIndex.value}"]`)
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

function moveHighlight(delta: number) {
  const total = filteredStickers.value.length
  if (total === 0) return
  highlightedStickerIndex.value = (highlightedStickerIndex.value + delta + total) % total
  scrollHighlightedIntoView()
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (searchSuggestions.value.length > 0) {
      dismissedSuggestionQuery.value = searchQuery.value.trim().toLowerCase()
      return
    }
    emit('close')
    return
  }

  if (filteredStickers.value.length === 0) return

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveHighlight(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveHighlight(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-4)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(4)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const sticker = filteredStickers.value[highlightedStickerIndex.value]
    if (sticker) selectSticker(sticker)
  }
}

function scheduleRecommendations() {
  if (recommendationTimer !== null) {
    window.clearTimeout(recommendationTimer)
  }
  recommendationTimer = window.setTimeout(loadRecommendations, 180)
}

async function loadRecommendations() {
  recommendationTimer = null
  try {
    const params = new URLSearchParams({
      text: props.contextText || searchQuery.value || '',
      limit: '4',
    })
    const res = await tauriFetch(`${getApiBase()}/stickers/recommendations?${params.toString()}`)
    const data = await res.json()
    recommendedStickers.value = data.recommendations || []
  } catch (err) {
    console.warn('[StickerPicker] 加载推荐表情失败:', err)
  }
}

function updatePickerPosition() {
  nextTick(() => {
    const root = pickerRootRef.value
    if (!root || !props.visible) return
    const rect = root.getBoundingClientRect()
    let shift = 0
    if (rect.left < 12) {
      shift = 12 - rect.left
    } else if (rect.right > window.innerWidth - 12) {
      shift = window.innerWidth - 12 - rect.right
    }
    // CSP-safe CSSOM: was reactive :style pickerStyle
    root.style.setProperty('transform', shift ? `translateX(${shift}px)` : '')
    root.style.setProperty('max-width', 'calc(100vw - 24px)')
  })
}

// 加载数据
async function loadData() {
  console.log('[StickerPicker] loadData called')
  try {
    const [allResult, recentResult, favResult] = await Promise.allSettled([
      tauriFetch(`${getApiBase()}/stickers/index`),
      tauriFetch(`${getApiBase()}/stickers/recent`),
      tauriFetch(`${getApiBase()}/stickers/favorites`),
    ])

    const allData =
      allResult.status === 'fulfilled'
        ? await allResult.value.json()
        : { index: {} }
    const recentData =
      recentResult.status === 'fulfilled'
        ? await recentResult.value.json()
        : { recent: [] }
    const favData =
      favResult.status === 'fulfilled'
        ? await favResult.value.json()
        : { favorites: [] }

    if (allResult.status === 'rejected') {
      console.warn('[StickerPicker] 加载全部表情失败:', allResult.reason)
    }
    if (recentResult.status === 'rejected') {
      console.warn('[StickerPicker] 加载最近表情失败:', recentResult.reason)
    }
    if (favResult.status === 'rejected') {
      console.warn('[StickerPicker] 加载收藏表情失败:', favResult.reason)
    }

    console.log('[StickerPicker] Loaded stickers:', {
      all: Object.keys(allData.index || {}).length,
      recent: recentData.recent?.length || 0,
      favorites: favData.favorites?.length || 0
    })

    allStickers.value = Object.values(allData.index || {}) as Sticker[]
    recentStickers.value = dedupeStickersByPath(recentData.recent || [])
    favoriteStickers.value = dedupeStickersByPath(favData.favorites || [])
    await loadRecommendations()
    updatePickerPosition()
  } catch (err) {
    console.error('[StickerPicker] 加载表情数据失败:', err)
  }
}

// 点击外部关闭 — 使用根元素
function handleClickOutside(event: MouseEvent) {
  if (!props.visible) return
  const root = pickerRootRef.value
  if (root && !root.contains(event.target as Node)) {
    emit('close')
  }
}

// 安全网：visible 变为 true 时也加载数据
watch(() => props.visible, (newVal) => {
  if (newVal && allStickers.value.length === 0) {
    loadData()
  } else if (newVal) {
    scheduleRecommendations()
    updatePickerPosition()
    highlightedStickerIndex.value = 0
    nextTick(() => searchInputRef.value?.focus())
  }
})

watch(() => props.contextText, () => {
  if (props.visible) scheduleRecommendations()
})

watch(filteredStickers, (stickers) => {
  if (stickers.length === 0) {
    highlightedStickerIndex.value = 0
    return
  }
  if (highlightedStickerIndex.value >= stickers.length) {
    highlightedStickerIndex.value = 0
  }
  scrollHighlightedIntoView()
})

onMounted(() => {
  loadData()
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', updatePickerPosition)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', updatePickerPosition)
  if (recommendationTimer !== null) window.clearTimeout(recommendationTimer)
})

// 暴露刷新方法
defineExpose({
  refresh: loadData
})

function dedupeStickersByPath(stickers: Sticker[]): Sticker[] {
  const seen = new Set<string>()
  return stickers.filter(sticker => {
    if (seen.has(sticker.path)) return false
    seen.add(sticker.path)
    return true
  })
}
</script>

<style scoped>
.sticker-picker {
  position: absolute;
  bottom: 100%;
  right: 0;
  width: 320px;
  max-height: 400px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  display: none;
  flex-direction: column;
  z-index: 100;
  margin-bottom: 8px;
}
.sticker-picker.visible {
  display: flex;
}

.picker-search {
  padding: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: var(--accent);
}

.upload-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s var(--ease-out),
              color 0.15s var(--ease-out);
}

.upload-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-color: var(--accent);
}

.file-input-hidden {
  display: none;
}

.search-suggestions {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
  overflow-x: auto;
}

.suggestion-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 9px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.75em;
  white-space: nowrap;
  cursor: pointer;
}

.suggestion-chip:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.picker-tabs {
  display: flex;
  padding: 8px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  border-top: 1px solid var(--border);
}

.tab-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.85em;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.2s var(--ease-out),
              color 0.2s var(--ease-out);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.tab-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--accent);
  color: white;
}

.tab-count {
  font-size: 0.75em;
  opacity: 0.7;
}

.recommended-strip {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

.recommended-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--text-primary);
  font-size: 0.82em;
  font-weight: 600;
}

.recommended-title small {
  color: var(--text-secondary);
  font-size: 0.85em;
  font-weight: 400;
}

.recommended-list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.recommended-item {
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 10px;
  background: var(--bg-card);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.recommended-item:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

.recommended-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sort-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 0;
  color: var(--text-secondary);
  font-size: 0.78em;
}

.sort-row button {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.sort-row button.active {
  border-color: var(--accent);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text-primary);
}

.picker-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  max-height: 300px;
  transition: background 0.15s;
}

.picker-grid.drag-over {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 2px dashed var(--accent);
  border-radius: 8px;
}

.sticker-item {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s var(--ease-out),
              transform 0.15s var(--ease-out);
  background: var(--bg-secondary);
}

.sticker-item:hover {
  background: var(--bg-hover);
  transform: scale(1.05);
}

.sticker-item.highlighted {
  outline: 2px solid transparent;
  outline: 2px solid color-mix(in srgb, var(--accent) 42%, transparent);
  outline-offset: 1px;
  background: var(--bg-secondary);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
}

.sticker-thumb {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 6px;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 0.9em;
}

/* 滚动条样式 */
.picker-grid::-webkit-scrollbar {
  width: 6px;
}

.picker-grid::-webkit-scrollbar-track {
  background: transparent;
}

.picker-grid::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.picker-grid::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

@media (prefers-reduced-motion: reduce) {
  .upload-btn,
  .tab-btn,
  .recommended-item,
  .picker-grid,
  .sticker-item {
    transition: none;
  }

  .recommended-item:hover,
  .sticker-item:hover {
    transform: none;
  }
}
</style>
