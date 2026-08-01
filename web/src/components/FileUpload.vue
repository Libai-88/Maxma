<template>
  <div
    class="file-upload-zone"
    :class="[borderClass, { 'is-dragover': isDragover }]"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 拖拽提示浮层 -->
    <Transition name="drop-hint">
      <div v-if="isDragover" class="drop-hint">
        <Icon name="upload" :size="24" />
        <span class="drop-hint-text">释放以上传文件</span>
      </div>
    </Transition>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{
  border?: 'dashed' | 'solid'
  dragover?: boolean
}>(), {
  border: 'dashed',
  dragover: false,
})

const internalDragover = ref(false)
let dragCounter = 0

const isDragover = computed(() => props.dragover || internalDragover.value)

const borderClass = computed(() => [
  props.border === 'dashed' ? 'border-dashed' : 'border-solid',
])

function onDragEnter() {
  dragCounter++
  internalDragover.value = true
}

function onDragOver() {
  // 保持 isDragover 状态
}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    internalDragover.value = false
  }
}

function onDrop(_e: DragEvent) {
  internalDragover.value = false
  dragCounter = 0
}
</script>

<style scoped>
.file-upload-zone {
  position: relative;
  border-radius: 10px;
  border: 2px solid var(--border);
  transition: border-color 0.25s ease, background 0.25s ease;
  background: transparent;
}

.file-upload-zone.is-dragover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

/* 拖拽提示浮层 */
.drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 10;
  background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
  backdrop-filter: blur(4px);
  border-radius: 10px;
  color: var(--accent);
}

.drop-hint-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* 过渡动画 */
.drop-hint-enter-active {
  transition: opacity 0.2s ease;
}
.drop-hint-leave-active {
  transition: opacity 0.15s ease;
}
.drop-hint-enter-from,
.drop-hint-leave-to {
  opacity: 0;
}
</style>