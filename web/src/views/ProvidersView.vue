<template>
  <div class="providers-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>提供商管理 PROVIDERS</h2>
      <button v-if="mode === 'list'" class="btn primary" @click="startAdd">+ 添加提供商</button>
      <button v-else class="btn" @click="cancelForm">← 返回列表</button>
    </div>

    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div v-if="loading" class="loading">
        <div class="skeleton-grid">
          <div v-for="n in 6" :key="n" class="skeleton-card">
            <div class="skeleton-header">
              <div class="skeleton-line skeleton-line--title"></div>
              <div class="skeleton-line skeleton-line--badge"></div>
            </div>
            <div class="skeleton-line skeleton-line--url"></div>
            <div class="skeleton-models">
              <div class="skeleton-line skeleton-line--tag"></div>
              <div class="skeleton-line skeleton-line--tag"></div>
              <div class="skeleton-line skeleton-line--tag"></div>
            </div>
            <div class="skeleton-line skeleton-line--action"></div>
          </div>
        </div>
      </div>
      <div v-else-if="loadError" class="empty">
        <p>加载失败: {{ loadError }}</p>
        <div class="retry-row" style="margin-top: 8px;">
          <button class="btn primary" @click="retryLoad">重试</button>
        </div>
      </div>
      <div v-else-if="providers.length === 0" class="empty enhanced-empty">
        <!-- Hero -->
        <div class="empty-hero">
          <svg class="empty-hero-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="10" width="36" height="28" rx="4" />
            <path d="M6 18h36" />
            <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none" />
            <path d="M16 28l4 4 8-8" />
          </svg>
          <div class="empty-hero-text">
            <h3>添加你的第一个 AI 模型</h3>
            <p>「模型提供商」是 Maxma 调用 AI 大模型（如 DeepSeek、OpenAI、通义千问）的入口。配置一个 API Key 即可开始对话——所有数据只保存在本地。</p>
          </div>
        </div>

        <!-- 推荐提供商卡片：直接点击可一键预填 -->
        <div class="recommend-grid">
          <button
            v-for="r in recommendedPresets"
            :key="r.id"
            class="recommend-card"
            :class="`recommend--${r.tone}`"
            @click="startAddRecommended(r.id)"
          >
            <div class="recommend-header">
              <span class="recommend-name">{{ r.label }}</span>
              <span class="recommend-badge" :class="`badge--${r.tone}`">{{ r.badge }}</span>
            </div>
            <div class="recommend-desc">{{ r.desc }}</div>
            <div class="recommend-cta">+ 使用此提供商</div>
          </button>
        </div>

        <!-- 角色引导 -->
        <div class="role-guidance">
          <div class="role-card">
            <span class="role-badge">新手</span>
            <span>选 DeepSeek 注册即送免费额度，无需信用卡</span>
          </div>
          <div class="role-card">
            <span class="role-badge">极客</span>
            <span>本地运行选 Ollama，无需联网、无需 API Key</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="empty-actions">
          <button class="btn primary" @click="startAdd">+ 添加提供商</button>
          <router-link to="/help" class="btn">什么是 LLM 提供商？</router-link>
        </div>
      </div>
      <div v-else class="card-grid">
        <div v-for="p in providers" :key="p.id" class="provider-card" :data-provider-id="p.id">
          <!-- 顶部信息区 -->
          <div class="card-header">
            <div class="card-title-row">
              <span class="card-label">{{ p.label }}</span>
              <span class="card-type-badge">{{ p.provider_type.toUpperCase() }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: p.enabled }"
              :title="p.enabled ? '已启用' : '已停用'"
              @click="toggleProvider(p.id, !p.enabled)"
            ></button>
          </div>

          <!-- API 信息 -->
          <div class="card-url">{{ p.base_url }}</div>

          <!-- 模型列表 -->
          <div class="card-models-section">
            <div class="card-models-title">模型（{{ p.models.length }}）</div>
            <div class="card-models-tags">
              <span v-for="m in p.models" :key="m" class="model-tag">{{ m }}</span>
              <span v-if="p.models.length === 0" class="model-tag empty">未配置</span>
            </div>
          </div>

          <!-- 上下文窗口 -->
          <div class="card-context-window" :title="`上下文窗口是模型一次对话能处理的最大文本长度（含你的输入与 AI 的回复）。token ≈ 0.6 个汉字。`">
            上下文窗口: {{ (p.context_window ?? 256000).toLocaleString() }} tokens<span class="context-approx">（约 {{ approxChars(p.context_window ?? 256000) }}）</span>
          </div>

          <div
            v-if="diagnosticsEnabled && diagnosticFor(p)"
            class="provider-diagnostic"
            :class="diagnosticFor(p)?.status"
          >
            <div class="diagnostic-copy">
              <span>{{ diagnosticMessage(diagnosticFor(p)!) }}</span>
              <span v-if="retryMessage(diagnosticFor(p)?.retry_at)" class="diagnostic-retry">
                {{ retryMessage(diagnosticFor(p)?.retry_at) }}
              </span>
            </div>
            <button
              class="diagnostic-recheck"
              type="button"
              :disabled="rechecking[p.id]"
              title="重新检测提供商连接"
              @click="recheckProvider(p.id)"
            >
              {{ rechecking[p.id] ? '检测中...' : '重新检测' }}
            </button>
          </div>

          <!-- 测试结果 -->
          <Transition name="fade">
            <div v-if="testResult?.[p.id]" class="test-result" :class="testResult[p.id].status">
              <span v-if="testResult[p.id].status === 'ok'">✓</span>
              <span v-else>✗</span>
              {{ testResult[p.id].latency_ms ?? '-' }}ms
            </div>
          </Transition>

          <!-- 操作按钮 -->
          <div class="card-actions">
            <button class="action-btn" :data-provider-id="p.id" :aria-label="`测试连接 ${p.label}`" @click="testProvider(p.id)">测试连接</button>
            <button class="action-btn" :data-provider-id="p.id" :aria-label="`编辑 ${p.label}`" @click="startEdit(p)">编辑</button>
            <button class="action-btn" :data-provider-id="p.id" :aria-label="`删除 ${p.label}`" @click="deleteProvider(p.id)">删除</button>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 表单模式（添加/编辑） ── -->
    <form v-else class="wizard-form" @submit.prevent="handleSave">
      <div class="form-group">
        <div class="form-group-title">基础设置</div>
        <div class="form-section">
          <label class="form-label">提供商 <span class="required-mark">*</span></label>
          <select v-model="form.provider_type" class="input" :disabled="isEditing">
            <option v-for="preset in presets" :key="preset.id" :value="preset.id">
              {{ preset.label }}{{ preset.recommended ? ' ★ 推荐' : '' }}
            </option>
          </select>
          <p v-if="recommendedHint" class="preset-hint">{{ recommendedHint }}</p>
        </div>

        <div class="form-section">
          <label class="form-label">显示名称 <span class="required-mark">*</span></label>
          <input v-model="form.label" class="input" :class="{ 'input-error': fieldErrors.label }" placeholder="例如: DeepSeek" />
        </div>

        <div class="form-section">
          <label class="form-label">API Key <span class="required-mark">*</span></label>
          <input v-model="form.api_key" class="input mono" type="password" autocomplete="current-password" :placeholder="isEditing ? '留空则不修改' : 'sk-...'" />
        </div>

        <div class="form-section">
          <label class="form-label">Base URL <span class="required-mark">*</span></label>
          <input v-model="form.base_url" class="input mono" :class="{ 'input-error': fieldErrors.base_url }" placeholder="https://api.deepseek.com" />
        </div>
      </div>

      <div class="form-group">
        <div class="form-group-title">模型参数</div>
	      <div class="form-section">
	        <label class="form-label">上下文窗口 (tokens)<span class="form-label-hint"> · 模型一次对话能处理的最大文本长度</span></label>
	        <input v-model.number="form.context_window" class="input mono" type="number" placeholder="256000" />
	      </div>
	      <div class="form-row form-row--3cols">
	        <div class="form-section">
	          <label class="form-label">Max Tokens</label>
	          <input v-model.number="form.max_tokens" class="input mono" type="number" placeholder="4096" />
	        </div>
	        <div class="form-section">
	          <label class="form-label">Temperature</label>
	          <input v-model.number="form.temperature" class="input mono" type="number" step="0.1" min="0" max="2" placeholder="0.7" />
	        </div>
	        <div class="form-section">
	          <label class="form-label">Top P</label>
	          <input v-model.number="form.top_p" class="input mono" type="number" step="0.05" min="0" max="1" placeholder="1.0" />
	        </div>
		      </div>
          <div class="form-group">
            <div class="form-group-title">高级设置</div>
		        <div class="form-section">
		          <label class="form-label">超时 (秒)</label>
		          <input v-model.number="form.timeout" class="input mono" type="number" min="1" placeholder="60" />
		        </div>
		        <div class="form-section">
		          <label class="form-label">自定义 Headers (JSON)</label>
		          <input v-model="form.extra_headers_raw" class="input mono" placeholder='{"X-Custom-Header": "value"}' />
		        </div>
          </div>

		      <!-- 测试 & 拉取模型 -->
      <div class="form-row">
        <button type="button" class="btn" :disabled="!isEditing && (!form.api_key || !form.base_url)" @click="handleTest">
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button type="button" class="btn" :disabled="!isEditing && (!form.api_key || !form.base_url)" @click="handleDiscover">
          {{ discovering ? '拉取中...' : '拉取模型列表' }}
        </button>
      </div>
      <div v-if="formError" class="msg error">{{ formError }}</div>
      <div v-if="testOk" class="msg ok">连接成功 ({{ testLatency }}ms)</div>

      <!-- 模型列表 -->
      <div v-if="discoveredModels.length > 0" class="form-section">
        <label class="form-label">选择模型（{{ selectedModels.length }}/{{ discoveredModels.length }}）</label>
        <div class="model-list">
          <label v-for="m in discoveredModels" :key="m" class="model-item">
            <input type="checkbox" :value="m" :checked="selectedModels.includes(m)" @change="toggleModel(m)" />
            {{ m }}
          </label>
        </div>
        <button type="button" class="btn sm" @click="selectAllModels">全选</button>
        <button type="button" class="btn sm" @click="selectedModels = []">取消全选</button>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn primary" :disabled="saving">
          {{ saving ? '保存中...' : (isEditing ? '更新' : '保存') }}
        </button>
        <button type="button" class="btn" @click="cancelForm">取消</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { ComponentHealth, ProviderConfig, ProviderPreset, TestConnectionResponse } from '@/types'
import { useProviderStore } from '@/stores/provider'
import { useHealthStore } from '@/stores/health'
import { diagnosticMessage, retryMessage } from '@/utils/providerDiagnostics'
import { toErrorMessage } from '@/utils/error'
import { computed, onMounted, reactive, ref } from 'vue'

// ── 预设提供商列表 ──
	const presets: ProviderPreset[] = [
	  { id: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1', recommended: true },
	  { id: 'anthropic', label: 'Anthropic', base_url: 'https://api.anthropic.com/v1' },
	  { id: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com', recommended: true },
	  { id: 'google', label: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com' },
	  { id: 'ollama', label: 'Ollama', base_url: 'http://127.0.0.1:11434/v1', recommended: true },
	  { id: 'qwen', label: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', recommended: true },
	  { id: 'kimi', label: 'Kimi / Moonshot', base_url: 'https://api.moonshot.cn/v1' },
	  { id: 'minimax', label: 'MiniMax', base_url: 'https://api.minimax.chat/v1' },
	  { id: 'zhipu-coding-plan', label: '智谱 Coding Plan', base_url: 'https://open.bigmodel.cn/api/coding/paas/v4' },
	  { id: 'qianfan', label: '百度千帆', base_url: 'https://qianfan.baidubce.com/v2' },
	  { id: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
	  { id: 'mistral', label: 'Mistral AI', base_url: 'https://api.mistral.ai/v1' },
	  { id: 'together', label: 'Together AI', base_url: 'https://api.together.xyz/v1' },
	  { id: 'fireworks', label: 'Fireworks', base_url: 'https://api.fireworks.ai/inference/v1' },
	  { id: 'xai', label: 'xAI Grok', base_url: 'https://api.x.ai/v1' },
	  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
	  { id: 'mimo', label: 'Mimo', base_url: 'https://api.xiaomimimo.com/v1' },
	  { id: 'novita', label: 'Novita', base_url: 'https://api.novita.ai/openai/v1' },
	  { id: 'huggingface', label: 'Hugging Face', base_url: 'https://router.huggingface.co/v1' },
	  { id: 'cerebras', label: 'Cerebras', base_url: 'https://api.cerebras.ai/v1' },
	  { id: 'nvidia', label: 'NVIDIA', base_url: 'https://integrate.api.nvidia.com/v1' },
	  { id: 'vllm', label: 'vLLM', base_url: '' },
	  { id: 'litellm', label: 'LiteLLM', base_url: '' },
	  { id: 'lm-studio', label: 'LM Studio', base_url: '' },
	  { id: 'cloudflare-ai-gateway', label: 'Cloudflare AI Gateway', base_url: '' },
	  { id: 'custom', label: '自定义', base_url: '' },
	]

// ── 空状态推荐卡片：4 个面向不同画像的推荐入口 ──
// tone 用于色调区分；badge 是右上角徽标
interface RecommendedPreset {
  id: string
  label: string
  badge: string
  desc: string
  tone: 'popular' | 'cheap' | 'local' | 'cn'
}
const recommendedPresets: RecommendedPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', badge: '性价比', desc: '国内可直连，注册即送免费额度，中文表现优秀', tone: 'cheap' },
  { id: 'qwen', label: '通义千问 Qwen', badge: '国内', desc: '阿里云出品，国内访问稳定，免费额度充足', tone: 'cn' },
  { id: 'openai', label: 'OpenAI', badge: '热门', desc: 'GPT 系列模型，生态最完善，体验最佳（需海外网络）', tone: 'popular' },
  { id: 'ollama', label: 'Ollama 本地', badge: '本地', desc: '完全离线运行，无需 API Key，隐私最佳（需先安装 Ollama）', tone: 'local' },
]

// 当选中推荐 preset 时，显示一句话说明（面向 Novice 画像，降低选择困难）
const recommendedHint = computed(() => {
  const preset = presets.find(p => p.id === form.value.provider_type)
  if (!preset?.recommended) return ''
  const r = recommendedPresets.find(r => r.id === preset.id)
  return r ? `推荐：${r.desc}` : '推荐之选'
})

// 一键预填推荐提供商到表单
function startAddRecommended(presetId: string) {
  startAdd()
  form.value.provider_type = presetId
  form.value.base_url = presetBaseUrl(presetId)
}

// ── 模式 ──
const mode = ref<'list' | 'add' | 'edit'>('list')
// providers 直接来自 store computed，消除本地 ref 与 store 状态不一致
const providerStore = useProviderStore()
const providers = computed(() => providerStore.allProviders)
const loading = computed(() => providerStore.loading)
const healthStore = useHealthStore()
const diagnosticsEnabled = computed(() => healthStore.health?.provider_diagnostics_enabled === true)
const rechecking = ref<Record<string, boolean>>({})
const loadError = ref('')

async function retryLoad() {
  loadError.value = ''
  try {
    await providerStore.refresh()
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e)
  }
}

function diagnosticFor(provider: ProviderConfig): ComponentHealth | null {
  const ltm = healthStore.health?.ltm
  if (ltm?.provider_id === provider.id && ltm.status !== 'ok') return ltm
  if (provider.health_status !== 'degraded' && provider.health_status !== 'error') return null
  return {
    status: provider.health_status,
    latency_ms: provider.health_latency_ms ?? null,
    detail: provider.health_detail ?? null,
    reason_code: provider.health_reason_code,
    retry_at: provider.health_retry_at,
    updated_at: provider.health_updated_at,
    summary: provider.health_summary,
  }
}

// ── 表单 ──
const form = ref({ id: '', provider_type: 'deepseek', label: '', api_key: '', base_url: '', context_window: 256000, max_tokens: undefined as number | undefined, temperature: undefined as number | undefined, top_p: undefined as number | undefined, timeout: undefined as number | undefined, extra_headers_raw: '' })
const isEditing = computed(() => mode.value === 'edit')
const editingId = ref('')

function presetBaseUrl(id: string) {
  return presets.find(p => p.id === id)?.base_url || ''
}

/** Novice 友好的 token → 汉字估算（与 ContextUsageBadge / ModelSelector 保持一致：1 token ≈ 0.6 个汉字） */
function approxChars(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '未知'
  const approx = Math.round(tokens * 0.6)
  if (approx >= 10000) return `${Math.round(approx / 10000)} 万字`
  return `${approx} 字`
}

// 切换 preset 时自动填充 base_url
function onPresetChange(newType: string) {
  if (!isEditing.value) {
    form.value.base_url = presetBaseUrl(newType)
  }
}
// watch provider_type
import { watch } from 'vue'
watch(() => form.value.provider_type, onPresetChange)

// ── 测试连接 ──
const testing = ref(false)
const testOk = ref(false)
const testLatency = ref(0)
const formError = ref('')
const fieldErrors = reactive<Record<string, boolean>>({})

async function handleTest() {
  testing.value = true
  formError.value = ''
  testOk.value = false
  try {
    const res = await api.testConnection({
      api_key: form.value.api_key,
      base_url: form.value.base_url,
    })
    if (res.status === 'ok') {
      testOk.value = true
      testLatency.value = res.latency_ms || 0
    } else {
      formError.value = res.detail || '连接失败'
    }
  } catch (e: unknown) {
    formError.value = toErrorMessage(e)
  } finally {
    testing.value = false
  }
}

// ── 拉取模型 ──
const discovering = ref(false)
const discoveredModels = ref<string[]>([])
const selectedModels = ref<string[]>([])

async function handleDiscover() {
  discovering.value = true
  formError.value = ''
  try {
    let models: string[] = []
    if (isEditing.value && !form.value.api_key) {
      const res = await api.discoverModelsForExisting(editingId.value)
      models = res.models
    } else {
      const res = await api.discoverModels({
        api_key: form.value.api_key,
        base_url: form.value.base_url,
      })
      models = res.models
    }
    // 合并策略：保留用户之前手动取消选择的模型状态
    // 新发现的模型默认选中，已有列表中用户取消选择的模型保持取消状态
    const previousSelection = new Set(selectedModels.value)
    const previousDiscovered = new Set(discoveredModels.value)
    discoveredModels.value = models
    // 之前已发现且用户取消选择的模型，保持取消状态
    // 之前未发现的新模型，默认选中
    // 之前已发现且用户选中的模型，保持选中
    selectedModels.value = models.filter(m => previousDiscovered.has(m) ? previousSelection.has(m) : true)
  } catch (e: unknown) {
    formError.value = toErrorMessage(e)
  } finally {
    discovering.value = false
  }
}

function toggleModel(m: string) {
  const idx = selectedModels.value.indexOf(m)
  if (idx >= 0) selectedModels.value.splice(idx, 1)
  else selectedModels.value.push(m)
}

function selectAllModels() {
  selectedModels.value = [...discoveredModels.value]
}

// ── CRUD ──
const saving = ref(false)
const testResult = ref<Record<string, TestConnectionResponse>>({})

// 加载 provider 列表（首次挂载时调用）
// 后续 CRUD 操作通过 refreshStore 强制刷新 store，无需再调用 loadProviders
async function loadProviders() {
  await providerStore.loadProviders()
}

function startAdd() {
  mode.value = 'add'
	  form.value = { id: '', provider_type: 'deepseek', label: '', api_key: '', base_url: presetBaseUrl('deepseek'), context_window: 256000, max_tokens: undefined, temperature: undefined, top_p: undefined, timeout: undefined, extra_headers_raw: '' }
  discoveredModels.value = []
  selectedModels.value = []
  formError.value = ''
  testOk.value = false
}

function startEdit(p: ProviderConfig) {
  mode.value = 'edit'
  editingId.value = p.id
  form.value = {
    id: p.id,
    provider_type: p.provider_type,
    label: p.label,
    api_key: '',
    base_url: p.base_url,
    context_window: p.context_window ?? 256000,
    max_tokens: p.max_tokens,
    temperature: p.temperature,
    top_p: p.top_p,
    timeout: p.timeout,
    extra_headers_raw: p.extra_headers ? JSON.stringify(p.extra_headers, null, 2) : '',
  }
  discoveredModels.value = [...p.models]
  selectedModels.value = [...p.models]
  formError.value = ''
  testOk.value = false
}

function cancelForm() {
  // 取消表单不做任何修改，无需重新加载 provider 列表
  mode.value = 'list'
}

async function handleSave() {
  saving.value = true
  formError.value = ''
  Object.keys(fieldErrors).forEach(k => fieldErrors[k] = false)
  try {
    if (!form.value.label.trim()) {
      fieldErrors.label = true
      formError.value = '显示名称不能为空'
      saving.value = false
      return
    }
    if (!form.value.base_url.trim()) {
      fieldErrors.base_url = true
      formError.value = 'Base URL 不能为空'
      saving.value = false
      return
    }
    let extraHeaders: Record<string, string> | undefined
    if (form.value.extra_headers_raw?.trim()) {
      try { extraHeaders = JSON.parse(form.value.extra_headers_raw) } catch { formError.value = '自定义 Headers 格式无效，请输入合法 JSON'; saving.value = false; return }
      // 防御性黑名单：阻止注入可能危害系统安全的 header 名称
      const DANGEROUS_HEADERS = [
        'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
        'x-maxma-token', 'host', 'content-length', 'transfer-encoding',
        'connection', 'upgrade', 'proxy-connection',
      ]
      const blocked = Object.keys(extraHeaders).find(
        (k) => DANGEROUS_HEADERS.includes(k.toLowerCase())
      )
      if (blocked) {
        formError.value = `Header 名称 "${blocked}" 受保护，不允许设置`
        saving.value = false
        return
      }
    }
    const body: Partial<ProviderConfig> = {
      id: form.value.id || form.value.label.toLowerCase().replace(/\s+/g, '-'),
      provider_type: form.value.provider_type,
      label: form.value.label,
      api_key: form.value.api_key,
      base_url: form.value.base_url,
      models: selectedModels.value,
      enabled: true,
      context_window: form.value.context_window,
      max_tokens: form.value.max_tokens,
      temperature: form.value.temperature,
      top_p: form.value.top_p,
      timeout: form.value.timeout,
      extra_headers: extraHeaders,
    }
    if (isEditing.value) {
      // PUT — only send changed fields
      const updateBody: Partial<ProviderConfig> = {
        label: body.label,
        base_url: body.base_url,
        models: body.models,
        context_window: body.context_window,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        top_p: body.top_p,
        timeout: body.timeout,
        extra_headers: body.extra_headers,
      }
      if (form.value.api_key) updateBody.api_key = form.value.api_key
      await api.updateProvider(editingId.value, updateBody)
    } else {
      await api.createProvider(body)
    }
    mode.value = 'list'
    // 用 refresh() 强制刷新 store，让 ChatInput 等消费方立即感知变化
    await providerStore.refresh()
  } catch (e: unknown) {
    formError.value = toErrorMessage(e)
  } finally {
    saving.value = false
  }
}

async function deleteProvider(id: string) {
  if (!confirm(`确定删除提供商「${id}」？`)) return
  try {
    await api.deleteProvider(id)
    // 用 refresh() 强制刷新 store，让 ChatInput 等消费方感知删除
    await providerStore.refresh()
  } catch (e: unknown) {
    alert('删除失败: ' + toErrorMessage(e))
  }
}

async function testProvider(id: string) {
  try {
    const res = await api.testExistingProvider(id)
    testResult.value[id] = res
  } catch (e: unknown) {
    testResult.value[id] = { status: 'error', latency_ms: null, detail: toErrorMessage(e) }
  }
}

async function recheckProvider(id: string) {
  rechecking.value[id] = true
  try {
    await api.checkProviderHealth(id)
    await Promise.all([providerStore.refresh(), healthStore.refresh()])
  } catch (e: unknown) {
    formError.value = toErrorMessage(e)
  } finally {
    rechecking.value[id] = false
  }
}

async function toggleProvider(id: string, enabled: boolean) {
  try {
    await api.updateProvider(id, { enabled })
    // 同步刷新全局 store，让 ChatInput 等消费方感知到 enabled 变化
    // providers 是 computed，会自动更新，无需手动修改
    await providerStore.refresh()
  } catch (e: unknown) {
    alert('切换失败: ' + toErrorMessage(e))
  }
}

onMounted(loadProviders)
</script>

<style scoped>
.providers-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.header h2 {
  font-size: 20px;
  font-weight: 700;
}

/* ── Buttons ── */
.btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}
.btn:hover { opacity: 0.8; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.primary {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
.btn.sm { padding: 4px 10px; font-size: 12px; }
.btn.danger { color: var(--status-error); border-color: var(--status-error); }

/* ── List ── */
.loading, .empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 40px 0;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 1100px) {
  .card-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 700px) {
  .card-grid { grid-template-columns: 1fr; }
}

.provider-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-16);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 顶部信息区 ── */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-label {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.card-type-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.5px;
}

/* ── 开关按钮 ── */
.toggle-btn {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  background: var(--border);
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: background 0.2s;
}
.toggle-btn::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bg-primary);
  transition: transform 0.2s;
  box-shadow: var(--shadow-xs);
}
.toggle-btn.active {
  background: var(--accent);
}
.toggle-btn.active::after {
  transform: translateX(16px);
}

/* ── API URL ── */
.card-url {
  font-size: 12px;
  color: var(--text-tertiary);
  word-break: break-all;
  line-height: 1.4;
}

/* ── 模型列表区 ── */
.card-models-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-models-title {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 500;
}
.card-models-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.model-tag {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--bg-secondary);
  border-radius: 6px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Consolas', monospace;
}
.model-tag.empty {
  color: var(--text-tertiary);
  font-family: inherit;
}

.card-context-window {
  font-size: 12px;
  color: var(--text-tertiary);
}
/* 上下文窗口的汉字估算后缀（面向 Novice：让 tokens 数字具备直观体感） */
.context-approx {
  color: var(--text-tertiary);
  font-size: 11px;
  margin-left: 2px;
}
/* 表单 label 后的解释性提示（面向 Novice：避免术语困惑） */
.form-label-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary);
  margin-left: 4px;
}

.provider-diagnostic {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-left: 3px solid var(--status-warn);
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
  color: var(--status-warn);
  font-size: 12px;
  line-height: 1.4;
}
.provider-diagnostic.error {
  border-left-color: var(--status-error);
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
  color: var(--status-error);
}
.diagnostic-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.diagnostic-retry { color: var(--text-secondary); }
.diagnostic-recheck {
  flex: 0 0 auto;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.diagnostic-recheck:disabled { opacity: 0.55; cursor: wait; }

/* ── 测试结果 ── */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.test-result {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
}
.test-result.ok { background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card)); color: var(--status-ok); }
.test-result.error { background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card)); color: var(--status-error); }

/* ── 操作按钮 ── */
.card-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}
.action-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.action-btn:hover {
  opacity: 0.7;
}

/* ── Form ── */
.wizard-form {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-card);
  outline: none;
  transition: border-color 0.15s;
}
.input:focus { border-color: var(--accent); }
.input.mono { font-family: 'SF Mono', 'Consolas', monospace; font-size: 13px; }
select.input { cursor: pointer; }

/* 推荐提示：选中推荐 preset 时显示一句话说明 */
.preset-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--accent);
  line-height: 1.5;
}

.form-row {
  display: flex;
  gap: 8px;
}

.msg {
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 6px;
}
.msg.ok { background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card)); color: var(--status-ok); }
.msg.error { background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card)); color: var(--status-error); }

.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
}
.model-item {
  font-size: 13px;
  font-family: 'SF Mono', 'Consolas', monospace;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.model-item:hover { background: var(--bg-secondary); }
.model-item input { margin-right: 8px; }

.form-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
}
.form-group {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
}
.form-group-title {
  font-size: 0.78em;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.required-mark {
  color: var(--status-error);
  margin-left: 2px;
}
.input-error {
  border-color: var(--status-error) !important;
}

/* ── Skeleton loading ── */
.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
@media (max-width: 1100px) {
  .skeleton-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 700px) {
  .skeleton-grid { grid-template-columns: 1fr; }
}
.skeleton-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.skeleton-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.skeleton-models {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.skeleton-line {
  height: 14px;
  border-radius: 7px;
  background: var(--bg-secondary);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.skeleton-line--title { width: 60%; }
.skeleton-line--badge { width: 48px; height: 12px; border-radius: 6px; }
.skeleton-line--url { width: 85%; height: 12px; }
.skeleton-line--tag { width: 56px; height: 22px; border-radius: 6px; }
.skeleton-line--action { width: 40%; height: 12px; }
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}

/* ── 空状态增强（面向 Novice / Power Office 画像） ── */
.enhanced-empty {
  text-align: left;
  padding: 32px 28px;
  max-width: 760px;
  margin: 0 auto;
}

.empty-hero {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 28px;
}
.empty-hero-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  color: var(--accent);
}
.empty-hero-text h3 {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
}
.empty-hero-text p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ── 推荐提供商卡片 ── */
.recommend-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
@media (max-width: 700px) {
  .recommend-grid { grid-template-columns: 1fr; }
}
.recommend-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.recommend-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.recommend-card:hover .recommend-cta {
  color: var(--accent);
}
.recommend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.recommend-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.recommend-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  letter-spacing: 0.3px;
  white-space: nowrap;
}
.recommend-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  flex: 1;
}
.recommend-cta {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-top: 4px;
  transition: color 0.15s;
}

/* tone 变体：颜色区分不同推荐类型 */
.recommend--popular { border-top: 3px solid var(--accent); }
.recommend--cheap { border-top: 3px solid var(--status-ok); }
.recommend--local { border-top: 3px solid var(--status-warn); }
.recommend--cn { border-top: 3px solid #6366f1; }

.badge--popular { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
.badge--cheap { background: color-mix(in srgb, var(--status-ok) 18%, transparent); color: var(--status-ok); }
.badge--local { background: color-mix(in srgb, var(--status-warn) 18%, transparent); color: var(--status-warn); }
.badge--cn { background: color-mix(in srgb, #6366f1 18%, transparent); color: #6366f1; }

/* ── 角色引导 ── */
.role-guidance {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
  padding: 12px 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
}
.role-card {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.role-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary);
  letter-spacing: 0.3px;
}

/* ── 操作按钮 ── */
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.empty-actions .btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
</style>
