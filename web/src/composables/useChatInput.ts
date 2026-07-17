// web/src/composables/useChatInput.ts
//
// useChatInput — ChatInput 状态收敛 composable（骨架）
//
// 当前状态：骨架文件，未接入 ChatView.vue / ChatInput.vue。
//   - ChatView.vue 当前向 ChatInput 传 8 个 props + 5 个 emits，状态分散
//   - 本 composable 预留统一的输入状态接口，供后续 Agent 33/35 协调接入
//   - 接入前不要调用本 composable；下面方法为占位实现
//
// 接入计划（不在本次范围内）：
//   1. ChatView 用 useChatInput() 收敛 isStreaming/canSend/providerId/modelName/... 状态
//   2. ChatInput 改为接收单个 composable 返回对象（或保留 props 但从 composable 取值）
//   3. send/stop/modelChange/commitQuote/removeQuote 由 composable 通过回调上抛

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { QuotedSelection, QuoteCandidate } from '@/composables/useSelectionQuote'
import type { ParsedRef } from '@/utils/references'
import type { ThinkPathId } from '@/utils/thinkPath'

export interface UseChatInputOptions {
  /** 是否正在流式输出（对应 ChatInput.isStreaming） */
  isStreaming?: Ref<boolean>
  /** 是否可发送（对应 ChatInput.canSend，通常是 connected） */
  canSend?: Ref<boolean>
  /** 初始 provider id（对应 ChatInput.initialProviderId） */
  initialProviderId?: Ref<string | null>
  /** 初始 model name（对应 ChatInput.initialModelName） */
  initialModelName?: Ref<string | null>
  /** 服务端 think_path 能力开关（对应 ChatInput.thinkPathEnabled） */
  thinkPathEnabled?: Ref<boolean>
  /** 已提交的引用选区（对应 ChatInput.quotedSelections） */
  quotedSelections?: Ref<QuotedSelection[]>
  /** 待确认的引用候选（对应 ChatInput.quoteCandidate） */
  quoteCandidate?: Ref<QuoteCandidate | null>

  // ── 事件回调（接入时由 ChatView 提供） ──
  onSend?: (text: string, refs: ParsedRef[], providerId?: string, modelName?: string, thinkPathId?: ThinkPathId, model?: string, temperature?: number, maxTokens?: number) => void
  onStop?: () => void
  onModelChange?: (providerId: string, modelName: string) => void
  onCommitQuote?: () => void
  onRemoveQuote?: (id: string) => void
}

export interface UseChatInputReturn {
  // ── 输入框状态 ──
  text: Ref<string>
  isStreaming: Ref<boolean>
  disabled: Ref<boolean>
  canSend: Ref<boolean>
  providerId: Ref<string | null>
  modelName: Ref<string | null>
  thinkPathEnabled: Ref<boolean>
  quotedSelections: Ref<QuotedSelection[]>
  quoteCandidate: Ref<QuoteCandidate | null>
  // ── 派生 ──
  /** 是否可提交：有文本且未在流式输出且可发送 */
  canSubmit: ComputedRef<boolean>
  // ── 方法（骨架占位，接入前不会真正触发事件） ──
  send: (text: string, refs?: ParsedRef[], thinkPathId?: ThinkPathId, model?: string, temperature?: number, maxTokens?: number) => void
  stop: () => void
  onModelChange: (providerId: string, modelName: string) => void
  commitQuote: () => void
  removeQuote: (id: string) => void
  // ── 文本操作（可独立使用，不依赖 ChatView/ChatInput 接线） ──
  /** 清空输入文本（典型场景：发送后调用） */
  clearText: () => void
  /** 追加文本到输入框末尾（典型场景：引用插入、快捷输入） */
  appendText: (suffix: string) => void
  /** 显式设置输入文本（典型场景：外部程序化填入） */
  setText: (next: string) => void
}

/**
 * ChatInput 状态收敛 composable。
 *
 * ⚠️ 骨架：当前未被 ChatView/ChatInput 引用。
 *   - send/stop/onModelChange/commitQuote/removeQuote 为占位实现（未接线时打印 warning）
 *   - clearText/appendText/setText 为真实实现，可独立使用（不依赖回调接线）
 * 接入工作由 Agent 33/35 协调完成（不在本 agent 独占文件范围内）。
 */
export function useChatInput(options: UseChatInputOptions = {}): UseChatInputReturn {
  const {
    isStreaming: extIsStreaming,
    canSend: extCanSend,
    initialProviderId,
    initialModelName,
    thinkPathEnabled: extThinkPathEnabled,
    quotedSelections: extQuotedSelections,
    quoteCandidate: extQuoteCandidate,
    onSend,
    onStop,
    onModelChange: onModelChangeCb,
    onCommitQuote,
    onRemoveQuote,
  } = options

  // 内部状态：若外部未提供 ref，则用本地 ref 占位
  const localText = ref('')
  const localIsStreaming = ref(false)
  const localCanSend = ref(false)
  const localProviderId = ref<string | null>(null)
  const localModelName = ref<string | null>(null)
  const localThinkPathEnabled = ref(false)
  const localQuotedSelections = ref<QuotedSelection[]>([])
  const localQuoteCandidate = ref<QuoteCandidate | null>(null)

  // 优先使用外部 ref，否则回退到本地 ref
  const isStreaming = extIsStreaming ?? localIsStreaming
  const canSend = extCanSend ?? localCanSend
  const providerId = initialProviderId ?? localProviderId
  const modelName = initialModelName ?? localModelName
  const thinkPathEnabled = extThinkPathEnabled ?? localThinkPathEnabled
  const quotedSelections = extQuotedSelections ?? localQuotedSelections
  const quoteCandidate = extQuoteCandidate ?? localQuoteCandidate

  // disabled 在 ChatView 中恒为 false，这里保留接口但默认 false
  const disabled = ref(false)

  const canSubmit = computed(() =>
    localText.value.trim().length > 0 && !isStreaming.value && canSend.value && !disabled.value
  )

  function send(
    text: string,
    refs: ParsedRef[] = [],
    thinkPathId?: ThinkPathId,
    model?: string,
    temperature?: number,
    maxTokens?: number,
  ) {
    if (onSend) {
      onSend(
        text,
        refs,
        providerId.value ?? undefined,
        modelName.value ?? undefined,
        thinkPathId,
        model,
        temperature,
        maxTokens,
      )
    } else {
      console.warn('[useChatInput] send() called but onSend callback not wired — skeleton mode')
    }
  }

  function stop() {
    if (onStop) {
      onStop()
    } else {
      console.warn('[useChatInput] stop() called but onStop callback not wired — skeleton mode')
    }
  }

  function onModelChange(newProviderId: string, newModelName: string) {
    providerId.value = newProviderId
    modelName.value = newModelName
    if (onModelChangeCb) {
      onModelChangeCb(newProviderId, newModelName)
    } else {
      console.warn('[useChatInput] onModelChange() called but onModelChange callback not wired — skeleton mode')
    }
  }

  function commitQuote() {
    if (onCommitQuote) {
      onCommitQuote()
    } else {
      console.warn('[useChatInput] commitQuote() called but onCommitQuote callback not wired — skeleton mode')
    }
  }

  function removeQuote(id: string) {
    if (onRemoveQuote) {
      onRemoveQuote(id)
    } else {
      console.warn('[useChatInput] removeQuote() called but onRemoveQuote callback not wired — skeleton mode')
    }
  }

  // ── 文本操作：可独立使用，不依赖回调接线 ──
  function clearText() {
    localText.value = ''
  }

  function appendText(suffix: string) {
    localText.value += suffix
  }

  function setText(next: string) {
    localText.value = next
  }

  return {
    text: localText,
    isStreaming,
    disabled,
    canSend,
    providerId,
    modelName,
    thinkPathEnabled,
    quotedSelections,
    quoteCandidate,
    canSubmit,
    send,
    stop,
    onModelChange,
    commitQuote,
    removeQuote,
    clearText,
    appendText,
    setText,
  }
}
