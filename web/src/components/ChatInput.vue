<template>
  <div class="chat-input-wrapper">
    <div v-if="showLinkInput" class="link-input-bar">
      <input
        ref="linkInputRef"
        v-model="linkUrl"
        type="url"
        class="link-input"
        placeholder="输入链接 URL……"
        @keydown.enter.prevent="confirmLink"
        @keydown.escape.prevent="cancelLink"
      />
      <button class="link-input-confirm" :disabled="!linkUrl.trim()" @click="confirmLink">✓</button>
      <button class="link-input-cancel" @click="cancelLink">✕</button>
    </div>
    <div
      ref="inputContainerRef"
      class="chat-input"
      :class="{ 'is-resizing': isResizing, 'is-dragover': isDragover }"
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
      <TransitionGroup name="ref-tag" tag="div" class="file-refs-bar" @before-leave="freezeLeavePos">
        <!-- 表情引用：缩略图预览 -->
        <span
          v-for="seg in stickerSegments"
          :key="'sticker-' + seg.occurrenceKey"
          class="sticker-tag"
          :title="seg.path"
        >
          <img :src="seg.src" class="sticker-tag-preview" :alt="seg.filename" />
          <span class="sticker-tag-name">{{ seg.category || '表情' }}</span>
          <button class="sticker-tag-remove" @click="removeStickerSegment(seg)">✕</button>
        </span>
        <!-- 图片引用：缩略图预览 -->
        <span
          v-for="(r, idx) in imageRefs"
          :key="'img-' + idx"
          class="image-tag"
        >
          <img :src="r.preview" class="image-tag-preview" :alt="r.label" />
          <span class="image-tag-name">{{ r.label }}</span>
          <button class="image-tag-remove" @click="removeRef(getRefIndex(r))">✕</button>
        </span>
        <!-- 其他引用：文本 chip -->
        <span
          v-for="(r, idx) in nonImageRefs"
          :key="r.type + r.label + idx"
          class="file-tag"
          :class="{ blocked: 'blocked' in r && r.blocked }"
          :title="getRefTooltip(r)"
        >
          <span class="file-tag-icon"><Icon :name="getRefIcon(r)" :size="14" /></span>
          <span class="file-tag-name">{{ r.label }}</span>
          <span class="file-tag-source">{{ r.type }}</span>
          <span v-if="'blocked' in r && r.blocked" class="file-tag-blocked">blocked</span>
          <button class="file-tag-remove" @click="removeRef(getNonImageRefIndex(r))">✕</button>
        </span>
      </TransitionGroup>
      <!-- 已引用选区卡片栏 -->
      <div v-if="quotedSelections.length" class="quoted-selections-bar">
        <QuotedSelectionCard
          v-for="q in quotedSelections"
          :key="q.id"
          :quote="q"
          @remove="chatInput.removeQuote(q.id)"
        />
      </div>
      <div class="input-toolbar">
        <ModelSelector />
        <div class="toolbar-spacer"></div>
        <ContextUsageBadge />
      </div>
      <div class="input-body">
        <textarea
          ref="textareaRef"
          v-model="text"
          class="input-area"
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
          <button class="btn-add-file" :disabled="disabled" @click="toggleMenu">
            <span v-if="loading" class="btn-add-file-spin">⟳</span>
            <Icon v-else name="attach" :size="18" />
          </button>
          <div v-if="showMenu" class="add-file-menu" @click.stop>
            <button class="add-file-menu-item" @click="pickFile">
              <Icon name="menu-file" :size="14" /> 选择文件
            </button>
            <button class="add-file-menu-item" @click="pickFolder">
              <Icon name="menu-folder" :size="14" /> 选择文件夹
            </button>
            <button class="add-file-menu-item" @click="pickImage">
              <Icon name="image" :size="14" /> 选择图片
            </button>
            <button class="add-file-menu-item" @click="startLinkInput">
              <Icon name="link" :size="14" /> 加入链接
            </button>
          </div>
          <div v-if="showMenu" class="menu-backdrop" @click="showMenu = false"></div>
          </div>
        </div>
        <div class="input-right-group">
          <DsSelect
            class="provider-select"
            :class="{ empty: providers.length === 0 }"
            :model-value="selectedProviderId"
            :options="providerOptions"
            :placeholder="providers.length === 0 ? '未配置模型' : '选择提供商'"
            :aria-label="'LLM 提供商'"
            size="sm"
            @update:model-value="selectProvider"
          />
          <DsSelect
            v-if="currentModels.length"
            class="model-select"
            :model-value="selectedModelName"
            :options="modelOptions"
            :placeholder="'选择模型'"
            :aria-label="'模型'"
            size="sm"
            @update:model-value="selectModel"
          />
          <span class="input-separator"></span>
          <div class="input-actions">
            <button
              class="btn-sticker"
              :class="{ active: showStickerPicker }"
              @click.stop="toggleStickerPicker"
              title="表情"
            >
              <Icon name="sticker" :size="18" />
            </button>
            <button
              v-if="!isStreaming"
              class="btn-send"
              :disabled="(!text.trim() && imageRefs.length === 0) || disabled || noProvider || !canSend"
              :title="sendButtonTitle"
              @click="handleSend"
            >
              <Icon name="send" :size="16" />
            </button>
            <button v-else class="btn-stop" @click="chatInput.stop()">
              <Icon name="stop" :size="12" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- 表情选择器 -->
    <StickerPicker
      v-if="showStickerPicker"
      ref="stickerPickerRef"
      :visible="showStickerPicker"
      :context-text="text"
      @select="onStickerSelect"
      @close="showStickerPicker = false"
      @contextmenu="onStickerContextMenu"
    />
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
        @click="chatInput.commitQuote()"
        title="引用选中文本"
      >
        + 引用
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import AutocompletePanel from '@/components/AutocompletePanel.vue'
import Icon from '@/components/Icon.vue'
import StickerContextMenu from '@/components/StickerContextMenu.vue'
import QuotedSelectionCard from '@/components/QuotedSelectionCard.vue'
import ThinkPathChooser from '@/components/ThinkPathChooser.vue'
import { computeFloatingInputPosition } from '@/utils/floatingPosition'
import type { SkillInfo, MacroInfo, ToolInfo } from '@/types'
import { useProviderStore } from '@/stores/provider'
import { useStickerSegments, type StickerSegment } from '@/composables/useStickerSegments'
import { useChatInputInjected } from '@/composables/useChatInput'
import type { ParsedRef, ImageRef } from '@/utils/references'
import { REF_CHIP_CONFIG } from '@/utils/references'
import { getApiBase, isTauri, tauriFetch } from '@/utils/env'
import type { ThinkPathId } from '@/utils/thinkPath'
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch, watchEffect } from 'vue'
import DsSelect from './ui/DsSelect.vue'
import ModelSelector from './ModelSelector.vue'
import ContextUsageBadge from './ContextUsageBadge.vue'
import { useChatStore } from '@/stores/chat'

// 表情选择器体积较大且仅在用户点击表情按钮时才需要，懒加载以减小初始 chunk
const StickerPicker = defineAsyncComponent(() => import('@/components/StickerPicker.vue'))

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
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const inputContainerRef = ref<HTMLDivElement | null>(null)
const refs = ref<ParsedRef[]>([])
const loading = ref(false)
const inputPlaceholder = computed(() =>
  canSend.value
    ? '输入消息…… @技能 · #工具 · !宏'
    : '后端连接中，可先输入内容，连接完成后发送……'
)
const sendButtonTitle = computed(() => {
  if (noProvider.value) return '请先在模型设置中添加 LLM 提供商'
  if (!canSend.value) return '后端连接中，暂时还不能发送'
  return ''
})

// 选区引用浮层定位
const quoteFloatRef = ref<HTMLElement | null>(null)
watchEffect(() => {
  const el = quoteFloatRef.value
  if (!el || !quoteCandidate.value) return
  // CSP-safe CSSOM: position quote float btn via style.setProperty (was :style binding)
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
const showStickerPicker = ref(false)
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const contextMenuSticker = ref<any>(null)
const stickerPickerRef = ref<InstanceType<typeof StickerPicker> | null>(null)
const parsedInputSegments = useStickerSegments(text)
const stickerSegments = computed(() =>
  parsedInputSegments.value.filter((seg): seg is StickerSegment => seg.type === 'sticker')
)

function toggleStickerPicker() {
  console.log('[ChatInput] toggleStickerPicker called, current:', showStickerPicker.value)
  showStickerPicker.value = !showStickerPicker.value
  console.log('[ChatInput] showStickerPicker now:', showStickerPicker.value)
}

async function onStickerSelect(sticker: any) {
  console.log('[ChatInput] onStickerSelect called with:', sticker)
  // 直接用用户选择的具体表情，不再调 random API
  const stickerTag = `<sticker:${sticker.path}>`
  text.value += stickerTag
  recordStickerUsage(sticker)
  console.log('[ChatInput] Inserted sticker tag:', stickerTag)
  showStickerPicker.value = false
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

function removeStickerSegment(sticker: StickerSegment) {
  const currentSticker = stickerSegments.value.find(seg => seg.occurrenceKey === sticker.occurrenceKey) || sticker
  text.value = text.value.slice(0, currentSticker.start) + text.value.slice(currentSticker.end)
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

async function recordStickerUsage(sticker: any) {
  try {
    await tauriFetch(`${getApiBase()}/stickers/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: sticker.category,
        filename: sticker.filename
      })
    })
  } catch (err) {
    console.warn('[ChatInput] 记录表情使用失败:', err)
  }
}

function onStickerContextMenu(event: MouseEvent, sticker: any) {
  contextMenuSticker.value = sticker
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  contextMenuVisible.value = true
}

function onContextMenuRefresh() {
  stickerPickerRef.value?.refresh()
  contextMenuVisible.value = false
}

// ── 图片引用分离（用于模板中分别渲染缩略图和文本 chip）──
const imageRefs = computed(() => refs.value.filter((r): r is ImageRef => r.type === 'image'))
const nonImageRefs = computed(() => refs.value.filter((r): r is Exclude<ParsedRef, ImageRef> => r.type !== 'image'))

/** 获取 ImageRef 在 refs 数组中的真实索引 */
function getRefIndex(imgRef: ImageRef): number {
  return refs.value.indexOf(imgRef)
}

/** 获取 nonImageRef 在 refs 数组中的真实索引 */
function getNonImageRefIndex(r: Exclude<ParsedRef, ImageRef>): number {
  return refs.value.indexOf(r as ParsedRef)
}

// ── 拖拽图片状态 ──
const isDragover = ref(false)
let dragCounter = 0
const showMenu = ref(false)
const showLinkInput = ref(false)
const linkUrl = ref('')
const linkInputRef = ref<HTMLInputElement | null>(null)

// ── 供父组件注入新引用（如 ChatWindow 发出的 cite） ──

function addRef(r: ParsedRef) {
  refs.value.push(r)
}

function removeRef(idx: number) {
  const ref = refs.value[idx]
  // 释放图片 blob URL，防止内存泄漏
  if (ref && ref.type === 'image' && (ref as ImageRef).preview?.startsWith('blob:')) {
    URL.revokeObjectURL((ref as ImageRef).preview)
  }
  refs.value.splice(idx, 1)
}

/** TransitionGroup before-leave：冻结退场元素的位置，使其脱离 flex 流而不跳跃 */
function freezeLeavePos(el: Element) {
  const htmlEl = el as HTMLElement
  const parent = htmlEl.offsetParent as HTMLElement
  if (parent) {
    htmlEl.style.left = htmlEl.offsetLeft + 'px'
    htmlEl.style.top = htmlEl.offsetTop + 'px'
  }
}

/** 从 REF_CHIP_CONFIG 获取图标名 */
function getRefIcon(r: ParsedRef): string {
  return REF_CHIP_CONFIG[r.type]?.icon ?? 'file'
}

/** 从 REF_CHIP_CONFIG 获取 tooltip，受阻时附加原因 */
function getRefTooltip(r: ParsedRef): string {
  const base = REF_CHIP_CONFIG[r.type]?.tooltip(r) ?? r.label
  if ('blocked' in r && r.blocked) {
    return `${base}\n⛔ ${r.blockedReason || '路径被阻挡，无法访问'}`
  }
  return base
}

defineExpose({ addRef })

// ── 链接引用 ──

const LINK_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i

function startLinkInput() {
  showMenu.value = false
  linkUrl.value = ''
  showLinkInput.value = true
  nextTick(() => linkInputRef.value?.focus())
}

function confirmLink() {
  const url = linkUrl.value.trim()
  if (!url) return
  // 如果没有协议前缀，自动补 https://
  const normalized = /^https?:\/\//i.test(url) ? url : 'https://' + url
  if (!LINK_RE.test(normalized)) return
  try {
    const domain = new URL(normalized).hostname.replace(/^www\./, '')
    refs.value.push({ type: 'web_link', url: normalized, label: domain, domain })
    linkUrl.value = ''
    showLinkInput.value = false
  } catch {
    // URL 解析失败，不做操作
  }
}

function cancelLink() {
  linkUrl.value = ''
  showLinkInput.value = false
}

// ── 粘贴URL自动识别 ──

/** 判断文本是否看起来像域名/IP，适合补 https:// */
function looksLikeHost(text: string): boolean {
  // 允许 localhost、带点的域名、IPv4、IPv6
  return /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:[0-9]+)?(\/|$)/.test(text)
      || /^localhost(:[0-9]+)?(\/|$)/i.test(text)
}

function onPaste(e: ClipboardEvent) {
  // ── 剪贴板图片粘贴 ──
  const items = e.clipboardData?.items
  if (items) {
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          handleImageFile(file)
        }
        return
      }
    }
  }

  const text = e.clipboardData?.getData('text/plain')?.trim()
  if (!text) return

  // 已有协议头 → 直接校验完整 URL
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      if (['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.')) {
        e.preventDefault()
        const domain = url.hostname.replace(/^www\./, '')
        refs.value.push({ type: 'web_link', url: text, label: domain, domain } as ParsedRef)
      }
    } catch { /* 走默认粘贴 */ }
    return
  }

  // 无协议头 → 仅当看起来像域名时才补 https:// 并二次校验
  if (looksLikeHost(text)) {
    const normalized = 'https://' + text
    try {
      const url = new URL(normalized)
      if (['http:', 'https:'].includes(url.protocol)) {
        e.preventDefault()
        const domain = url.hostname.replace(/^www\./, '')
        refs.value.push({ type: 'web_link', url: normalized, label: domain, domain } as ParsedRef)
      }
    } catch { /* 走默认粘贴 */ }
  }
}

// ── @ / # 自动补全（统一状态机） ──

type AcMode = 'skill' | 'tool' | 'macro' | null

const acMode = ref<AcMode>(null)
const acFilterText = ref('')
const acPosition = ref({ x: 0, y: 0 })
const acActiveIndex = ref(0)
const acTriggerPos = ref(-1)
const acTriggerChar = ref('')

const skills = ref<SkillInfo[]>([])
const tools = ref<ToolInfo[]>([])
const macros = ref<MacroInfo[]>([])

/** 当前模式对应的数据源 */
const acSource = computed(() =>
  acMode.value === 'skill' ? skills.value
  : acMode.value === 'tool' ? tools.value
  : acMode.value === 'macro' ? macros.value
  : []
)

/** 筛选 + 排序后的候选项 */
const acFiltered = computed(() => {
  const src = acSource.value
  if (!acFilterText.value) return src
  const lower = acFilterText.value.toLowerCase()

  const scored = src
    .map(item => {
      const nameLower = item.name.toLowerCase()
      if (!nameLower.includes(lower)) return null
      const prefix = nameLower.startsWith(lower)
      const count = prefix ? 1 : nameLower.split(lower).length - 1
      const score = prefix ? 4 : 2
      return { item, score, count }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.count !== b.count) return b.count - a.count
    return a.item.name.localeCompare(b.item.name)
  })

  return scored.map(s => s.item)
})

async function loadSkills() {
  try {
    const res = await api.listSkills()
    skills.value = res.skills
  } catch (e) {
    console.error('[ChatInput] 加载技能失败:', e)
  }
}

async function loadTools() {
  try {
    const res = await api.listTools()
    tools.value = res.tools
  } catch (e) {
    console.error('[ChatInput] 加载工具失败:', e)
  }
}

async function loadMacros() {
  try {
    const res = await api.listMacros()
    macros.value = res.macros
  } catch (e) {
    console.error('[ChatInput] 加载宏失败:', e)
  }
}

/** 检测 @ / # 触发 */
watch(text, () => {
  const el = textareaRef.value
  if (!el || el !== document.activeElement) return
  const val = text.value
  const cursorPos = el.selectionStart
  const textBeforeCursor = val.slice(0, cursorPos)

  // 检查 @、#、!、！，取最近者
  let triggerPos = -1
  let triggerChar = ''
  for (const ch of ['@', '#', '!', '！'] as const) {
    const idx = textBeforeCursor.lastIndexOf(ch)
    if (idx > triggerPos) {
      triggerPos = idx
      triggerChar = ch
    }
  }

  const mode: AcMode = triggerChar === '@' ? 'skill' : triggerChar === '#' ? 'tool' : (triggerChar === '!' || triggerChar === '！') ? 'macro' : null

  if (triggerPos !== -1 && mode) {
    const after = textBeforeCursor.slice(triggerPos + 1)
    const charBefore = triggerPos === 0 ? ' ' : textBeforeCursor[triggerPos - 1]
    if (!/\w/.test(charBefore)) {
      acMode.value = mode
      acFilterText.value = after
      acTriggerPos.value = triggerPos
      acTriggerChar.value = triggerChar
      acActiveIndex.value = 0
      acPosition.value = calcCursorPixelPos(el, cursorPos)
      return
    }
  }
  acMode.value = null
})

function onKeydown(e: KeyboardEvent) {
  // IME 组合态（中文输入法选字中）不拦截任何按键
  if (e.isComposing || e.keyCode === 229) return

  if (acMode.value) {
    const len = acFiltered.value.length
    if (e.key === 'Tab') {
      e.preventDefault()
      confirmItem()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      acActiveIndex.value = ((acActiveIndex.value - 1) % len + len) % len
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      acActiveIndex.value = (acActiveIndex.value + 1) % len
      return
    }
    if (e.key === 'Escape') {
      acMode.value = null
      return
    }
  }

  // Enter 发送（仅当面板未打开时）
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function confirmItem() {
  const item = acFiltered.value[acActiveIndex.value]
  if (!item) return

  // 移除触发符及后续文本
  const el = textareaRef.value
  const cursorPos = el?.selectionStart ?? text.value.length
  text.value = text.value.slice(0, acTriggerPos.value) + text.value.slice(cursorPos)

  // 创建对应类型的引用
  const ref: ParsedRef =
    acMode.value === 'skill' ? { type: 'skill', name: item.name, label: item.name }
    : acMode.value === 'macro' ? { type: 'macro', name: item.name, label: item.name }
    : { type: 'tool', name: item.name, label: item.name }
  refs.value.push(ref)

  acMode.value = null
  nextTick(() => autoResize())
}

function calcCursorPixelPos(textarea: HTMLTextAreaElement, pos: number): { x: number; y: number } {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  mirror.style.cssText = `
    position: fixed; top: 0; left: -9999px; visibility: hidden; white-space: pre-wrap;
    word-wrap: break-word; overflow-wrap: break-word;
    font: ${style.font}; font-size: ${style.fontSize};
    letter-spacing: ${style.letterSpacing};
    width: ${textarea.clientWidth}px;
    padding: ${style.padding};
  `
  mirror.textContent = textarea.value.slice(0, pos) + '.'
  document.body.appendChild(mirror)

  const textareaRect = textarea.getBoundingClientRect()
  const mirrorRect = mirror.getBoundingClientRect()

  // 计算光标所在行相对于 mirror 顶部的位置
  const lines = mirror.textContent!.split('\n')
  const lastLine = lines[lines.length - 1]

  // 用 span 精确测量最后一行的宽度
  const span = document.createElement('span')
  span.textContent = lastLine
  span.style.cssText = `visibility: hidden; white-space: pre; font: ${style.font}; font-size: ${style.fontSize};`
  document.body.appendChild(span)

  const x = textareaRect.left + span.getBoundingClientRect().width + parseInt(style.paddingLeft || '0') - 8
  const y = textareaRect.top + mirrorRect.height - textarea.scrollTop + 4

  document.body.removeChild(mirror)
  document.body.removeChild(span)

  return { x, y }
}

// ── LLM 选择器 ──
// provider 列表来自全局 store（含重试），消除此前各组件独立请求导致的状态不一致
// selectedProviderId/selectedModelName 直接复用 useChatInput 的 ref（与 ChatView 同一引用）
const providerStore = useProviderStore()
const chatStore = useChatStore()
const providers = computed(() => providerStore.enabledProviders)
const selectedProviderId = chatInput.providerId
const selectedModelName = chatInput.modelName
const currentModels = ref<string[]>([])
const noProvider = computed(() => providers.value.length === 0)
const providerOptions = computed(() =>
  providers.value.map(p => ({ value: p.id, label: p.label }))
)
const modelOptions = computed(() =>
  currentModels.value.map(m => ({ value: m, label: m }))
)

function selectProvider(value: string | number) {
  const id = String(value)
  selectedProviderId.value = id
  const p = providers.value.find(p => p.id === id)
  currentModels.value = p?.models ?? []
  selectedModelName.value = currentModels.value[0] || ''
  chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
}

function selectModel(value: string | number) {
  const name = String(value)
  selectedModelName.value = name
  chatInput.onModelChange(selectedProviderId.value || '', name)
}

// 从 store 加载 provider 列表并设置默认选中
async function loadProviders() {
  await providerStore.loadProviders()
  // 优先使用 ChatView 传入的初始值（跨对话持久化，存于 composable 的 providerId/modelName）
  const initialProviderId = selectedProviderId.value
  const initialModelName = selectedModelName.value
  if (initialProviderId) {
    const provider = providers.value.find(p => p.id === initialProviderId)
    if (provider) {
      selectedProviderId.value = provider.id
      currentModels.value = provider.models ?? []
      selectedModelName.value = initialModelName && currentModels.value.includes(initialModelName)
        ? initialModelName
        : (currentModels.value[0] || '')
      // 同步回 ChatView（触发 onModelChange 回调持久化到 localStorage）
      chatInput.onModelChange(selectedProviderId.value, selectedModelName.value)
      return
    }
  }
  // 默认选中第一个已启用的提供商
  if (providers.value.length > 0 && !selectedProviderId.value) {
    selectProvider(providers.value[0].id)
  }
}

// 监听 store 中 provider 列表变化（例如 ProvidersView 增删改后刷新 store）
watch(providers, (newList) => {
  // 如果有初始值且初始值有效，让 loadProviders 处理初始选择，避免竞态覆盖
  const initialProviderId = selectedProviderId.value
  if (initialProviderId && newList.find(p => p.id === initialProviderId) && !selectedProviderId.value) {
    return
  }
  if (selectedProviderId.value) {
    // 当前选中的 provider 还在列表中
    const p = newList.find(p => p.id === selectedProviderId.value)
    if (p) {
      // 更新 currentModels（provider 的 models 可能被修改过）
      const newModels = p.models ?? []
      const modelsChanged = JSON.stringify(currentModels.value) !== JSON.stringify(newModels)
      if (modelsChanged) {
        currentModels.value = newModels
        // selectedModelName 不在新 models 中时重置为第一个
        if (!newModels.includes(selectedModelName.value || '')) {
          selectedModelName.value = newModels[0] || ''
          chatInput.onModelChange(selectedProviderId.value || '', selectedModelName.value)
        }
      }
    } else {
      // 当前选中的 provider 不在新列表中（被删除或禁用），重置选中
      selectedProviderId.value = ''
      currentModels.value = []
      selectedModelName.value = ''
      if (newList.length > 0) {
        selectProvider(newList[0].id)
      }
    }
  } else if (!selectedProviderId.value && newList.length > 0) {
    // 之前没有 provider，现在有了，自动选中第一个
    selectProvider(newList[0].id)
  }
})

onMounted(loadProviders)
onMounted(loadSkills)
onMounted(loadTools)
onMounted(loadMacros)

function getFileName(fp: string): string {
  const parts = fp.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || fp
}

function toggleMenu() {
  if (disabled.value) return
  showMenu.value = !showMenu.value
}

async function pickFile() {
  showMenu.value = false
  await _pick('file')
}

async function pickFolder() {
  showMenu.value = false
  await _pick('folder')
}

async function _pick(type: 'file' | 'folder') {
  if (loading.value) return
  loading.value = true
  try {
    const path = await selectLocalPath(type)
    if (path) {
      const refType = type === 'folder' ? 'folder' : 'file'
      const idx = refs.value.length
      refs.value.push({ type: refType, path, label: getFileName(path) } as ParsedRef)
      console.log('[ChatInput] _pick: pushed ref idx=%d type=%s path=%s', idx, refType, path)

      // 异步检查路径是否被拒止锚或白名单阻挡
      api.checkPathBlocked(path).then(result => {
        console.log('[ChatInput] checkPathBlocked result for', path, result)
        if (result.blocked) {
          // 通过 refs.value[idx] 操作以触发响应式更新
          const entry = refs.value[idx] as any
          entry.blocked = true
          entry.blockedReason = result.reason
          console.log('[ChatInput] marked ref %d as blocked, reason: %s', idx, result.reason)
        }
      }).catch(err => {
        console.warn('[ChatInput] checkPathBlocked failed:', err)
      })
    }
  } catch {
    // 静默失败
  } finally {
    loading.value = false
  }
}

async function selectLocalPath(type: 'file' | 'folder'): Promise<string | null> {
  if (isTauri()) {
    const invoke = (window as any).__TAURI_INTERNALS__?.invoke ?? (window as any).__TAURI__?.core?.invoke
    if (invoke) return await invoke('select_path', { kind: type })
  }

  const data = await api.selectFile(type)
  return data.path
}

// ── 图片处理 ──

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB

/** 通过文件选择器选择图片 */
async function pickImage() {
  showMenu.value = false
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = async () => {
    if (!input.files) return
    for (const file of Array.from(input.files)) {
      await handleImageFile(file)
    }
  }
  input.click()
}

/** 处理单个图片文件：校验 → 上传 → 添加到 refs */
async function handleImageFile(file: File) {
  // 校验类型
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!file.type.startsWith('image/') && !IMAGE_EXTS.includes(ext)) {
    console.warn('[ChatInput] 非图片文件:', file.name)
    return
  }
  // 校验大小
  if (file.size > MAX_IMAGE_SIZE) {
    console.warn('[ChatInput] 图片过大:', file.size, file.name)
    return
  }

  // 本地预览 URL
  const preview = URL.createObjectURL(file)
  const label = file.name || 'image'

  // 先添加为占位（path 为空），上传完成后更新
  const idx = refs.value.length
  refs.value.push({ type: 'image', label, path: '', preview } as ImageRef)

  try {
    const result = await api.uploadImage(file)
    // 上传成功，更新 path
    const entry = refs.value[idx] as ImageRef
    entry.path = result.path
    console.log('[ChatInput] image uploaded:', result.path)
  } catch (e) {
    console.error('[ChatInput] image upload failed:', e)
    // 上传失败，移除该引用并释放 preview URL
    refs.value.splice(idx, 1)
    URL.revokeObjectURL(preview)
  }
}

/** 拖拽进入 */
function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return
  dragCounter++
  isDragover.value = true
}

/** 拖拽经过 */
function onDragOver(_e: DragEvent) {
  // 保持 isDragover 状态，CSS 显示高亮
}

/** 拖拽离开 */
function onDragLeave(_e: DragEvent) {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    isDragover.value = false
  }
}

/** 拖拽放下 */
async function onDrop(e: DragEvent) {
  isDragover.value = false
  dragCounter = 0
  const files = e.dataTransfer?.files
  if (!files) return
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      await handleImageFile(file)
    }
  }
}

function handleSend() {
  const msg = text.value.trim()
  if ((!msg && imageRefs.value.length === 0) || disabled.value || !canSend.value) return
  chatInput.send(
    msg,
    refs.value,
    selectedThinkPathId.value || undefined,
    chatStore.currentModel,
    chatStore.temperature,
    chatStore.maxTokens,
  )
  text.value = ''
  // ThinkPath is intentionally one-shot: it is a confirmed preference for this
  // request, never an invisible session-level routing policy.
  selectedThinkPathId.value = null
  // 释放图片预览 URL
  for (const r of refs.value) {
    if (r.type === 'image' && r.preview.startsWith('blob:')) {
      URL.revokeObjectURL(r.preview)
    }
  }
  refs.value = []
  nextTick(() => autoResize())
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  // 如果用户手动拖拽过容器高度，不干涉 textarea 高度，交由 flex 布局自动填充
  if (customHeight.value !== null) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

// ── 拖拽调整输入框高度 ──

const customHeight = ref<number | null>(null)
const isResizing = ref(false)
const resizeStartY = ref(0)
const resizeStartHeight = ref(0)
const handleRef = ref<HTMLDivElement | null>(null)
const DEFAULT_INPUT_HEIGHT = 117
const initialHeight = ref(DEFAULT_INPUT_HEIGHT)

// CSP-safe CSSOM: set container height/minHeight via style.setProperty (was :style binding)
watchEffect(() => {
  const el = inputContainerRef.value
  if (!el) return
  el.style.setProperty('min-height', `${initialHeight.value}px`)
  if (customHeight.value !== null) {
    el.style.setProperty('height', `${customHeight.value}px`)
  } else {
    el.style.removeProperty('height')
  }
}, { flush: 'post' })

/** 组件挂载后捕获输入框的初始默认高度，作为拖拽下限 */
onMounted(() => {
  nextTick(() => {
    const el = inputContainerRef.value
    if (el) initialHeight.value = Math.max(DEFAULT_INPUT_HEIGHT, el.clientHeight)
  })
})

function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLDivElement
  handle.setPointerCapture(e.pointerId)
  handleRef.value = handle

  isResizing.value = true
  resizeStartY.value = e.clientY
  const el = inputContainerRef.value
  resizeStartHeight.value = el ? el.clientHeight : initialHeight.value
  if (customHeight.value === null) {
    customHeight.value = resizeStartHeight.value
  }

  // 拖拽时清除 textarea 行内高度，让 CSS height: 100% 接管以填充容器
  if (textareaRef.value) textareaRef.value.style.height = ''

  handle.addEventListener('pointermove', onResizeMove)
  handle.addEventListener('pointerup', onResizeEnd)
  handle.addEventListener('pointercancel', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  const delta = resizeStartY.value - e.clientY
  const newHeight = Math.max(initialHeight.value, Math.min(600, resizeStartHeight.value + delta))
  customHeight.value = newHeight
}

function onResizeEnd(e: PointerEvent) {
  isResizing.value = false
  const handle = handleRef.value
  if (handle) {
    handle.releasePointerCapture(e.pointerId)
    handle.removeEventListener('pointermove', onResizeMove)
    handle.removeEventListener('pointerup', onResizeEnd)
    handle.removeEventListener('pointercancel', onResizeEnd)
    handleRef.value = null
  }
}
</script>

<style scoped>
.input-toolbar {
  display: flex; align-items: center;
  padding: 4px 8px; gap: 8px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.toolbar-spacer { flex: 1; }

.chat-input-wrapper {
  padding: 12px 24px 16px;
  background: var(--bg-card);
  position: relative;
}

/* ── LLM 提供商/模型选择器（基于 DsSelect，覆盖 input 样式以保持紧凑视觉）── */
.provider-select,
.model-select {
  width: auto;
  max-width: 160px;
  flex-shrink: 1;
  min-width: 0;
}
.provider-select :deep(.ds-select__input),
.model-select :deep(.ds-select__input) {
  height: 24px;
  padding: 0 24px 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75em;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  overflow: hidden;
  text-overflow: ellipsis;
}
.provider-select :deep(.ds-select__input:hover),
.model-select :deep(.ds-select__input:hover) {
  border-color: var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.provider-select.empty :deep(.ds-select__input) {
  color: var(--status-error);
  opacity: 0.7;
}
.provider-select :deep(.ds-select__input:focus-visible),
.model-select :deep(.ds-select__input:focus-visible) {
  outline: 1.5px solid var(--accent);
  outline-offset: 2px;
  box-shadow: none;
  border-color: transparent;
}
.provider-select :deep(.ds-select--open .ds-select__input),
.model-select :deep(.ds-select--open .ds-select__input) {
  border-color: var(--accent);
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: none;
}
.provider-select :deep(.ds-select__caret),
.model-select :deep(.ds-select__caret) {
  width: 20px;
  height: 24px;
  color: var(--text-tertiary);
  opacity: 0.5;
}
.provider-select :deep(.ds-select--open .ds-select__caret),
.model-select :deep(.ds-select--open .ds-select__caret) {
  color: var(--text-primary);
  opacity: 1;
}

/* 引用标签条 */
.file-refs-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 10px 14px 0;
}
.file-refs-bar:empty {
  display: none;
}
.file-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px 2px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 100px;
  font-size: 0.75em;
  color: var(--text-primary);
  max-width: 100%;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}
.file-tag:hover {
  border-color: var(--accent-light);
  background: var(--bg-primary);
}
.file-tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.file-tag-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}
.file-tag-remove:hover {
  color: var(--status-error);
}
.file-tag-source {
  font-size: 0.65em;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  padding: 1px 6px;
  border-radius: 100px;
  flex-shrink: 0;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.file-tag-blocked {
  font-size: 0.65em;
  color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
  padding: 0 5px;
  border-radius: 3px;
  flex-shrink: 0;
  font-weight: 600;
}
.file-tag.blocked {
  border-color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card));
}
.file-tag.blocked .file-tag-name {
  color: var(--status-error);
}

/* ── 图片引用缩略图 ── */
.sticker-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 3px;
  border: 1px solid color-mix(in srgb, var(--accent-pink) 36%, var(--border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-pink) 8%, var(--bg-secondary));
  font-size: 0.75em;
  color: var(--text-primary);
  max-width: 180px;
  transition: border-color 0.15s, background 0.15s;
}

.sticker-tag:hover {
  border-color: var(--accent-pink);
  background: color-mix(in srgb, var(--accent-pink) 12%, var(--bg-secondary));
}

.sticker-tag-preview {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 8px;
  flex-shrink: 0;
  background: #fff;
}

.sticker-tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.sticker-tag-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}

.sticker-tag-remove:hover {
  color: var(--status-error);
}

.image-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  font-size: 0.75em;
  color: var(--text-primary);
  max-width: 180px;
  transition: border-color 0.15s;
}
.image-tag:hover {
  border-color: var(--accent-light);
}
.image-tag-preview {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
}
.image-tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.image-tag-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85em;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}
.image-tag-remove:hover {
  color: var(--status-error);
}

/* ── 拖拽图片高亮 ── */
.chat-input.is-dragover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

/* ── 输入区主体 ── */
.input-body {
  flex: 1;
  min-height: 0;
  padding: 10px 14px 0;
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

/* TransitionGroup 动画：从下往上缓出弹出，退场缩小淡出 */
.ref-tag-enter-active {
  transition: all 0.25s ease-out;
}
.ref-tag-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.ref-tag-leave-active {
  transition: all 0.2s ease-in;
  position: absolute !important;
}
.ref-tag-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.ref-tag-move {
  transition: transform 0.25s ease-out;
}

/* 链接输入条 */
.link-input-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 0 8px 0;
  max-width: 768px;
  margin: 0 auto;
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
.link-input::placeholder {
  color: #9ca3af;
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
  transition: all 0.12s;
  flex-shrink: 0;
}
.link-input-confirm:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.link-input-confirm:disabled {
  opacity: 0.4;
  cursor: default;
}
.link-input-cancel:hover {
  border-color: #c97a7a;
  color: #c97a7a;
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
  width: 32px;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  transition: background 0.15s, width 0.2s;
  opacity: 0.5;
}
.resize-handle:hover .resize-handle-grip {
  background: var(--accent);
  width: 56px;
  opacity: 1;
}

.chat-input {
  display: flex;
  flex-direction: column;
  max-width: 768px;
  margin: 0 auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 0;
  box-shadow: var(--shadow-soft);
  transition: border-color 0.2s, box-shadow 0.2s;
  overflow: visible;
}
.chat-input.is-resizing {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 20%, transparent);
}
.chat-input:focus-within {
  border-color: var(--accent-pink);
  box-shadow: var(--shadow-soft), 0 0 0 1px var(--accent-pink-soft);
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
  transition: all 0.15s;
  padding: 0;
  font-family: inherit;
  font-size: 17px;
  line-height: 1;
}
.btn-add-file:hover:not(:disabled) {
  background: var(--bg-secondary);
  color: var(--text-primary);
}
.btn-add-file:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn-add-file-spin {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  transition: background 0.12s;
}
.add-file-menu-item:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
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
  transition: all 0.15s;
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
.input-area::placeholder {
  color: #9ca3af;
}
.input-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px 6px 14px;
}
.input-left-group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.input-right-group {
  display: flex;
  align-items: center;
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
  gap: 4px;
  align-items: center;
}
.btn-send,
.btn-stop {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  font-size: 1em;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
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
.btn-send:hover:not(:disabled) {
  background: var(--accent-pink);
  transform: scale(1.08);
  box-shadow: var(--shadow-pink);
}
.btn-send:active:not(:disabled) {
  transform: scale(0.95);
}
.btn-send:disabled {
  opacity: 0.2;
  cursor: default;
}
.btn-stop {
  background: var(--status-error);
  color: #fff;
  font-size: 0.8em;
}
.btn-stop:hover {
  background: color-mix(in srgb, var(--status-error) 80%, #000);
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
}
.quote-float-btn:hover {
  opacity: 0.9;
}

.quote-pop-enter-active {
  animation: quote-pop-in 0.15s var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
}
.quote-pop-leave-active {
  animation: quote-pop-in 0.1s reverse;
}
@keyframes quote-pop-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .quote-pop-enter-active,
  .quote-pop-leave-active { animation: none; }
}
</style>
