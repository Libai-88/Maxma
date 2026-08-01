<template>
  <div class="chat-input-wrapper" role="form" aria-label="消息输入">
    <div v-if="connectionError" class="chat-connection-error" role="alert" aria-live="assertive">
      <Icon class="chat-connection-error-icon" name="warning" :size="16" />
      <span class="chat-connection-error-text">{{ connectionError }}</span>
      <button type="button" class="chat-connection-error-close" aria-label="关闭连接错误" title="关闭连接错误" @click="connectionError = null"><Icon name="close" :size="14" /></button>
    </div>
    <div v-if="imageError" class="chat-image-error" role="alert" aria-live="assertive">
      <Icon class="chat-image-error-icon" name="image" :size="16" />
      <span class="chat-image-error-text">{{ imageError }}</span>
      <button type="button" class="chat-image-error-close" aria-label="关闭图片错误" title="关闭图片错误" @click="imageError = null"><Icon name="close" :size="14" /></button>
    </div>
    <div v-if="showLinkInput" class="link-input-wrapper">
      <div class="link-input-bar" role="group" aria-label="添加链接">
        <input
          ref="linkInputRef"
          v-model="linkUrl"
          type="url"
          class="link-input"
          :class="{ 'is-error': linkError }"
          aria-label="链接 URL"
          placeholder="输入链接 URL……"
          :aria-invalid="!!linkError"
          aria-describedby="link-error"
          @input="linkError = null"
          @keydown.enter.prevent="confirmLink"
          @keydown.escape.prevent="cancelLink"
        />
        <button type="button" class="link-input-confirm" aria-label="确认添加链接" title="确认添加链接" :disabled="!linkUrl.trim()" @click="confirmLink"><Icon name="checkmark" :size="14" /></button>
        <button type="button" class="link-input-cancel" aria-label="取消添加链接" title="取消添加链接" @click="cancelLink"><Icon name="close" :size="14" /></button>
      </div>
      <div v-if="linkError" id="link-error" class="link-input-error" role="alert">
        {{ linkError }}
      </div>
    </div>
    <div
      ref="inputContainerRef"
      class="chat-input"
      :class="{ 'is-resizing': isResizing }"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div
        class="resize-handle"
        @pointerdown="startResize"
        title="拖拽调整输入框高度"
      >
        <div class="resize-handle-grip"></div>
      </div>
      <Transition name="thinking-wave-fade">
        <ThinkingWave v-if="isStreaming" />
      </Transition>
      <FileUpload :dragover="isDragover" :border="'dashed'" class="file-upload-area">
        <FileUploadGrid
          v-if="hasFiles"
          :stickers="stickerSegments"
          :images="imageRefs"
          :files="nonImageRefs"
          density="compact"
          @removeSticker="removeStickerSegment"
          @removeImage="(r) => removeRef(getRefIndex(r))"
          @removeFile="removeRef"
        />
      </FileUpload>
      <!-- 已引用选区卡片栏 -->
      <div v-if="quotedSelections.length" class="quoted-selections-bar">
        <QuotedSelectionCard
          v-for="q in quotedSelections"
          :key="q.id"
          :quote="q"
          @remove="chatInput.removeQuote(q.id)"
        />
      </div>
      <div class="input-body" role="group" aria-label="消息内容">
        <textarea
          ref="textareaRef"
          v-model="text"
          class="input-area"
          aria-label="消息内容"
          :placeholder="inputPlaceholder"
          :disabled="disabled"
          rows="1"
          @keydown="onKeydown"
          @input="autoResize"
          @paste="onPaste"
        ></textarea>
      </div>
      <ThinkPathChooser
        v-model="selectedThinkPathId"
        :enabled="thinkPathEnabled"
        :text="text"
        :disabled="disabled || isStreaming"
      />
      <hr class="input-divider" />
      <div class="input-bottom-bar">
        <div class="input-left-group">
          <div class="btn-add-file-wrapper">
          <button
            ref="addFileButtonRef"
            type="button"
            class="btn-add-file"
            :disabled="disabled"
            :class="{ active: showMenu }"
            :title="disabled ? '附件（当前不可用）' : '添加附件：文件、文件夹、图片或链接'"
            :aria-label="showMenu ? '关闭附件菜单' : '添加附件：文件、文件夹、图片或链接'"
            :aria-expanded="showMenu"
            aria-controls="add-file-menu"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <Icon v-if="loading" name="attach" :size="16" class="btn-add-file-spin" />
            <Icon v-else name="attach" :size="16" />
          </button>
          <div v-if="showMenu" ref="addFileMenuRef" id="add-file-menu" class="add-file-menu" role="menu" aria-label="附件类型" @click.stop>
            <button type="button" class="add-file-menu-item" role="menuitem" @click="pickFile">
              <Icon name="menu-file" :size="14" /> 选择文件
            </button>
            <button type="button" class="add-file-menu-item" role="menuitem" @click="pickFolder">
              <Icon name="menu-folder" :size="14" /> 选择文件夹
            </button>
            <button type="button" class="add-file-menu-item" role="menuitem" @click="pickImage">
              <Icon name="image" :size="14" /> 选择图片
            </button>
            <button type="button" class="add-file-menu-item" role="menuitem" @click="startLinkInput">
              <Icon name="link" :size="14" /> 加入链接
            </button>
          </div>
          <div v-if="showMenu" class="menu-backdrop" @click="closeAddFileMenu(true)"></div>
          </div>
          <span class="input-separator"></span>
          <ModelSelector />
        </div>
        <div class="input-right-group">
          <div class="input-actions">
            <ContextUsageBadge />
            <button
              v-if="!isStreaming"
              ref="sendBtnRef"
              type="button"
              class="btn-send"
              :class="{ 'is-success': sendState === 'success', 'is-error': sendState === 'error' }"
              aria-label="发送消息"
              :disabled="(!text.trim() && imageRefs.length === 0) || disabled || noProvider || !canSend"
              :title="sendButtonTitle"
              @click="handleSend"
            >
              <Icon name="send" :size="16" />
            </button>
            <button v-else type="button" class="btn-stop" aria-label="停止生成" title="停止生成" @click="chatInput.stop()">
              <Icon name="stop" :size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- 表情右键菜单 -->
    <StickerContextMenu
      v-if="contextMenuVisible"
      :visible="contextMenuVisible"
      :position="contextMenuPosition"
      :sticker="contextMenuSticker"
      @close="contextMenuVisible = false"
      @refresh="onContextMenuRefresh"
    />
    <AutocompletePanel
      :items="acFiltered"
      :visible="acMode !== null"
      :position="acPosition"
      :active-index="acActiveIndex"
      :filter-text="acFilterText"
      :icon-name="acMode === 'tool' ? 'tool' : 'sparkles'"
      @select="confirmItem"
      @close="acMode = null"
      @update:active-index="acActiveIndex = $event"
    />
    <!-- 选区引用浮层 -->
    <Transition name="quote-pop">
      <button
        v-if="quoteCandidate"
        ref="quoteFloatRef"
        class="quote-float-btn"
        type="button"
        aria-label="引用选中文本"
        @click="chatInput.commitQuote()"
        title="引用选中文本"
      >
        + 引用
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import ThinkingWave from '@/components/ThinkingWave.vue'
import AutocompletePanel from '@/components/AutocompletePanel.vue'
import Icon from '@/components/Icon.vue'
import StickerContextMenu from '@/components/StickerContextMenu.vue'
import QuotedSelectionCard from '@/components/QuotedSelectionCard.vue'
import ThinkPathChooser from '@/components/ThinkPathChooser.vue'
import { computeFloatingInputPosition } from '@/utils/floatingPosition'
import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'
import { useChatInputInjected } from '@/composables/useChatInput'
import { useAutocomplete } from '@/composables/useAutocomplete'
import { useResizeHandle } from '@/composables/useResizeHandle'
import { useAttachMenu } from '@/composables/useAttachMenu'
import { useFileRefs } from '@/composables/useFileRefs'
import { useImageAttachment } from '@/composables/useImageAttachment'
import { useLinkInput } from '@/composables/useLinkInput'
import type { ThinkPathId } from '@/utils/thinkPath'
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import type StickerPickerComponent from '@/components/StickerPicker.vue'
import type { Sticker } from '@/components/StickerPicker.vue'
import ModelSelector from './ModelSelector.vue'
import ContextUsageBadge from './ContextUsageBadge.vue'
import FileUpload from './FileUpload.vue'
import FileUploadGrid from './FileUploadGrid.vue'
import { useChatStore } from '@/stores/chat'

// ChatView 通过 provide 注入 useChatInput 实例；ChatInput 直接读写状态、调用方法
const chatInput = useChatInputInjected()
const {
  isStreaming,
  disabled,
  canSend,
  thinkPathEnabled,
  quotedSelections,
  quoteCandidate,
} = chatInput

const text = ref('')
const connectionError = ref<string | null>(null)
const sendState = ref<'idle' | 'success' | 'error'>('idle')
const sendBtnRef = ref<HTMLElement | null>(null)
let _connectionErrorTimer: ReturnType<typeof setTimeout> | null = null
let _sendStateTimer: ReturnType<typeof setTimeout> | null = null

function clearSendStateTimer() {
  if (_sendStateTimer) { clearTimeout(_sendStateTimer); _sendStateTimer = null }
}

// 发送按钮反馈：成功 spring 弹跳 / 失败抖动（替代 CSS keyframes）
useGsap((_ctx, contextSafe) => {
  watch(sendState, contextSafe((s) => {
    const el = sendBtnRef.value
    if (!el || s === 'idle') return
    if (s === 'success') {
      gsap.fromTo(el,
        { scale: 0.9 },
        { scale: 1.12, duration: 0.1, yoyo: true, repeat: 1, ease: 'back.out(2.5)', overwrite: 'auto',
          onComplete: () => gsap.set(el, { scale: 1 }) })
    } else {
      gsap.fromTo(el,
        { x: 0 },
        { x: 4, duration: 0.05, yoyo: true, repeat: 3, ease: 'none', overwrite: 'auto',
          onComplete: () => gsap.set(el, { x: 0 }) })
    }
  }))
})

// 引用浮动按钮：出现时 spring 弹入
useGsap((_ctx, contextSafe) => {
  watch(quoteCandidate, contextSafe((val) => {
    const el = quoteFloatRef.value
    if (!val || !el) return
    gsap.fromTo(el, { opacity: 0, scale: 0.6, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.2, ease: easeMap.spring, overwrite: 'auto' })
  }), { flush: 'post' })
})


const selectedThinkPathId = ref<ThinkPathId | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const inputContainerRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
const inputPlaceholder = computed(() =>
  canSend.value
    ? '输入消息…… 输入 @ 选择技能 · 输入 # 选择工具 · 输入 ! 选择宏'
    : '后端连接中，可先输入内容，连接完成后发送……'
)
const sendButtonTitle = computed(() => {
  if (noProvider.value) return '请先在模型设置中添加 LLM 提供商'
  if (!canSend.value) return '后端连接中，暂时还不能发送'
  return ''
})

// ── Composables ──

const {
  refs,
  imageRefs,
  nonImageRefs,
  getRefIndex,
  addRef,
  removeRef,
  clearRefs,
} = useFileRefs()

const {
  showMenu,
  addFileMenuRef,
  addFileButtonRef,
  toggleMenu,
  closeAddFileMenu,
  pickFile,
  pickFolder,
} = useAttachMenu({ disabled, refs, loading })

const {
  isDragover,
  imageError,
  pickImage,
  handleImageFile,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  cleanup: cleanupImage,
} = useImageAttachment({ refs, showMenu })

const {
  showLinkInput,
  linkUrl,
  linkError,
  linkInputRef,
  startLinkInput,
  confirmLink,
  cancelLink,
  handlePasteLink,
} = useLinkInput({ refs, showMenu, textareaRef })

defineExpose({ addRef })

// ── 文件网格状态 ──

const hasFiles = computed(() =>
  stickerSegments.value.length > 0 || imageRefs.value.length > 0 || nonImageRefs.value.length > 0
)

// ── 选区引用浮层定位 ──

const quoteFloatRef = ref<HTMLElement | null>(null)
watchEffect(() => {
  const el = quoteFloatRef.value
  if (!el || !quoteCandidate.value) return
  const result = computeFloatingInputPosition(
    quoteCandidate.value.rect,
    { width: 100, height: 32 },
    window.innerWidth,
    window.innerHeight,
    'top',
  )
  el.style.setProperty('left', `${result.left}px`)
  el.style.setProperty('top', `${result.top}px`)
  el.style.setProperty('transform-origin', result.origin)
}, { flush: 'post' })

// ── 表情选择器状态 ──

const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const contextMenuSticker = ref<Sticker | null>(null)
const stickerPickerRef = ref<InstanceType<typeof StickerPickerComponent> | null>(null)
const parsedInputSegments = useStickerSegments(text)
const stickerSegments = computed(() =>
  parsedInputSegments.value.filter((seg): seg is StickerSegment => seg.type === 'sticker')
)

function removeStickerSegment(sticker: StickerSegment) {
  const currentSticker = stickerSegments.value.find(seg => seg.occurrenceKey === sticker.occurrenceKey) || sticker
  text.value = text.value.slice(0, currentSticker.start) + text.value.slice(currentSticker.end)
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

function onContextMenuRefresh() {
  stickerPickerRef.value?.refresh()
  contextMenuVisible.value = false
}

// ── 粘贴处理（图片 + 链接） ──

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (items) {
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) handleImageFile(file)
        return
      }
    }
  }
  handlePasteLink(e)
}

// ── @ / # 自动补全（统一状态机） ──

const {
  acMode,
  acFilterText,
  acPosition,
  acActiveIndex,
  acFiltered,
  loadTools,
  handleKeydown: acHandleKeydown,
  confirmItem,
} = useAutocomplete({
  text,
  textareaRef,
  refs,
  connectionError,
  onConfirm: () => autoResize(),
})

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  if (acHandleKeydown(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// ── Composer 模型状态 ──

const chatStore = useChatStore()
const noProvider = computed(() => chatStore.availableModels.length === 0)

onMounted(loadTools)

// ── 发送 ──

function handleSend() {
  const msg = text.value.trim()
  if (!msg && imageRefs.value.length === 0) return
  if (disabled.value) return
  if (!canSend.value) {
    connectionError.value = '无法连接到 AI 引擎（sidecar 未启动），请检查后端配置'
    if (_connectionErrorTimer) clearTimeout(_connectionErrorTimer)
    _connectionErrorTimer = setTimeout(() => {
      if (_connectionErrorTimer && connectionError.value === '无法连接到 AI 引擎（sidecar 未启动），请检查后端配置') {
        connectionError.value = null
        _connectionErrorTimer = null
      }
    }, 5000)
    return
  }
  const sent = chatInput.send(
    msg,
    refs.value,
    selectedThinkPathId.value || undefined,
  )
  if (!sent) {
    sendState.value = 'error'
    clearSendStateTimer()
    _sendStateTimer = setTimeout(() => { sendState.value = 'idle'; _sendStateTimer = null }, 600)
    connectionError.value = '消息发送失败：WebSocket 连接已断开，请重试'
    if (_connectionErrorTimer) clearTimeout(_connectionErrorTimer)
    _connectionErrorTimer = setTimeout(() => {
      if (_connectionErrorTimer && connectionError.value === '消息发送失败：WebSocket 连接已断开，请重试') {
        connectionError.value = null
        _connectionErrorTimer = null
      }
    }, 5000)
    return
  }
  sendState.value = 'success'
  clearSendStateTimer()
  _sendStateTimer = setTimeout(() => { sendState.value = 'idle'; _sendStateTimer = null }, 800)
  text.value = ''
  selectedThinkPathId.value = null
  clearRefs()
  nextTick(() => autoResize())
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  if (customHeight.value !== null) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

// ── 拖拽调整输入框高度 ──

const { customHeight, isResizing, startResize } = useResizeHandle(inputContainerRef, textareaRef)

onUnmounted(() => {
  if (_connectionErrorTimer) clearTimeout(_connectionErrorTimer)
  _connectionErrorTimer = null
  clearSendStateTimer()
  cleanupImage()
})
</script>

<style scoped>
/* 连接错误横幅 — WebSocket 未连接时发送消息的可见反馈 */
.chat-connection-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  margin-bottom: 8px;
  border: 1px solid transparent;
  border: 1px solid color-mix(in srgb, var(--status-error) 40%, transparent);
  border-radius: 10px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card));
  color: var(--status-error);
  font-size: 0.85em;
  animation: chat-error-in 0.2s ease-out;
}
.chat-connection-error-icon {
  font-size: 1.1em;
  flex-shrink: 0;
}
.chat-connection-error-text {
  flex: 1;
  font-weight: 500;
}
.chat-connection-error-close {
  border: none;
  background: transparent;
  color: var(--status-error);
  cursor: pointer;
  font-size: 1em;
  padding: 0 4px;
  opacity: 0.6;
  transition: opacity 0.15s, transform 0.1s;
}
.chat-connection-error-close:hover {
  opacity: 1;
}
.chat-connection-error-close:active {
  transform: scale(0.92);
}
@keyframes chat-error-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 图片上传错误横幅 */
.chat-image-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    margin-bottom: 8px;
    border: 1px solid transparent;
    border: 1px solid color-mix(in srgb, var(--status-error) 40%, transparent);
    border-radius: 10px;
    background: var(--bg-card);
    background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card));
    color: var(--status-error);
    font-size: 0.85em;
    animation: chat-error-in 0.2s ease-out;
  }
.chat-image-error-icon {
    font-size: 1.1em;
    flex-shrink: 0;
  }
.chat-image-error-text {
    flex: 1;
    font-weight: 500;
  }
.chat-image-error-close {
    border: none;
    background: transparent;
    color: var(--status-error);
    cursor: pointer;
    font-size: 1em;
    padding: 0 4px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
.chat-image-error-close:hover {
    opacity: 1;
  }

.chat-input-wrapper {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 12px 24px 16px;
  background: color-mix(in srgb, var(--bg-primary) 42%, transparent);
  position: relative;
}

/* ── 文件上传区 ── */
.file-upload-area {
  margin: 0 14px;
  padding: 0;
}

.file-upload-area:empty {
  display: none;
}

/* ── 输入区主体 ── */
.input-body {
  flex: 1;
  width: 100%;
  min-height: 0;
  min-width: 0;
  padding: 10px 14px 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 过渡分隔线 */
.input-divider {
  margin: 6px 14px 0;
  border: none;
  height: 1px;
  background: var(--border);
  opacity: 0.6;
  transition: opacity 0.2s;
}
.chat-input:focus-within .input-divider {
  opacity: 1;
}

/* 链接输入条 */
.link-input-wrapper {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  max-width: 768px;
  margin: 0 auto;
  padding: 0 0 8px 0;
}
.link-input-bar {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.link-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.9em;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.link-input:focus {
  border-color: var(--accent);
}
.link-input.is-error,
.link-input.is-error:focus {
  border-color: var(--status-error);
}
.link-input-error {
  color: var(--status-error);
  font-size: 0.8em;
  padding: 4px 0 0 2px;
}
.link-input::placeholder {
    color: var(--text-tertiary);
  }
.link-input-confirm,
.link-input-cancel {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9em;
  transition: opacity 0.12s, border-color 0.12s, color 0.12s, transform 0.1s;
  flex-shrink: 0;
}
.link-input-confirm:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.link-input-confirm:active:not(:disabled) {
  transform: scale(0.92);
}
.link-input-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
.link-input-cancel:hover {
    border-color: var(--status-error);
    color: var(--status-error);
  }
.link-input-cancel:active {
  transform: scale(0.92);
}

/* 拖拽调整手柄 */
.resize-handle {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 12px;
  cursor: ns-resize;
  user-select: none;
  touch-action: none;
  flex-shrink: 0;
  margin-top: -2px;
}
.resize-handle-grip {
  position: relative;
  width: 28px;
  height: 12px;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.resize-handle-grip::before,
.resize-handle-grip::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-tertiary);
  transition: background 0.15s, width 0.2s;
}
.resize-handle-grip::before { top: 2px; }
.resize-handle-grip::after { bottom: 2px; }
.resize-handle:hover .resize-handle-grip {
  opacity: 1;
}
.resize-handle:hover .resize-handle-grip::before,
.resize-handle:hover .resize-handle-grip::after {
  background: var(--accent);
  width: 28px;
}

.chat-input {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  max-height: min(42vh, 420px);
  max-width: var(--composer-max-width, 768px);
  margin: 0 auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  padding: 0;
  box-shadow: var(--shadow-md);
  transition: border-color 0.2s, box-shadow 0.2s;
  overflow: visible;
}

@media (prefers-reduced-motion: no-preference) {
  .chat-input {
    animation: border-breathe 4s ease-in-out infinite;
  }
}

@keyframes border-breathe {
  0%, 100% {
    box-shadow: var(--shadow-md);
  }
  50% {
    box-shadow: var(--shadow-md),
                0 0 18px color-mix(in srgb, var(--accent) 6%, transparent);
  }
}
.chat-input.is-resizing {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
}
.chat-input:focus-within {
    border-color: var(--border-accent, var(--accent));
    box-shadow: var(--shadow-soft), 0 0 0 1px var(--accent-soft),
                0 0 22px color-mix(in srgb, var(--accent) 12%, transparent);
  }

/* 添加文件按钮 */
.btn-add-file-wrapper {
  position: relative;
  flex-shrink: 0;
  z-index: 210;
}
.btn-add-file {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s, transform 0.1s;
  padding: 0;
  font-family: inherit;
  font-size: 17px;
  line-height: 1;
}
.btn-add-file:hover:not(:disabled) {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.btn-add-file.active:not(:disabled) {
  background: var(--bg-secondary);
  color: var(--accent);
}
.btn-add-file:active:not(:disabled) {
  transform: scale(0.92);
}
.btn-add-file:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn-add-file-spin {
  display: inline-block;
  animation: maxma-spin 0.8s linear infinite;
}

/* 添加文件菜单 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99;
}
.add-file-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  min-width: 140px;
}
.add-file-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.9em;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.12s, transform 0.1s;
}
.add-file-menu-item:hover {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.add-file-menu-item:active {
  transform: scale(0.96);
}

/* 表情按钮 */
.btn-sticker {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s, transform 0.1s;
  padding: 0;
  font-family: inherit;
  font-size: 17px;
  line-height: 1;
}
.btn-sticker:hover:not(:disabled) {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.btn-sticker.active {
  background: var(--accent);
  color: white;
}
.btn-sticker:active:not(:disabled) {
  transform: scale(0.92);
}
.input-area {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-size: 1em;
  line-height: 1.6;
  color: var(--text-primary);
  resize: none;
  font-family: inherit;
  min-height: 24px;
  max-height: 160px;
  overflow-y: auto;
  padding: 4px 2px 4px 10px;
}
.input-area:focus {
  box-shadow: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 4px;
}
.input-area:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 4px;
}
.input-area::placeholder {
    color: var(--text-tertiary);
  }
.input-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
  row-gap: 4px;
  padding: 4px 10px 6px 14px;
}
.input-left-group {
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
.input-right-group {
  min-width: 0;
  flex: 1 1 auto;
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
.input-separator {
  width: 1px;
  height: 18px;
  background: var(--border);
  flex-shrink: 0;
  opacity: 0.6;
}
.input-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.btn-send,
.btn-stop {
  width: 32px;
  min-width: 32px;
  height: 32px;
  min-height: 32px;
  border: none;
  border-radius: 50%;
  font-size: 1em;
  cursor: pointer;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.btn-send {
  background: var(--accent);
  color: #fff;
}
@media (hover: hover) and (pointer: fine) {
  .btn-send:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
    transform: scale(1.04);
    box-shadow: var(--shadow-md);
  }
}
.btn-send:active:not(:disabled) {
  transform: scale(0.95);
}
.btn-send:disabled {
  opacity: 0.2;
  cursor: default;
}
/* 发送成功 — 绿色（弹跳由 GSAP 控制，替代 CSS keyframes） */
.btn-send.is-success {
  background: var(--status-ok);
}
/* 发送失败 — 红色（抖动由 GSAP 控制，替代 CSS keyframes） */
.btn-send.is-error {
  background: var(--status-error);
}
.btn-stop {
  background: var(--status-error);
  color: #fff;
  font-size: 0.8em;
}
.btn-stop:hover {
    background: color-mix(in srgb, var(--status-error) 80%, #000);
  }
.btn-stop:active {
  transform: scale(0.92);
}

/* ── 选区引用卡片栏 ── */
.quoted-selections-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
  margin-bottom: 4px;
}

/* ── 选区引用浮动按钮 ── */
.quote-float-btn {
  position: fixed;
  z-index: 300;
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: 100px;
  font-size: 0.8em;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  white-space: nowrap;
  transition: transform 0.1s, opacity 0.15s;
}
.quote-float-btn:hover {
  opacity: 0.9;
}
.quote-float-btn:active {
  transform: scale(0.96);
}

/* 引用浮动按钮入场由 GSAP 控制（spring 弹入），此处不再定义 CSS animation */

.chat-input button:focus-visible,
.link-input:focus-visible,
.input-area:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .chat-input button:focus-visible,
  .link-input:focus-visible,
  .input-area:focus-visible {
    animation: maxma-focus-pulse-in 0.3s var(--ease-standard) both;
  }
}

@media (max-width: 767px) {
  .chat-input-wrapper {
    padding-inline: clamp(8px, 3vw, 16px);
  }

  .chat-input {
    border-radius: 16px;
  }

  .input-bottom-bar {
    padding-inline: 10px;
  }

  .input-right-group {
    gap: 4px;
  }

  .shortcut-hint {
    display: none;
  }

}

@media (min-width: 768px) and (max-width: 1279px) {
  .chat-input-wrapper {
    padding-inline: 16px;
  }
}

@media (min-width: 1280px) {
  .chat-input-wrapper {
    padding-inline: 24px;
  }
}

@media (max-width: 480px) {
  .input-bottom-bar {
    padding-inline: 8px;
  }

  .input-separator {
    display: none;
  }
}

/* ── 思考波浪动画过渡 ── */
.thinking-wave-fade-enter-active {
  transition: opacity 0.5s ease;
}
.thinking-wave-fade-leave-active {
  transition: opacity 0.5s ease;
}
.thinking-wave-fade-enter-from,
.thinking-wave-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .quote-pop-enter-active,
  .quote-pop-leave-active { animation: none; }
}

/* ── 按压反馈 ── */
</style>
