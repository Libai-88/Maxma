<template>
  <div class="settings-view">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

const loading = ref(true)
const loadError = ref('')
const settings = ref<Record<string, unknown>>({})

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

async function set(path: string, value: unknown) {
  const prev = settings.value[path]
  settings.value[path] = value
  try {
    await api.setSetting(path, value)
  } catch (e) {
    console.error(`Failed to set ${path}:`, e)
    settings.value[path] = prev // rollback without network roundtrip
  }
}

async function toggle(path: string) {
  await set(path, !settings.value[path])
}

onMounted(loadSettings)
</script>

<style scoped>
.settings-view {
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
