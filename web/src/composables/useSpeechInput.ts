/**
 * 语音输入（GAP-A1-001）— Web Speech API 听写封装，零依赖零付费 API。
 *
 * 采用浏览器内置 SpeechRecognition（WebView2/Chromium 平台能力，识别服务
 * 由浏览器/OS 提供，用户无需配置任何 API key）。OMP 自身的 STT 挂在 TUI
 * 输入层（input-controller/custom-editor），sidecar 无输入管线，故不走 OMP。
 *
 * 行为：
 * - start()：开始听写，中间结果经 onResult(isFinal=false) 回调（用于实时
 *   回显）；结束/停止后最终结果经 onResult(isFinal=true) 提交。
 * - stop()：手动停止（提交最终结果）；abort()：放弃（丢弃本次结果）。
 * - 所有失败路径（不支持 / 麦克风权限拒绝 / 网络错误）经 onError 回调，
 *   调用方负责用户可见反馈。
 * - 识别对象每次 start 重新创建（SpeechRecognition 单次使用）。
 */
import { ref, type Ref } from 'vue'

export interface SpeechInputHandlers {
  onResult: (text: string, isFinal: boolean) => void
  onError?: (message: string) => void
  onEnd?: () => void
}

export interface SpeechInputController {
  /** 当前环境是否支持语音识别 */
  supported: boolean
  /** 是否正在听写（响应式） */
  listening: Ref<boolean>
  /**
   * 启动听写。base 为输入框现有文本——听写结果追加在其后（中间结果实时
   * 经 onResult(isFinal=false) 回写，最终结果 isFinal=true）。
   * 返回 false 表示环境不支持（错误已通过 onError 告知）。
   */
  start: (base?: string) => boolean
  /** 停止听写并提交最终结果（无结果时静默结束）。 */
  stop: () => void
  /** 放弃本次听写（不提交）。 */
  abort: () => void
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return typeof ctor === 'function' ? (ctor as new () => SpeechRecognitionLike) : null
}

/** 模块级缓存：支持性判断（构造函数存在即可，运行期错误另有回调） */
let _supportCache: boolean | null = null
export function isSpeechInputSupported(): boolean {
  if (_supportCache === null) {
    _supportCache = getRecognitionCtor() !== null
  }
  return _supportCache
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在系统设置中允许麦克风后重试',
  'service-not-allowed': '语音服务不可用，请检查网络后重试',
  'network': '语音识别网络错误，请检查网络连接后重试',
  'no-speech': '未检测到语音，请靠近麦克风重试',
  'audio-capture': '未检测到麦克风设备',
  'aborted': '',
}

export function useSpeechInput(handlers: SpeechInputHandlers): SpeechInputController {
  const listening = ref(false)
  let recognition: SpeechRecognitionLike | null = null
  let baseText = ''
  let interimBuffer = ''
  let committing = false

  function reset() {
    recognition = null
    interimBuffer = ''
    committing = false
    listening.value = false
    handlers.onEnd?.()
  }

  function start(base?: string): boolean {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      handlers.onError?.('当前环境不支持语音输入（需要 Web Speech API）')
      return false
    }
    if (listening.value) return true
    baseText = base ?? ''
    interimBuffer = ''
    committing = false

    const rec = new Ctor()
    // 跟随界面语言：优先中文，其次浏览器语言
    rec.lang = /^zh/i.test(navigator.language) ? 'zh-CN' : navigator.language
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      listening.value = true
    }
    rec.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }
      if (final) {
        // 最终片段到达：并入基准文本并清除临时缓冲（后续 interim 从头累加）
        baseText += final
        interimBuffer = ''
        handlers.onResult(baseText + interim, false)
      } else if (interim) {
        interimBuffer = interim
        handlers.onResult(baseText + interim, false)
      }
    }
    rec.onerror = (event) => {
      const message = ERROR_MESSAGES[event.error] ?? ''
      if (event.error === 'aborted') {
        // 主动 abort/stop 触发的错误，静默处理
        reset()
        return
      }
      if (message) {
        handlers.onError?.(message)
      } else {
        handlers.onError?.(`语音识别失败（${event.error}）`)
      }
      reset()
    }
    rec.onend = () => {
      // 正常自然结束（用户停顿/说完）：提交最终结果
      if (!committing) {
        committing = true
        handlers.onResult(baseText, true)
      }
      reset()
    }

    recognition = rec
    try {
      rec.start()
      return true
    } catch {
      handlers.onError?.('语音识别启动失败，请重试')
      recognition = null
      listening.value = false
      return false
    }
  }

  function stop() {
    if (!recognition || !listening.value) return
    committing = true
    try {
      recognition.stop()
    } catch {
      // stop 抛错时兜底提交当前内容
      handlers.onResult(baseText + interimBuffer, true)
      reset()
    }
  }

  function abort() {
    if (!recognition) return
    try {
      recognition.abort()
    } catch {
      /* best-effort */
    }
    reset()
  }

  return {
    supported: isSpeechInputSupported(),
    listening,
    start,
    stop,
    abort,
  }
}
