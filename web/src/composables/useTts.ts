/**
 * TTS 朗读（GAP-A2-001）— Web Speech API 封装，零依赖零 API 成本。
 *
 * 采用浏览器 speechSynthesis（WebView2 映射 Windows 系统语音），不依赖任何
 * 云端 TTS 服务；OMP 的 providers.tts（Kokoro/xAI）需要额外运行时模型或付费
 * API，按产品原则（不要求用户配置付费 API）不接入。
 *
 * 配置来源：/settings/tts（panel_configs.json），provider 固定为 "system"。
 * 所有路径安全降级：无 speechSynthesis / 未启用 / 无语音时静默。
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

/** 列出系统可用语音（含 voiceschanged 补载；zh 优先排序） */
export function listSystemVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    // 某些引擎异步加载语音列表——注册一次性补载回调（模块级去重）
    window.speechSynthesis.onvoiceschanged ??= () => {
      // 仅触发一次后释放，避免长驻
      window.speechSynthesis.onvoiceschanged = null
    }
  }
  return voices
}

/** 全局朗读状态（消息气泡"朗读/停止"按钮的响应式标签来源） */
export const speakingState = ref(false)

/** 朗读文本。未启用 / 无语音 / 无 API 时返回 false。 */
export function speakText(text: string): boolean {
  if (!isSpeechSupported() || !text) return false
  const synth = window.speechSynthesis
  // 朗读中再次调用 → 打断重读（与"停止"按钮语义一致）
  if (synth.speaking) synth.cancel()

  const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, '（代码块）'))
  utterance.onstart = () => { speakingState.value = true }
  utterance.onend = () => { speakingState.value = false }
  utterance.onerror = () => { speakingState.value = false }
  void loadTtsConfig().then((cfg) => {
    if (!cfg.enabled) return
    const voices = listSystemVoices()
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
    synth.speak(utterance)
  })
  return true
}

/** 停止当前朗读 */
export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
  speakingState.value = false
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
    speakText(text)
  })
}

// 组件用响应式入口（MessageBubble 朗读按钮 / 设置页试听）
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
