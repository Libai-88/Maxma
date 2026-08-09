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
            <BorderBeam v-if="!isStreaming">
            <button
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
            </BorderBeam>
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
import { useChatSend } from '@/composables/useChatSend'
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
import BorderBeam from '@/components/inspira/BorderBeam.vue'

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
const selectedThinkPathId = ref<ThinkPathId | null>(null)

// ── 发送状态机（按钮反馈 + 连接错误横幅 + 发送入口） ──

const {
  connectionError,
  sendState,
  sendBtnRef,
  handleSend,
  cleanupSendTimers,
} = useChatSend({
  text: () => text.value,
  getRefs: () => refs.value,
  hasImage: () => imageRefs.value.length > 0,
  getThinkPath: () => selectedThinkPathId.value,
  isDisabled: () => disabled.value,
  canSend: () => canSend.value,
  isStreaming: () => isStreaming.value,
  send: (msg, refs, thinkPath) => chatInput.send(msg, refs, thinkPath),  onSendSuccess: () => {
    text.value = ''
    selectedThinkPathId.value = null
    clearRefs()
    nextTick(() => autoResize())
  },
})

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
  cleanupSendTimers()
  cleanupImage()
})
</script>

<style scoped src="@/assets/styles/chat-input.css"></style>
