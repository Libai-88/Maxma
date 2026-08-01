<template>
  <div class="file-grid" :class="densityClass">
    <!-- 表情引用 -->
    <div
      v-for="seg in stickers"
      :key="'sticker-' + seg.occurrenceKey"
      class="file-grid-card sticker-card"
      :title="seg.path"
    >
      <div class="card-thumb">
        <img :src="seg.src" :alt="seg.filename" class="card-img" />
      </div>
      <div class="card-body">
        <span class="card-label">{{ seg.category || '表情' }}</span>
        <span class="card-badge sticker-badge">表情</span>
      </div>
      <button type="button" class="card-remove" :aria-label="`移除表情 ${seg.category || '表情'}`" title="移除表情" @click="$emit('removeSticker', seg)">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <!-- 图片引用 -->
    <div
      v-for="(r, idx) in images"
      :key="'img-' + idx"
      class="file-grid-card image-card"
      :title="r.label"
    >
      <div class="card-thumb">
        <img :src="r.preview" :alt="r.label" class="card-img" />
      </div>
      <div class="card-body">
        <span class="card-label">{{ r.label }}</span>
        <span class="card-badge image-badge">图片</span>
      </div>
      <button type="button" class="card-remove" :aria-label="`移除图片 ${r.label}`" title="移除图片" @click="$emit('removeImage', r)">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <!-- 其他文件引用 -->
    <div
      v-for="(r, idx) in files"
      :key="r.type + r.label + idx"
      class="file-grid-card file-card"
      :class="{ blocked: 'blocked' in r && r.blocked }"
      :title="getTooltip(r)"
    >
      <div class="card-thumb card-thumb-icon">
        <Icon :name="getIcon(r)" :size="20" />
      </div>
      <div class="card-body">
        <span class="card-label">{{ r.label }}</span>
        <div class="card-badges">
          <span class="card-badge type-badge">{{ r.type }}</span>
          <span v-if="'blocked' in r && r.blocked" class="card-badge blocked-badge">blocked</span>
        </div>
      </div>
      <button type="button" class="card-remove" :aria-label="`移除引用 ${r.label}`" title="移除引用" @click="$emit('removeFile', getFileIndex(r))">
        <Icon name="close" :size="12" />
      </button>
    </div>
    <!-- 空状态 -->
    <div v-if="empty" class="file-grid-empty">
      <Icon name="upload" :size="24" />
      <span>拖拽或点击添加文件</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import type { ParsedRef, ImageRef } from '@/utils/references'
import type { StickerSegment } from '@/composables/useStickerSegments'
import { REF_CHIP_CONFIG } from '@/utils/references'

const props = withDefaults(defineProps<{
  stickers?: StickerSegment[]
  images?: ImageRef[]
  files?: ParsedRef[]
  density?: 'compact' | 'comfortable'
}>(), {
  stickers: () => [],
  images: () => [],
  files: () => [],
  density: 'compact',
})

defineEmits<{
  removeSticker: [seg: StickerSegment]
  removeImage: [ref: ImageRef]
  removeFile: [index: number]
}>()

const densityClass = computed(() =>
  props.density === 'comfortable' ? 'density-comfortable' : 'density-compact'
)

const empty = computed(() =>
  props.stickers.length === 0 && props.images.length === 0 && props.files.length === 0
)

function getIcon(r: ParsedRef): string {
  return REF_CHIP_CONFIG[r.type]?.icon ?? 'file'
}

function getTooltip(r: ParsedRef): string {
  const base = REF_CHIP_CONFIG[r.type]?.tooltip(r) ?? r.label
  if ('blocked' in r && r.blocked) {
    return `${base}\n已阻挡：${(r as any).blockedReason || '路径被阻挡，无法访问'}`
  }
  return base
}

function getFileIndex(r: ParsedRef): number {
  return props.files.indexOf(r)
}
</script>

<style scoped>
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
  width: 100%;
}

.density-comfortable {
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

/* ── 卡片 ── */
.file-grid-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.file-grid-card:hover {
  border-color: var(--accent);
  background: var(--bg-card);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.file-grid-card.blocked {
  border-color: var(--status-error);
  opacity: 0.75;
}

/* ── 缩略图区域 ── */
.card-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
}

.card-thumb-icon {
  color: var(--text-secondary);
  aspect-ratio: auto;
  height: 48px;
}

.card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── 卡片正文 ── */
.card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  min-width: 0;
}

.card-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.card-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  padding: 0 5px;
  height: 16px;
  border-radius: 4px;
  line-height: 1;
}

.sticker-badge {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.image-badge {
  background: color-mix(in srgb, #22c55e 12%, transparent);
  color: #22c55e;
}

.type-badge {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.blocked-badge {
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
  color: var(--status-error);
}

/* ── 删除按钮 ── */
.card-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  backdrop-filter: blur(4px);
  color: var(--text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, transform 0.1s;
}

.file-grid-card:hover .card-remove {
  opacity: 1;
}

.card-remove:hover {
  color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-primary));
}

.card-remove:active {
  transform: scale(0.85);
}

/* ── 空状态 ── */
.file-grid-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--text-tertiary);
  font-size: 13px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}
</style>