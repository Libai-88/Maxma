<template>
  <div class="error-card" :class="[`error-card--${category}`]">
    <div class="error-card__header">
      <span class="error-card__icon">{{ icon }}</span>
      <span class="error-card__title">{{ title }}</span>
      <span v-if="traceId" class="error-card__trace">ID: {{ traceId }}</span>
    </div>
    <div class="error-card__message">{{ message }}</div>
    <div v-if="suggestion" class="error-card__suggestion">
      <span class="suggestion-label">建议：</span>{{ suggestion }}
    </div>
    <div class="error-card__actions">
      <button v-if="retryable" class="error-card__btn" @click="$emit('retry')">重试</button>
      <button v-if="diagnosticText" class="error-card__btn" @click="copyDiagnostic">
        {{ copied ? '已复制' : '复制诊断' }}
      </button>
      <button v-if="dismissible" class="error-card__btn" @click="$emit('dismiss')">关闭</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  message: string
  category?: string
  traceId?: string
  retryable?: boolean
  diagnosticText?: string
  dismissible?: boolean
}>(), {
  dismissible: true,
})

defineEmits<{ retry: []; dismiss: [] }>()

const icon = computed(() => {
  switch (props.category) {
    case 'network': return '🌐'
    case 'auth': return '🔑'
    case 'timeout': return '⏱️'
    case 'permission': return '🚫'
    case 'not_found': return '🔍'
    case 'rate_limit': return '⏳'
    case 'warning': return '⚠️'
    default: return '⚠️'
  }
})

const title = computed(() => {
  switch (props.category) {
    case 'network': return '网络错误'
    case 'auth': return '认证失败'
    case 'timeout': return '请求超时'
    case 'permission': return '权限不足'
    case 'not_found': return '未找到'
    case 'rate_limit': return '请求过于频繁'
    case 'warning': return '操作需要处理'
    default: return '发生错误'
  }
})

const suggestion = computed(() => {
  switch (props.category) {
    case 'network': return '请检查网络连接后重试'
    case 'auth': return '请检查 API 密钥是否正确配置'
    case 'timeout': return '请稍后重试，或尝试简化请求'
    case 'permission': return '请确认路径是否在白名单中'
    case 'not_found': return '请确认目标路径或资源是否存在'
    case 'rate_limit': return '请稍候片刻再重试'
    case 'warning': return '可稍后重试，或复制诊断信息继续排查'
    default: return '如果问题持续，请尝试重启服务'
  }
})

const copied = ref(false)

async function copyDiagnostic() {
  if (!props.diagnosticText) return
  try {
    await navigator.clipboard.writeText(props.diagnosticText)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = props.diagnosticText
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2_000)
}
</script>

<style scoped>
.error-card {
  border: 1px solid var(--border);
  border-radius: var(--radius, 10px);
  background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card));
  padding: 12px 16px;
  margin: 8px 0;
}
.error-card--network { border-color: color-mix(in srgb, var(--status-info) 30%, transparent); background: color-mix(in srgb, var(--status-info) 10%, var(--bg-card)); }
.error-card--timeout { border-color: color-mix(in srgb, var(--status-warn) 30%, transparent); background: color-mix(in srgb, var(--status-warn) 10%, var(--bg-card)); }
.error-card--auth { border-color: color-mix(in srgb, var(--status-error) 30%, transparent); background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card)); }
.error-card--rate_limit { border-color: color-mix(in srgb, #a855f7 30%, transparent); background: color-mix(in srgb, #a855f7 10%, var(--bg-card)); }
.error-card--warning { border-color: color-mix(in srgb, var(--status-warn) 36%, transparent); background: color-mix(in srgb, var(--status-warn) 10%, var(--bg-card)); }

.error-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.error-card__icon { font-size: 16px; }
.error-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.error-card__trace {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
  margin-left: auto;
}
.error-card__message {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}
.error-card__suggestion {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
  margin-bottom: 8px;
}
.suggestion-label {
  font-weight: 500;
  color: var(--text-primary);
}
.error-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.error-card__btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.error-card__btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
</style>
