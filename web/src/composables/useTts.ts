/**
 * TTS 朗读（GAP-A2-001）— Web Speech API 封装，零依赖零 API 成本。
 *
 * 采用浏览器 speechSynthesis（WebView2 映射 Windows 系统语音），不依赖任何
 * 云端 TTS 服务；OMP 的 providers.tts（Kokoro/xAI）需要额外运行时模型或付费
 * API，按产品原则（不要求用户配置付费 API）不接入。
 *
 * 配置来源：/settings/tts（panel_configs.json），provider 固定为 "system"。
 * 所有路径安全降级，且失败原因可诊断（TTS-BUGFIX-001：此前的静默失败 +
 * 误报"未启用"让用户以为功能坏了——现在 speakText 返回明确结果枚举，
 * 调用方据此给出精确反馈）。
 */
import { ref } from 'vue'
import { api, type TtsConfig } from '@/api'
import { createLogger } from '@/utils/logger'

const log = createLogger('tts')

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: false,
  provider: 'system',
  voice: '',
  speed: 1.0,
  pitch: 1.0,
  auto_read: false,
}

let cachedConfig: TtsConfig | null = null
let cachedAt = 0
const CONFIG_TTL_MS = 60_000
let configPromise: Promise<TtsConfig> | null = null

/** 加载 TTS 配置（60s TTL + in-flight 去重；失败回退默认值，不阻塞朗读入口） */
export async function loadTtsConfig(): Promise<TtsConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedAt < CONFIG_TTL_MS) return cachedConfig
  if (configPromise) return configPromise
  configPromise = api.getTtsConfig()
    .then((cfg) => {
      cachedConfig = { ...DEFAULT_TTS_CONFIG, ...cfg }
      cachedAt = Date.now()
      return cachedConfig
    })
    .catch((err) => {
      log.warn('加载 TTS 配置失败，使用默认值:', err)
      return { ...DEFAULT_TTS_CONFIG }
    })
    .finally(() => { configPromise = null })
  return configPromise
}

/** 使缓存失效（设置页保存后调用，避免 60s 内读到旧配置） */
export function invalidateTtsConfigCache(): void {
  cachedConfig = null
  cachedAt = 0
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** 列出系统可用语音（含 voiceschanged 补载） */
export function listSystemVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return []
  return window.speechSynthesis.getVoices()
}

/** 等待系统语音列表就绪（WebView2/Chrome 首次异步加载）。
 *  TTS-BUGFIX-001：voices 未就绪时 speak 可能静默失败，等待 voiceschanged
 *  事件（500ms 超时）后返回当前列表。 */
export function waitVoicesReady(timeoutMs = 500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    const voices = synth.getVoices()
    if (voices.length > 0) {
      resolve(voices)
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(synth.getVoices())
    }, timeoutMs)
    const onChanged = () => {
      cleanup()
      resolve(synth.getVoices())
    }
    const cleanup = () => {
      clearTimeout(timer)
      synth.onvoiceschanged = null
    }
    synth.onvoiceschanged = onChanged
  })
}

/** 全局朗读状态（消息气泡"朗读/停止"按钮的响应式标签来源） */
export const speakingState = ref(false)

/** 朗读结果枚举——调用方据此给用户精确反馈（不再盲猜"未启用"） */
export type SpeakResult =
  | 'ok'                 // 已提交朗读（可能仍在启动）
  | 'unsupported'        // 环境不支持 speechSynthesis
  | 'disabled'           // 配置未启用 TTS
  | 'load-config-failed' // 配置加载失败
  | 'error'              // speak 抛错

/** 最近一次朗读的引擎错误（onerror 原因透出，供诊断） */
export const lastSpeakError = ref('')

/**
 * 朗读文本。返回结果枚举：
 * - 'ok'：已提交（onstart 前 speak 可能仍在初始化，引擎启动由
 *   speakingState 反映；调用方可在 3-4s 后复查）
 * - 'disabled' / 'unsupported' / 'error'：未启动，调用方直接提示
 */
export async function speakText(text: string): Promise<SpeakResult> {
  if (!isSpeechSupported() || !text) return 'unsupported'
  const synth = window.speechSynthesis
  // 朗读中再次调用 → 打断重读（与"停止"按钮语义一致）
  if (synth.speaking) synth.cancel()

  let cfg: TtsConfig
  try {
    cfg = await loadTtsConfig()
  } catch {
    return 'load-config-failed'
  }
  if (!cfg.enabled) return 'disabled'

  // TTS-BUGFIX-001：voices 未就绪时等待（避免 WebView2 首次静默失败）
  const voices = await waitVoicesReady()

  const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, '（代码块）'))
  utterance.onstart = () => { speakingState.value = true }
  utterance.onend = () => {
    speakingState.value = false
    lastSpeakError.value = ''
  }
  utterance.onerror = (e) => {
    speakingState.value = false
    lastSpeakError.value = String((e as SpeechSynthesisErrorEvent)?.error ?? 'unknown')
  }
  if (cfg.voice) {
    const match = voices.find((v) => v.name === cfg.voice || v.voiceURI === cfg.voice)
    if (match) utterance.voice = match
  } else {
    // 默认优先中文女声，其次任意中文，最后系统默认
    const zhFemale = voices.find((v) => v.lang?.toLowerCase().startsWith('zh') && /female|xiaoxiao|yaoyao|晓|女/i.test(v.name))
    const zh = voices.find((v) => v.lang?.toLowerCase().startsWith('zh'))
    utterance.voice = zhFemale ?? zh ?? null
  }
  utterance.lang = utterance.voice?.lang ?? 'zh-CN'
  utterance.rate = cfg.speed ?? 1.0
  utterance.pitch = cfg.pitch ?? 1.0
  try {
    synth.speak(utterance)
    return 'ok'
  } catch (err) {
    log.warn('speak 失败:', err)
    lastSpeakError.value = String(err)
    return 'error'
  }
}

/** 停止当前朗读 */
export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
  speakingState.value = false
  lastSpeakError.value = ''
}

/**
 * 自动朗读：回复完成时调用。仅在配置启用 + auto_read 开启时朗读。
 * useChat 的 done 处理器中调用（每次轮次完成恰好一次，天然防重）。
 */
export function autoReadIfEnabled(text: string): void {
  if (!isSpeechSupported() || !text) return
  void loadTtsConfig().then((cfg) => {
    if (!cfg.enabled || !cfg.auto_read) return
    // 用户正手动朗读时打断（最新动作优先）
    if (window.speechSynthesis.speaking) window.speechSynthesis.cancel()
    void speakText(text)
  })
}

/** 组件用响应式入口（MessageBubble 朗读按钮 / 设置页试听） */
export function useTts() {
  const config = ref<TtsConfig>({ ...DEFAULT_TTS_CONFIG })
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      config.value = { ...DEFAULT_TTS_CONFIG, ...(await loadTtsConfig()) }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return {
    config,
    loading,
    error,
    load,
    speak: speakText,
    stop: stopSpeaking,
    speaking: speakingState,
    voices: listSystemVoices,
  }
}
