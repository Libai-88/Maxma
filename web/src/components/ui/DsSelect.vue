<!-- web/src/components/ui/DsSelect.vue
  WAI-ARIA Combobox Pattern（Combobox with Listbox Popup）。
  参考：https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
-->
<template>
  <div
    class="ds-select"
    :class="[`ds-select--${size}`, { 'ds-select--disabled': disabled, 'ds-select--open': open }]"
  >
    <slot name="trigger" :open="open" :toggle="toggle">
      <input
        ref="inputRef"
        class="ds-select__input"
        role="combobox"
        :id="id"
        :aria-label="ariaLabel"
        aria-autocomplete="list"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="listboxId"
        :aria-activedescendant="open && activeOptionId ? activeOptionId : undefined"
        :aria-disabled="disabled ? 'true' : undefined"
        :placeholder="placeholder"
        :value="selectedLabel"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        readonly
        @click="openList"
        @keydown="onKeyDown"
        @focus="onInputFocus"
        @blur="onInputBlur"
      />
      <button
        type="button"
        class="ds-select__caret"
        :aria-label="open ? '关闭选项列表' : '展开选项列表'"
        aria-haspopup="listbox"
        :aria-expanded="open ? 'true' : 'false'"
        tabindex="-1"
        :disabled="disabled"
        @click="toggle"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </slot>
    <Teleport to="body">
      <Transition name="ds-select">
        <ul
          v-if="open"
          ref="listboxRef"
          :id="listboxId"
          role="listbox"
          class="ds-select__listbox"
          :style="popupStyle"
          @mousedown.prevent="onListMouseDown"
        >
          <template v-if="groupKey">
            <template v-for="group in groupedOptions" :key="`g-${group.key}`">
              <li role="presentation" class="ds-select__group-header">{{ group.key }}</li>
              <li
                v-for="item in group.items"
                :key="item.opt.value"
                :id="`${listboxId}-opt-${item.index}`"
                role="option"
                :aria-selected="item.opt.value === modelValue ? 'true' : 'false'"
                :aria-disabled="item.opt.disabled ? 'true' : undefined"
                :class="[
                  'ds-select__option',
                  {
                    'is-active': item.index === activeIndex,
                    'is-selected': item.opt.value === modelValue,
                    'is-disabled': item.opt.disabled,
                  },
                ]"
                @click="onOptionClick(item.opt)"
                @mousemove="onOptionHover(item.index)"
              >
                <slot name="option" :option="item.opt" :active="item.index === activeIndex" :selected="item.opt.value === modelValue">{{ item.opt.label }}</slot>
              </li>
            </template>
          </template>
          <template v-else>
            <li
              v-for="(opt, i) in options"
              :key="opt.value"
              :id="`${listboxId}-opt-${i}`"
              role="option"
              :aria-selected="opt.value === modelValue ? 'true' : 'false'"
              :aria-disabled="opt.disabled ? 'true' : undefined"
              :class="[
                'ds-select__option',
                {
                  'is-active': i === activeIndex,
                  'is-selected': opt.value === modelValue,
                  'is-disabled': opt.disabled,
                },
              ]"
              @click="onOptionClick(opt)"
              @mousemove="onOptionHover(i)"
            >
              <slot name="option" :option="opt" :active="i === activeIndex" :selected="opt.value === modelValue">{{ opt.label }}</slot>
            </li>
          </template>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'

interface DsSelectOption {
  value: string | number
  label: string
  disabled?: boolean
  /** 允许任意附加字段，供 groupKey 取值或 option slot 使用 */
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  modelValue?: string | number | null
  options: DsSelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  /** 可选：按 option 上此字段分组渲染；不传则平铺。分组标题渲染为不可选的 presentation li。 */
  groupKey?: string
}>(), {
  disabled: false,
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  open: []
  close: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const listboxRef = ref<HTMLUListElement | null>(null)

const listboxId = `ds-select-listbox-${Math.random().toString(36).slice(2, 9)}`
const open = ref(false)
const activeIndex = ref(-1)
const popupStyle = ref<Record<string, string>>({})
let inputFocusedBeforeList = false
let typeAheadBuffer = ''
let typeAheadTimer: ReturnType<typeof setTimeout> | null = null

const selectedLabel = computed(() => {
  if (props.modelValue == null) return ''
  const opt = props.options.find((o) => o.value === props.modelValue)
  return opt ? opt.label : ''
})

const activeOptionId = computed(() => {
  if (activeIndex.value < 0) return ''
  return `${listboxId}-opt-${activeIndex.value}`
})

/**
 * 按 props.groupKey 把 options 聚合成分组（仅 groupKey 存在时使用）。
 * 保留 options 数组中的首次出现顺序；每项含 opt 及其在原数组中的 index（供 activeIndex/aria 拼接 ID）。
 * option 上 groupKey 字段缺失时归入 '其他' 分组。
 */
const groupedOptions = computed<{ key: string; items: { opt: DsSelectOption; index: number }[] }[]>(() => {
  const key = props.groupKey
  if (!key) return []
  const map = new Map<string, { opt: DsSelectOption; index: number }[]>()
  props.options.forEach((opt, index) => {
    const raw = opt[key]
    const k = raw == null || raw === '' ? '其他' : String(raw)
    const arr = map.get(k)
    if (arr) arr.push({ opt, index })
    else map.set(k, [{ opt, index }])
  })
  return Array.from(map, ([key, items]) => ({ key, items }))
})

/** 找到当前选中项的索引，用于打开 listbox 时定位激活项 */
function findSelectedIndex(): number {
  if (props.modelValue == null) return -1
  return props.options.findIndex((o) => o.value === props.modelValue)
}

/** 在 [0, n) 范围内从 start 起按 step 找下一个非 disabled 项；找不到返回 -1 */
function findEnabled(start: number, step: 1 | -1): number {
  const n = props.options.length
  let i = start
  while (i >= 0 && i < n) {
    if (!props.options[i].disabled) return i
    i += step
  }
  return -1
}

function clampActive(i: number): number {
  if (i < 0) return -1
  if (i >= props.options.length) return props.options.length - 1
  return i
}

function openList() {
  if (props.disabled || open.value) return
  open.value = true
  // 激活当前选中项；若没有则第一项
  const sel = findSelectedIndex()
  const firstEnabled = findEnabled(0, 1)
  activeIndex.value = sel >= 0 ? sel : firstEnabled
  emit('open')
  nextTick(updatePopupPosition)
  window.addEventListener('scroll', updatePopupPosition, true)
  window.addEventListener('resize', updatePopupPosition)
  document.addEventListener('mousedown', onOutsideClick, true)
}

function closeList(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  activeIndex.value = -1
  emit('close')
  window.removeEventListener('scroll', updatePopupPosition, true)
  window.removeEventListener('resize', updatePopupPosition)
  document.removeEventListener('mousedown', onOutsideClick, true)
  if (restoreFocus && inputRef.value) {
    // 让 input 重新获得焦点，便于继续键盘操作
    inputRef.value.focus()
  }
}

function toggle() {
  if (open.value) closeList()
  else openList()
}

function updatePopupPosition() {
  if (!inputRef.value) return
  const r = inputRef.value.getBoundingClientRect()
  const listH = listboxRef.value?.offsetHeight ?? 200
  const spaceBelow = window.innerHeight - r.bottom
  const above = spaceBelow < listH + 8 && r.top > spaceBelow
  const top = above ? r.top - listH - 4 : r.bottom + 4
  popupStyle.value = {
    position: 'fixed',
    top: `${Math.max(4, top)}px`,
    left: `${r.left}px`,
    'min-width': `${r.width}px`,
    'max-width': `${Math.min(window.innerWidth - 8, r.width * 1.5)}px`,
  }
}

function onOutsideClick(e: MouseEvent) {
  const t = e.target as Node
  if (inputRef.value?.contains(t)) return
  if (listboxRef.value?.contains(t)) return
  // caret 按钮的点击会自行处理 toggle，此处不再关闭
  closeList(false)
}

function onInputFocus() {
  inputFocusedBeforeList = true
}

function onInputBlur() {
  // 点击 listbox option 时会触发 input blur，但 mousedown.prevent 已阻止 input 失焦；
  // 此处仅在真正点外部时关闭
  if (!open.value) return
  // 用 setTimeout 让 mousedown/click 先处理
  setTimeout(() => {
    if (document.activeElement !== inputRef.value && !listboxRef.value?.contains(document.activeElement)) {
      closeList(false)
    }
  }, 0)
}

function onListMouseDown(e: MouseEvent) {
  // 阻止 input blur；click 仍会触发
  e.preventDefault()
}

function onOptionClick(opt: DsSelectOption) {
  if (opt.disabled) return
  selectOption(opt)
}

function onOptionHover(i: number) {
  if (props.options[i].disabled) return
  activeIndex.value = i
}

function selectOption(opt: DsSelectOption) {
  if (opt.disabled) return
  emit('update:modelValue', opt.value)
  closeList(true)
}

function onKeyDown(e: KeyboardEvent) {
  if (props.disabled) return
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      if (!open.value) {
        openList()
        return
      }
      // 找下一个非 disabled，到末尾不回环
      const next = findEnabled(activeIndex.value + 1, 1)
      if (next >= 0) activeIndex.value = next
      return
    }
    case 'ArrowUp': {
      e.preventDefault()
      if (!open.value) {
        openList()
        return
      }
      const prev = findEnabled(activeIndex.value - 1, -1)
      if (prev >= 0) activeIndex.value = prev
      return
    }
    case 'Home': {
      e.preventDefault()
      if (!open.value) openList()
      const first = findEnabled(0, 1)
      if (first >= 0) activeIndex.value = first
      return
    }
    case 'End': {
      e.preventDefault()
      if (!open.value) openList()
      const last = findEnabled(props.options.length - 1, -1)
      if (last >= 0) activeIndex.value = last
      return
    }
    case 'Enter': {
      if (!open.value) return
      e.preventDefault()
      const opt = props.options[clampActive(activeIndex.value)]
      if (opt && !opt.disabled) selectOption(opt)
      return
    }
    case 'Escape': {
      if (!open.value) return
      e.preventDefault()
      closeList(true)
      return
    }
    case 'Tab': {
      if (open.value) closeList(false)
      return // 不 preventDefault，让 Tab 正常切换焦点
    }
    case 'Backspace':
    case 'Delete': {
      typeAheadBuffer = ''
      return
    }
    default: {
      // 可打印字符 → type-ahead
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        runTypeAhead(e.key)
      }
    }
  }
}

function runTypeAhead(ch: string) {
  if (!open.value) openList()
  if (typeAheadTimer) clearTimeout(typeAheadTimer)
  typeAheadBuffer = (typeAheadBuffer + ch).toLowerCase()
  typeAheadTimer = setTimeout(() => { typeAheadBuffer = '' }, 1500)
  // 从当前激活项的下一项开始找，找不到再从头找
  const start = activeIndex.value >= 0 ? activeIndex.value + 1 : 0
  const n = props.options.length
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    const opt = props.options[i]
    if (opt.disabled) continue
    if (opt.label.toLowerCase().startsWith(typeAheadBuffer)) {
      activeIndex.value = i
      break
    }
  }
}

// 外部更新 modelValue 时同步 activeIndex（listbox 打开时）
watch(() => props.modelValue, () => {
  if (open.value) {
    const sel = findSelectedIndex()
    if (sel >= 0) activeIndex.value = sel
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', updatePopupPosition, true)
  window.removeEventListener('resize', updatePopupPosition)
  document.removeEventListener('mousedown', onOutsideClick, true)
  if (typeAheadTimer) clearTimeout(typeAheadTimer)
})

defineExpose({ openList, closeList, toggle })
</script>

<style scoped>
.ds-select {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  --ds-select-h: 36px;
  --ds-select-h-sm: 28px;
}
.ds-select--sm {
  --ds-select-h: var(--ds-select-h-sm);
}
.ds-select__input {
  flex: 1;
  min-width: 0;
  height: var(--ds-select-h);
  padding: 0 32px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--fs-body);
  font-family: var(--font-body);
  outline: none;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
  box-sizing: border-box;
}
.ds-select__input::-webkit-calendar-picker-indicator { display: none; }
.ds-select__input:focus-visible,
.ds-select__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 24%, transparent);
  cursor: text;
}
.ds-select__input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ds-select--open .ds-select__input {
  border-color: var(--accent);
}

.ds-select__caret {
  position: absolute;
  top: 0;
  right: 0;
  width: 28px;
  height: var(--ds-select-h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
}
.ds-select__caret:disabled {
  cursor: not-allowed;
}
.ds-select--open .ds-select__caret {
  color: var(--text-primary);
}
.ds-select__caret svg {
  transition: transform var(--duration-fast) var(--ease-out);
}
.ds-select--open .ds-select__caret svg {
  transform: rotate(180deg);
}

.ds-select__listbox {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  box-shadow: var(--shadow-md);
  z-index: 1001;
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: var(--fs-body);
  font-family: var(--font-body);
  color: var(--text-primary);
}

.ds-select__option {
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  line-height: 1.4;
  scroll-margin: 4px;
}
.ds-select__option.is-active {
  background: var(--bg-secondary);
}
.ds-select__option.is-selected {
  color: var(--accent);
  font-weight: 600;
}
.ds-select__option.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ds-select__option.is-disabled.is-active {
  background: transparent;
}

.ds-select__group-header {
  padding: 6px 12px 4px;
  font-size: 0.7em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  font-weight: 600;
  user-select: none;
  cursor: default;
}
.ds-select__group-header:first-child {
  padding-top: 2px;
}

/* Transition */
.ds-select-enter-active,
.ds-select-leave-active {
  transition: opacity var(--duration-instant) var(--ease-out),
              transform var(--duration-instant) var(--ease-out);
}
.ds-select-enter-from,
.ds-select-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .ds-select__caret svg { transition: none; }
  .ds-select-enter-active,
  .ds-select-leave-active {
    transition: opacity var(--duration-instant) linear;
    transform: none;
  }
  .ds-select-enter-from,
  .ds-select-leave-to {
    transform: none;
  }
}
</style>
