<template>
  <div class="settings-view" ref="rootEl">
    <div class="header">
      <h2>设置 SETTINGS</h2>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="loadError" class="empty">
      <p>加载失败: {{ loadError }}</p>
      <button class="btn" @click="loadSettings">重试</button>
    </div>
    <template v-else>
      <!-- Compaction -->
      <div class="section">
        <h3>上下文管理</h3>
        <p class="section-desc">控制 AI 如何管理对话历史和上下文窗口。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用上下文压缩</div>
            <div class="setting-desc">当对话过长时自动压缩历史消息。</div>
          </div>
          <button class="toggle-btn" :class="{ on: settings['compaction.enabled'] }" @click="toggle('compaction.enabled')">
            {{ settings['compaction.enabled'] ? '开启' : '关闭' }}
          </button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">压缩策略</div>
            <div class="setting-desc">选择上下文压缩的方式。</div>
          </div>
          <select class="select" :value="settings['compaction.strategy']" @change="set('compaction.strategy', ($event.target as HTMLSelectElement).value)">
            <option value="context-full">上下文满时压缩</option>
            <option value="handoff">交接模式</option>
            <option value="shake">精简模式</option>
            <option value="snapcompact">快速压缩</option>
            <option value="off">关闭</option>
          </select>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">压缩阈值</div>
            <div class="setting-desc">上下文使用率达到此百分比时触发压缩。</div>
          </div>
          <div class="setting-control">
            <input type="range" min="50" max="95" step="5"
              :value="settings['compaction.thresholdPercent'] ?? 80"
              @input="set('compaction.thresholdPercent', Number(($event.target as HTMLInputElement).value))" />
            <span class="range-value">{{ settings['compaction.thresholdPercent'] ?? 80 }}%</span>
          </div>
        </div>
      </div>

      <!-- Retry -->
      <div class="section">
        <h3>容错</h3>
        <p class="section-desc">控制 AI 调用失败时的重试行为。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">自动重试</div>
            <div class="setting-desc">调用失败时自动重试。</div>
          </div>
          <button class="toggle-btn" :class="{ on: settings['retry.enabled'] }" @click="toggle('retry.enabled')">
            {{ settings['retry.enabled'] ? '开启' : '关闭' }}
          </button>
        </div>

        <div class="setting-row" v-if="settings['retry.enabled']">
          <div class="setting-info">
            <div class="setting-label">最大重试次数</div>
          </div>
          <input type="number" class="input-number" min="1" max="10"
            :value="settings['retry.maxRetries'] ?? 3"
            @change="set('retry.maxRetries', Number(($event.target as HTMLInputElement).value))" />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">模型降级</div>
            <div class="setting-desc">主模型失败时切换到备用模型。</div>
          </div>
          <button class="toggle-btn" :class="{ on: settings['retry.modelFallback'] }" @click="toggle('retry.modelFallback')">
            {{ settings['retry.modelFallback'] ? '开启' : '关闭' }}
          </button>
        </div>
      </div>

      <!-- Tools -->
      <div class="section">
        <h3>工具</h3>
        <p class="section-desc">控制 AI 使用工具时的行为。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">工具审批模式</div>
            <div class="setting-desc">AI 执行工具前是否需要你确认。</div>
          </div>
          <select class="select" :value="settings['tools.approvalMode']" @change="set('tools.approvalMode', ($event.target as HTMLSelectElement).value)">
            <option value="yolo">自动批准（Yolo）</option>
            <option value="write">写操作需确认</option>
            <option value="always-ask">始终询问</option>
          </select>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">MCP 工具发现</div>
            <div class="setting-desc">自动发现并加载 MCP 服务器提供的工具。</div>
          </div>
          <select class="select" :value="settings['tools.discoveryMode']" @change="set('tools.discoveryMode', ($event.target as HTMLSelectElement).value)">
            <option value="all">全部加载</option>
            <option value="auto">自动发现</option>
            <option value="off">关闭</option>
          </select>
        </div>
      </div>

      <!-- Advisor -->
      <div class="section">
        <h3>顾问</h3>
        <p class="section-desc">启用第二个 AI 模型作为顾问，被动审查每次对话。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用顾问</div>
            <div class="setting-desc">配对一个顾问模型来审查 AI 的回复。</div>
          </div>
          <button class="toggle-btn" :class="{ on: settings['advisor.enabled'] }" @click="toggle('advisor.enabled')">
            {{ settings['advisor.enabled'] ? '开启' : '关闭' }}
          </button>
        </div>
      </div>

      <!-- Interaction -->
      <div class="section">
        <h3>交互</h3>
        <p class="section-desc">控制消息队列和中断行为。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">转向模式</div>
            <div class="setting-desc">连续发送多条消息时的处理方式。</div>
          </div>
          <select class="select" :value="settings['steeringMode']" @change="set('steeringMode', ($event.target as HTMLSelectElement).value)">
            <option value="all">全部接受</option>
            <option value="one-at-a-time">逐条处理</option>
          </select>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">中断模式</div>
            <div class="setting-desc">AI 正在回复时发送新消息的行为。</div>
          </div>
          <select class="select" :value="settings['interruptMode']" @change="set('interruptMode', ($event.target as HTMLSelectElement).value)">
            <option value="immediate">立即中断</option>
            <option value="wait">等待完成</option>
          </select>
        </div>
      </div>

      <!-- Thinking -->
      <div class="section">
        <h3>推理预算</h3>
        <p class="section-desc">控制 AI 在不同推理级别下的 token 预算。</p>

        <div class="setting-row" v-for="level in ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']" :key="level">
          <div class="setting-info">
            <div class="setting-label">{{ thinkingLevelLabel(level) }}</div>
          </div>
          <input type="number" class="input-number" min="1024" max="131072" step="1024"
            :value="settings[`thinkingBudgets.${level}`] ?? 32768"
            @change="set(`thinkingBudgets.${level}`, Number(($event.target as HTMLInputElement).value))" />
        </div>
      </div>

      <!-- Skills -->
      <div class="section">
        <h3>技能包</h3>
        <p class="section-desc">控制 OMP 技能包的启用状态。</p>
        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用技能包</div>
            <div class="setting-desc">加载 .agents/skills/ 和 .claude/skills/ 中的技能。</div>
          </div>
          <button class="toggle-btn" :class="{ on: settings['skills.enabled'] }" @click="toggle('skills.enabled')">
            {{ settings['skills.enabled'] ? '开启' : '关闭' }}
          </button>
        </div>
      </div>

      <!-- TTS / 语音 -->
      <div class="section">
        <h3>语音</h3>
        <p class="section-desc">配置文本转语音（TTS）的引擎与朗读行为。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用 TTS</div>
            <div class="setting-desc">开启后可将 AI 回复朗读出来。</div>
          </div>
          <button class="toggle-btn" :class="{ on: tts.enabled }" @click="setTts('enabled', !tts.enabled)">
            {{ tts.enabled ? '开启' : '关闭' }}
          </button>
        </div>

        <template v-if="tts.enabled">
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">TTS 引擎</div>
              <div class="setting-desc">选择语音合成提供商。</div>
            </div>
            <select class="select" :value="tts.provider" @change="onTtsProviderChange(($event.target as HTMLSelectElement).value as TtsConfig['provider'])">
              <option value="edge-tts">Edge TTS</option>
              <option value="openai-tts">OpenAI TTS</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">语音</div>
              <div class="setting-desc">根据所选引擎动态加载可用音色。</div>
            </div>
            <select class="select" :value="tts.voice" @change="setTts('voice', ($event.target as HTMLSelectElement).value)">
              <option value="">（默认）</option>
              <option v-for="v in voiceOptions" :key="v" :value="v">{{ v }}</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">语速</div>
            </div>
            <div class="setting-control">
              <input type="range" min="0.5" max="2.0" step="0.1"
                :value="tts.speed"
                @input="setTts('speed', Number(($event.target as HTMLInputElement).value))" />
              <span class="range-value">{{ tts.speed.toFixed(1) }}x</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">音调</div>
            </div>
            <div class="setting-control">
              <input type="range" min="0.5" max="2.0" step="0.1"
                :value="tts.pitch"
                @input="setTts('pitch', Number(($event.target as HTMLInputElement).value))" />
              <span class="range-value">{{ tts.pitch.toFixed(1) }}x</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">自动朗读回复</div>
              <div class="setting-desc">AI 回复完成后自动播放语音。</div>
            </div>
            <button class="toggle-btn" :class="{ on: tts.auto_read }" @click="setTts('auto_read', !tts.auto_read)">
              {{ tts.auto_read ? '开启' : '关闭' }}
            </button>
          </div>
        </template>
      </div>

      <!-- 浏览器工具 -->
      <div class="section">
        <h3>浏览器工具</h3>
        <p class="section-desc">配置 AI 内置浏览器自动化的运行方式。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用浏览器工具</div>
            <div class="setting-desc">允许 AI 打开网页、截图与抓取内容。</div>
          </div>
          <button class="toggle-btn" :class="{ on: browser.enabled }" @click="setBrowser('enabled', !browser.enabled)">
            {{ browser.enabled ? '开启' : '关闭' }}
          </button>
        </div>

        <template v-if="browser.enabled">
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Chrome 可执行文件路径</div>
              <div class="setting-desc">留空则使用自动检测的浏览器。</div>
            </div>
            <div class="setting-control">
              <input type="text" class="input-text" :value="browser.chrome_path"
                placeholder="自动检测"
                @change="setBrowser('chrome_path', ($event.target as HTMLInputElement).value)" />
              <button class="btn" @click="detectChrome">检测</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">无头模式</div>
              <div class="setting-desc">后台运行浏览器，不显示窗口。</div>
            </div>
            <button class="toggle-btn" :class="{ on: browser.headless }" @click="setBrowser('headless', !browser.headless)">
              {{ browser.headless ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">默认视口</div>
              <div class="setting-desc">浏览器窗口的宽 × 高（像素）。</div>
            </div>
            <div class="setting-control">
              <input type="number" class="input-number" min="1" max="7680"
                :value="browser.viewport_width"
                @change="setBrowser('viewport_width', Number(($event.target as HTMLInputElement).value))" />
              <span class="range-value">×</span>
              <input type="number" class="input-number" min="1" max="4320"
                :value="browser.viewport_height"
                @change="setBrowser('viewport_height', Number(($event.target as HTMLInputElement).value))" />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">拦截跟踪 / 分析</div>
              <div class="setting-desc">屏蔽常见的跟踪与统计分析请求。</div>
            </div>
            <button class="toggle-btn" :class="{ on: browser.block_tracking }" @click="setBrowser('block_tracking', !browser.block_tracking)">
              {{ browser.block_tracking ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row setting-row-block">
            <div class="setting-info">
              <div class="setting-label">允许的域名</div>
              <div class="setting-desc">每行一个域名；留空表示允许全部。</div>
            </div>
            <textarea class="textarea" rows="3" :value="browser.allowed_domains.join('\n')"
              placeholder="example.com&#10;docs.python.org"
              @change="setBrowser('allowed_domains', ($event.target as HTMLTextAreaElement).value.split('\n').map(s => s.trim()).filter(Boolean))" />
          </div>
        </template>
      </div>

      <!-- 子代理 -->
      <div class="section">
        <h3>子代理</h3>
        <p class="section-desc">控制 AI 派生子代理并行处理任务的行为。</p>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-label">启用子代理</div>
            <div class="setting-desc">允许主 AI 派生子代理处理子任务。</div>
          </div>
          <button class="toggle-btn" :class="{ on: subagent.enabled }" @click="setSubAgent('enabled', !subagent.enabled)">
            {{ subagent.enabled ? '开启' : '关闭' }}
          </button>
        </div>

        <template v-if="subagent.enabled">
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">最大并发数</div>
              <div class="setting-desc">同时运行的子代理上限。</div>
            </div>
            <div class="setting-control">
              <input type="range" min="1" max="10" step="1"
                :value="subagent.max_concurrent"
                @input="setSubAgent('max_concurrent', Number(($event.target as HTMLInputElement).value))" />
              <span class="range-value">{{ subagent.max_concurrent }}</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">自动批准工具调用</div>
              <div class="setting-desc">子代理调用工具时无需逐一确认。</div>
            </div>
            <button class="toggle-btn" :class="{ on: subagent.auto_approve }" @click="setSubAgent('auto_approve', !subagent.auto_approve)">
              {{ subagent.auto_approve ? '开启' : '关闭' }}
            </button>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">子代理模型</div>
              <div class="setting-desc">inherit 表示沿用主对话模型。</div>
            </div>
            <select class="select" :value="subagent.model" @change="setSubAgent('model', ($event.target as HTMLSelectElement).value)">
              <option value="inherit">继承主模型</option>
              <option value="fast">快速模型</option>
              <option value="strong">强力模型</option>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">超时时间</div>
              <div class="setting-desc">单个子代理的最长运行时间。</div>
            </div>
            <div class="setting-control">
              <input type="range" min="30" max="600" step="30"
                :value="subagent.timeout_seconds"
                @input="setSubAgent('timeout_seconds', Number(($event.target as HTMLInputElement).value))" />
              <span class="range-value">{{ subagent.timeout_seconds }}s</span>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">在对话中显示进度</div>
              <div class="setting-desc">实时展示子代理的执行状态。</div>
            </div>
            <button class="toggle-btn" :class="{ on: subagent.show_progress }" @click="setSubAgent('show_progress', !subagent.show_progress)">
              {{ subagent.show_progress ? '开启' : '关闭' }}
            </button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import type { TtsConfig, BrowserToolsConfig, SubAgentConfig } from '@/api'
import { createLogger } from '@/utils/logger'
import { useViewEntrance } from '@/composables/useViewEntrance'

const log = createLogger('SettingsView')

const loading = ref(true)
const loadError = ref('')
const settings = ref<Record<string, unknown>>({})

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.section', ready: () => !loading.value })

// ── Panel configs（独立于 OMP Settings，存储在后端 panel_configs.json） ──

const tts = ref<TtsConfig>({
  enabled: false, provider: 'edge-tts', voice: '', speed: 1.0, pitch: 1.0, auto_read: false,
})
const browser = ref<BrowserToolsConfig>({
  enabled: false, chrome_path: '', headless: true,
  viewport_width: 1280, viewport_height: 800, block_tracking: true, allowed_domains: [],
})
const subagent = ref<SubAgentConfig>({
  enabled: false, max_concurrent: 3, auto_approve: false,
  model: 'inherit', timeout_seconds: 120, show_progress: true,
})

// 各引擎的常用音色（动态加载占位 — 真实部署可替换为后端枚举）
const VOICES_BY_PROVIDER: Record<TtsConfig['provider'], string[]> = {
  'edge-tts': ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'en-US-AriaNeural', 'en-US-GuyNeural'],
  'openai-tts': ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  'custom': [],
}
const voiceOptions = computed(() => VOICES_BY_PROVIDER[tts.value.provider] ?? [])

const CORE_PATHS = [
  'compaction.enabled', 'compaction.strategy', 'compaction.thresholdPercent',
  'compaction.midTurnEnabled', 'compaction.idleEnabled',
  'retry.enabled', 'retry.maxRetries', 'retry.modelFallback',
  'tools.approvalMode', 'tools.discoveryMode',
  'advisor.enabled',
  'steeringMode', 'followUpMode', 'interruptMode',
  'thinkingBudgets.minimal', 'thinkingBudgets.low', 'thinkingBudgets.medium',
  'thinkingBudgets.high', 'thinkingBudgets.xhigh', 'thinkingBudgets.max',
  'skills.enabled',
]

function thinkingLevelLabel(level: string): string {
  const labels: Record<string, string> = {
    minimal: '最小', low: '低', medium: '中',
    high: '高', xhigh: '极高', max: '最大',
  }
  return `${labels[level] ?? level}（${level}）`
}

async function loadSettings() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await api.getSettings(CORE_PATHS)
    settings.value = data
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadPanelConfigs() {
  // 各面板独立加载，单个失败不影响其他面板
  try { tts.value = { ...tts.value, ...(await api.getTtsConfig()) } }
  catch (e) { log.warn('Failed to load TTS config:', e) }
  try { browser.value = { ...browser.value, ...(await api.getBrowserToolsConfig()) } }
  catch (e) { log.warn('Failed to load browser tools config:', e) }
  try { subagent.value = { ...subagent.value, ...(await api.getSubAgentConfig()) } }
  catch (e) { log.warn('Failed to load sub-agent config:', e) }
}

// ── 去重：避免同一个 setting path 短时间内重复请求后端 ──
const _inflightSettings = new Map<string, Promise<unknown>>()

async function set(path: string, value: unknown) {
  // 同一个 path 的请求尚未完成时，合并请求（以最后一次 value 为准）
  const existing = _inflightSettings.get(path)
  const prev = settings.value[path]
  settings.value[path] = value

  let promise: Promise<unknown> | undefined
  try {
    if (existing) {
      // 现有请求完成后，再发本次请求（用最新 value）
      await existing.catch(() => {})
    }
    promise = api.setSetting(path, value)
    _inflightSettings.set(path, promise)
    await promise
  } catch (e) {
    log.error(`Failed to set ${path}:`, e)
    settings.value[path] = prev
  } finally {
    // 清除本 path 的在途标记，确保下一次同类请求能正常发起
    if (promise && _inflightSettings.get(path) === promise) {
      _inflightSettings.delete(path)
    }
  }
}

async function toggle(path: string) {
  await set(path, !settings.value[path])
}

// 通用的面板配置写入：乐观更新 + 失败回滚
async function setTts<K extends keyof TtsConfig>(key: K, value: TtsConfig[K]) {
  const prev = tts.value[key]
  tts.value[key] = value
  try {
    tts.value = { ...tts.value, ...(await api.updateTtsConfig({ [key]: value })) }
  } catch (e) {
    log.error(`Failed to set tts.${String(key)}:`, e)
    tts.value[key] = prev
  }
}

async function onTtsProviderChange(provider: TtsConfig['provider']) {
  // 切换引擎后旧音色通常无效，一并清空交由后端补默认值
  const prevProvider = tts.value.provider
  const prevVoice = tts.value.voice
  tts.value.provider = provider
  tts.value.voice = ''
  try {
    tts.value = { ...tts.value, ...(await api.updateTtsConfig({ provider, voice: '' })) }
  } catch (e) {
    log.error('Failed to change TTS provider:', e)
    tts.value.provider = prevProvider
    tts.value.voice = prevVoice
  }
}

async function setBrowser<K extends keyof BrowserToolsConfig>(key: K, value: BrowserToolsConfig[K]) {
  const prev = browser.value[key]
  browser.value[key] = value
  try {
    browser.value = { ...browser.value, ...(await api.updateBrowserToolsConfig({ [key]: value })) }
  } catch (e) {
    log.error(`Failed to set browser.${String(key)}:`, e)
    browser.value[key] = prev
  }
}

async function setSubAgent<K extends keyof SubAgentConfig>(key: K, value: SubAgentConfig[K]) {
  const prev = subagent.value[key]
  subagent.value[key] = value
  try {
    subagent.value = { ...subagent.value, ...(await api.updateSubAgentConfig({ [key]: value })) }
  } catch (e) {
    log.error(`Failed to set subagent.${String(key)}:`, e)
    subagent.value[key] = prev
  }
}

async function detectChrome() {
  try {
    const res = await api.selectFile('file')
    if (res.path) {
      await setBrowser('chrome_path', res.path)
    }
  } catch (e) {
    log.warn('Chrome detect failed:', e)
  }
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadPanelConfigs()])
})
</script>

<style scoped>
.settings-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

.header {
  margin-bottom: 24px;
}

.header h2 {
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
  margin: 0;
}

.section {
  margin-bottom: 28px;
}

.section h3 {
  font-size: 1em;
  font-weight: 600;
  margin: 0 0 4px;
}

.section-desc {
  font-size: 0.82em;
  color: var(--text-tertiary);
  margin: 0 0 12px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  font-size: 0.9em;
  font-weight: 500;
}

.setting-desc {
  font-size: 0.75em;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.8em;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.toggle-btn.on {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  cursor: pointer;
}

.input-number {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  text-align: right;
}

.input-text {
  width: 180px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
}

.textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.8em;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.setting-row-block {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.range-value {
  font-size: 0.8em;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

input[type="range"] {
  width: 120px;
}

.loading, .empty {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
}

.btn {
  padding: 6px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.85em;
  margin-top: 8px;
}
</style>
