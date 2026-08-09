/**
 * useChatSend — ChatInput 的发送状态机。
 *
 * 收敛：发送按钮反馈状态（success 弹簧 / error 抖动）、连接错误横幅的
 * 自动消失计时、消息发送入口。减少 ChatInput.vue 的单文件体积。
 */
import { ref } from 'vue'
import type { ThinkPathId } from '@/utils/thinkPath'

const CONNECTION_TIMEOUT_MS = 5000
const SEND_FEEDBACK_MS = 800
const SEND_ERROR_MS = 600

export interface UseChatSendOptions<TRefs> {
  /** 当前输入文本 */
  text: () => string
  /** 附件引用（FileUpload refs） */
  getRefs: () => TRefs[]
  /** 是否有图片附件（图片也算可发送内容） */
  hasImage: () => boolean
  /** 选择的思考路径 */
  getThinkPath: () => ThinkPathId | null | undefined
  /** 后端连接中不可发送 */
  isDisabled: () => boolean
  /** 是否可发送（连接就绪） */
  canSend: () => boolean
  /** 实际发送（返回是否成功） */
  send: (msg: string, refs: TRefs[], thinkPath: ThinkPathId | undefined) => boolean
  /** 发送成功后的清理（清空输入/附件/自动缩放） */
  onSendSuccess: () => void
}

export function useChatSend<TRefs>(opts: UseChatSendOptions<TRefs>) {
  const connectionError = ref<string | null>(null)
  const sendState = ref<'idle' | 'success' | 'error'>('idle')
  const sendBtnRef = ref<HTMLElement | null>(null)

  let _connectionErrorTimer: ReturnType<typeof setTimeout> | null = null
  let _sendStateTimer: ReturnType<typeof setTimeout> | null = null

  function clearSendStateTimer() {
    if (_sendStateTimer) { clearTimeout(_sendStateTimer); _sendStateTimer = null }
  }

  /** 显示连接错误横幅并在 5s 后自动消失（同文案不重复计时）。 */
  function showConnectionError(message: string) {
    connectionError.value = message
    if (_connectionErrorTimer) clearTimeout(_connectionErrorTimer)
    _connectionErrorTimer = setTimeout(() => {
      if (_connectionErrorTimer && connectionError.value === message) {
        connectionError.value = null
        _connectionErrorTimer = null
      }
    }, CONNECTION_TIMEOUT_MS)
  }

  function handleSend() {
    const msg = opts.text().trim()
    if (!msg && !opts.hasImage()) return
    if (opts.isDisabled()) return

    if (!opts.canSend()) {
      showConnectionError('无法连接到 AI 引擎（sidecar 未启动），请检查后端配置')
      return
    }

    const sent = opts.send(msg, opts.getRefs(), opts.getThinkPath() || undefined)
    if (!sent) {
      sendState.value = 'error'
      clearSendStateTimer()
      _sendStateTimer = setTimeout(() => { sendState.value = 'idle'; _sendStateTimer = null }, SEND_ERROR_MS)
      showConnectionError('消息发送失败：WebSocket 连接已断开，请重试')
      return
    }

    sendState.value = 'success'
    clearSendStateTimer()
    _sendStateTimer = setTimeout(() => { sendState.value = 'idle'; _sendStateTimer = null }, SEND_FEEDBACK_MS)
    opts.onSendSuccess()
  }

  function cleanupSendTimers() {
    if (_connectionErrorTimer) clearTimeout(_connectionErrorTimer)
    _connectionErrorTimer = null
    clearSendStateTimer()
  }

  return {
    connectionError,
    sendState,
    sendBtnRef,
    handleSend,
    cleanupSendTimers,
  }
}
