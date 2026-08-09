// web/src/composables/useMarkdownPersist.ts
// 统一 MarkdownEditor.vue 与 SoulView.vue 的 Markdown 持久化逻辑：
// 加载 / 保存 / 失焦自动保存 / saveState 三态 / Codemirror 配置 / loadError 重试

import { ref, computed, onUnmounted, type Ref, type ComputedRef } from 'vue'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { api } from '@/api'
import { createLogger } from '@/utils/logger'

const log = createLogger('markdownPersist')

/** 便携版无 DevTools 时的诊断打点：内容加载状态上报到后端日志。 */
function reportDiag(msg: string) {
  try {
    void api.request('/diagnostics/frontend', {
      method: 'POST',
      body: JSON.stringify({ kind: 'markdown-persist', msg: msg.slice(0, 1000), url: `${location.pathname}${location.hash}` }),
    }).catch(() => {})
  } catch { /* silent */ }
}

export interface UseMarkdownPersistOptions {
  /** 人格类型，决定 API 路径 */
  type: 'soul' | 'user'
  /**
   * 可选 variant 获取器（SoulView 切换人格时使用）。
   * 返回 undefined 表示默认 SOUL.md / USER.md。
   * 使用函数式获取以避免闭包持有过期值。
   */
  getVariant?: () => string | undefined
}

export interface UseMarkdownPersistReturn {
  // ── 状态 ──
  content: Ref<string>
  savedContent: Ref<string>
  loading: Ref<boolean>
  saving: Ref<boolean>
  saveState: Ref<'saved' | 'saving' | ''>
  saveError: Ref<string>
  loadError: Ref<string>
  // ── Codemirror 配置（统一） ──
  extensions: Extension[]
  // ── 派生 ──
  saveStateText: ComputedRef<string>
  /** content !== savedContent，即有未保存改动 */
  isDirty: ComputedRef<boolean>
  // ── 方法 ──
  loadContent: () => Promise<void>
  saveContent: () => Promise<void>
  /** 编辑器失焦时调用；dirty 则触发保存 */
  onBlur: () => void
  /** 重新加载（用于加载失败后的重试按钮） */
  retryLoad: () => void
}

/**
 * Markdown 持久化 composable。
 *
 * 封装 Codemirror + persona API 的加载/保存/自动保存逻辑，
 * 消除 MarkdownEditor.vue 与 SoulView.vue 的重复代码。
 */
export function useMarkdownPersist(options: UseMarkdownPersistOptions): UseMarkdownPersistReturn {
  const { type, getVariant } = options

  const content = ref('')
  const savedContent = ref('')
  const loading = ref(true)
  const saving = ref(false)
  const saveState = ref<'saved' | 'saving' | ''>('')
  const saveError = ref('')
  const loadError = ref('')

  // 统一的 Codemirror 配置：markdown 语法 + 自动换行 + 主题样式（便携版关键修复）。
  // EditorView.theme 通过 codemirror 自己的渲染管线注入 inline 样式，
  // 这是 codemirror 推荐的设置方式，能可靠覆盖内置默认 + 任意外部 CSS/inline。
  // 字体用 Microsoft YaHei（WebView2 Windows 一定有），确保中文可渲染。
  const extensions: Extension[] = [
    markdown(),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': {
        fontSize: '15px',
        fontFamily: '"Microsoft YaHei", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#1C1C1C',
        backgroundColor: 'transparent',
        height: '100%',
      },
      '.cm-content': {
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        color: '#1C1C1C',
        caretColor: '#1C1C1C',
        lineHeight: '1.6',
      },
      '.cm-line': {
        color: '#1C1C1C',
      },
    }, { dark: false }),
  ]

  const saveStateText = computed(() => {
    if (saveState.value === 'saving') return '保存中...'
    if (saveState.value === 'saved') return '已保存'
    return ''
  })

  const isDirty = computed(() => content.value !== savedContent.value)

  // 保存状态 2 秒后自动清除的定时器，组件卸载时清理
  let _saveStateTimer: ReturnType<typeof setTimeout> | null = null

  onUnmounted(() => {
    if (_saveStateTimer) {
      clearTimeout(_saveStateTimer)
      _saveStateTimer = null
    }
  })

  async function loadContent() {
    loading.value = true
    loadError.value = ''
    try {
      const variant = getVariant?.()
      const res = await api.getPersona(type, variant)
      content.value = res.content
      savedContent.value = res.content
      reportDiag(`loaded ${type}${variant ? `/${variant}` : ''} contentLen=${String(res.content || '').length}`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error(`加载 ${type} 失败`, e)
      loadError.value = msg
      content.value = ''
      reportDiag(`load-fail ${type}: ${msg}`)
    } finally {
      loading.value = false
    }
  }

  async function saveContent() {
    if (saving.value || content.value === savedContent.value) return
    saving.value = true
    saveState.value = 'saving'
    saveError.value = ''
    try {
      const variant = getVariant?.()
      await api.updatePersona(type, content.value, variant)
      savedContent.value = content.value
      saveState.value = 'saved'
      if (_saveStateTimer) clearTimeout(_saveStateTimer)
      _saveStateTimer = setTimeout(() => { saveState.value = ''; _saveStateTimer = null }, 2000)
    } catch (e: unknown) {
      log.error(`保存 ${type} 失败`, e)
      saveError.value = e instanceof Error ? e.message : String(e)
    } finally {
      saving.value = false
    }
  }

  function onBlur() {
    if (content.value !== savedContent.value) {
      saveContent()
    }
  }

  function retryLoad() {
    loadContent()
  }

  return {
    content,
    savedContent,
    loading,
    saving,
    saveState,
    saveError,
    loadError,
    extensions,
    saveStateText,
    isDirty,
    loadContent,
    saveContent,
    onBlur,
    retryLoad,
  }
}
