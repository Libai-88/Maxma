# Phase 3: 前端 OMP 核心体验 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 Maxma Vue 3 前端中集成 Provider 选择器、上下文监控、模型设置三个核心 OMP 能力。

**Architecture:** 前端通过 Pinia store 管理状态，通过 WebSocket 与 Python 薄层通信，Python 透传至 OMP sidecar。

**Tech Stack:** Vue 3 + Vite 5 + Pinia + TypeScript, OMP v16.5.2

---

## 文件结构

```
web/src/
  stores/
    chat.ts                    ← 修改：扩展 state/actions
  components/
    ModelSelector.vue           ← 新建：Provider 模型选择器
    ContextUsageBadge.vue       ← 修改：重构实时上下文监控
    ModelSettingsPanel.vue      ← 新建：模型参数设置面板
    ChatInput.vue               ← 修改：集成选择器和监控
    SessionSidebar.vue          ← 修改：集成模型设置面板
  types/
    chat.ts                    ← 新建：类型定义
```

---

### Task 1: 扩展 chat store

**Files:**
- Modify: `web/src/stores/chat.ts`
- Create: `web/src/types/chat.ts`

- [ ] **Step 1: 创建类型定义**

```bash
mkdir -p "D:/Maxma/MaxmaHere/web/src/types"
```

Create `D:\Maxma\MaxmaHere\web\src\types\chat.ts`:

```typescript
/** Provider 模型信息 */
export interface ModelInfo {
  id: string;         // "openai/gpt-4o"
  provider: string;   // "openai"
  name: string;       // "GPT-4o"
  contextWindow: number;
}

/** 上下文用量信息 */
export interface ContextUsage {
  estimatedTokens: number;
  maxTokens: number;
  percentage: number;
  messageCount: number;
  modelName: string;
}

/** WS context_usage 事件 payload */
export interface ContextUsageEvent {
  estimated_tokens: number;
  max_tokens: number;
  percentage: number;
  message_count: number;
  model_name: string;
}
```

- [ ] **Step 2: 扩展 chat store**

Read the current `D:\Maxma\MaxmaHere\web\src\stores\chat.ts` first, then rewrite it to add the new fields while keeping existing functionality.

The new store should have:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ModelInfo, ContextUsage } from '../types/chat'

export const useChatStore = defineStore('chat', () => {
  // ── Existing state (keep as-is) ──
  const messages = ref<any[]>([])
  const sessionId = ref('')
  const isStreaming = ref(false)
  // ... keep all existing state

  // ── New state ──
  const currentModel = ref('gpt-4o')
  const availableModels = ref<ModelInfo[]>([])
  const temperature = ref(0.7)
  const maxTokens = ref(4096)
  const thinkingEnabled = ref(false)
  const contextUsage = ref<ContextUsage>({
    estimatedTokens: 0,
    maxTokens: 128000,
    percentage: 0,
    messageCount: 0,
    modelName: '',
  })

  // ── New actions ──
  function setModel(modelId: string) {
    currentModel.value = modelId
  }

  function setTemperature(val: number) {
    temperature.value = Math.max(0, Math.min(2, val))
  }

  function setMaxTokens(val: number) {
    maxTokens.value = Math.max(256, Math.min(256000, val))
  }

  function toggleThinking(enabled: boolean) {
    thinkingEnabled.value = enabled
  }

  function updateContextUsage(usage: ContextUsage) {
    contextUsage.value = usage
  }

  async function fetchAvailableModels() {
    try {
      const res = await fetch('/api/providers')
      const data = await res.json()
      // Transform API response to ModelInfo[]
      const models: ModelInfo[] = []
      if (Array.isArray(data)) {
        for (const p of data) {
          if (Array.isArray(p.models)) {
            for (const m of p.models) {
              models.push({
                id: `${p.id}/${m}`,
                provider: p.id,
                name: m,
                contextWindow: p.context_window || 128000,
              })
            }
          }
        }
      }
      availableModels.value = models
    } catch {
      // Use defaults if API unavailable
    }
  }

  return {
    messages, sessionId, isStreaming,
    currentModel, availableModels, temperature, maxTokens, thinkingEnabled, contextUsage,
    setModel, setTemperature, setMaxTokens, toggleThinking, updateContextUsage, fetchAvailableModels,
  }
})
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -20
```
Fix any type errors.

- [ ] **Step 4: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/types/chat.ts web/src/stores/chat.ts && git commit -m "feat: extend chat store with model/context/temperature state"
```

---

### Task 2: Provider 选择器组件 (ModelSelector)

**Files:**
- Create: `web/src/components/ModelSelector.vue`

- [ ] **Step 1: Create ModelSelector.vue**

Create `D:\Maxma\MaxmaHere\web\src\components\ModelSelector.vue`:

```vue
<template>
  <div class="model-selector" @click.stop="toggleOpen">
    <button class="model-trigger">
      <span class="model-icon">🤖</span>
      <span class="model-name">{{ displayName }}</span>
      <span class="model-arrow" :class="{ open: isOpen }">▾</span>
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="model-dropdown" @click.stop>
        <div class="dropdown-header">
          选择模型
          <button class="close-btn" @click="isOpen = false">✕</button>
        </div>
        <div class="model-list">
          <div
            v-for="group in groupedModels"
            :key="group.provider"
            class="provider-group"
          >
            <div class="provider-label">{{ group.provider }}</div>
            <div
              v-for="model in group.models"
              :key="model.id"
              class="model-item"
              :class="{ active: model.id === store.currentModel }"
              @click="selectModel(model.id)"
            >
              <span class="model-item-name">{{ model.name }}</span>
              <span class="model-item-ctx">{{ formatCtx(model.contextWindow) }}</span>
            </div>
          </div>
          <div v-if="groupedModels.length === 0" class="empty-state">
            暂无可用模型
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const isOpen = ref(false)

const displayName = computed(() => {
  const found = store.availableModels.find(m => m.id === store.currentModel)
  return found?.name || store.currentModel
})

const groupedModels = computed(() => {
  const groups = new Map<string, typeof store.availableModels>()
  for (const m of store.availableModels) {
    if (!groups.has(m.provider)) groups.set(m.provider, [])
    groups.get(m.provider)!.push(m)
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({ provider, models }))
})

function toggleOpen() { isOpen.value = !isOpen.value }
function selectModel(id: string) {
  store.setModel(id)
  isOpen.value = false
}
function formatCtx(ctx: number): string {
  return ctx >= 1000 ? `${(ctx / 1000).toFixed(0)}k` : `${ctx}`
}

onMounted(() => {
  if (store.availableModels.length === 0) {
    store.fetchAvailableModels()
  }
})

// Close dropdown on outside click
if (typeof document !== 'undefined') {
  document.addEventListener('click', () => { isOpen.value = false })
}
</script>

<style scoped>
.model-selector { position: relative; display: inline-block; }
.model-trigger {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px; background: transparent;
  font-size: 12px; color: var(--text-secondary, #6b7280);
  cursor: pointer; white-space: nowrap;
}
.model-trigger:hover { background: var(--bg-secondary, #f9fafb); }
.model-icon { font-size: 14px; }
.model-arrow { font-size: 10px; transition: transform 0.2s; }
.model-arrow.open { transform: rotate(180deg); }

.model-dropdown {
  position: fixed; z-index: 1000;
  width: 320px; max-height: 400px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  overflow: hidden; display: flex; flex-direction: column;
}
.dropdown-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--text-secondary, #6b7280);
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.close-btn { background: none; border: none; cursor: pointer; color: var(--text-tertiary, #9ca3af); font-size: 14px; }
.model-list { overflow-y: auto; padding: 6px 0; }
.provider-group { }
.provider-label {
  padding: 6px 14px 2px; font-size: 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.8px;
  color: var(--text-tertiary, #9ca3af);
}
.model-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 14px; cursor: pointer; font-size: 13px;
  color: var(--text-primary, #1f2937);
}
.model-item:hover { background: var(--bg-secondary, #f9fafb); }
.model-item.active { background: #000; color: #fff; font-weight: 600; }
.model-item-ctx { font-size: 11px; color: var(--text-tertiary, #9ca3af); font-family: 'SF Mono', monospace; }
.model-item.active .model-item-ctx { color: rgba(255,255,255,0.6); }
.empty-state { padding: 24px; text-align: center; color: var(--text-tertiary, #9ca3af); font-size: 13px; }
</style>
```

- [ ] **Step 2: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -20
```
Fix any type errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/components/ModelSelector.vue && git commit -m "feat: add ModelSelector component for session-level model switching"
```

---

### Task 3: 重构 ContextUsageBadge

**Files:**
- Modify: `web/src/components/ContextUsageBadge.vue`

- [ ] **Step 1: Rewrite ContextUsageBadge.vue**

Read the current `D:\Maxma\MaxmaHere\web\src\components\ContextUsageBadge.vue` first, then rewrite:

```vue
<template>
  <div class="context-usage-badge" :class="statusClass" @mouseenter="showDetail = true" @mouseleave="showDetail = false">
    <span class="usage-icon">📊</span>
    <span class="usage-text">{{ displayText }}</span>
    <div class="usage-bar">
      <div class="usage-bar-fill" :style="{ width: barPercent + '%' }"></div>
    </div>
    <span class="usage-pct">{{ usage.percentage.toFixed(1) }}%</span>

    <div v-if="showDetail" class="usage-tooltip">
      <div class="tooltip-row"><span>模型</span><span>{{ usage.modelName || '-' }}</span></div>
      <div class="tooltip-row"><span>已用</span><span>{{ formatNum(usage.estimatedTokens) }} tokens</span></div>
      <div class="tooltip-row"><span>上限</span><span>{{ formatNum(usage.maxTokens) }} tokens</span></div>
      <div class="tooltip-row"><span>消息数</span><span>{{ usage.messageCount }}</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChatStore } from '../stores/chat'

const store = useChatStore()
const showDetail = ref(false)

const usage = computed(() => store.contextUsage)

const barPercent = computed(() => Math.min(usage.value.percentage, 100))

const displayText = computed(() => {
  return `${formatNum(usage.value.estimatedTokens)} / ${formatNum(usage.value.maxTokens)}`
})

const statusClass = computed(() => {
  if (usage.value.percentage > 90) return 'status-critical'
  if (usage.value.percentage > 70) return 'status-warn'
  return ''
})

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
</script>

<style scoped>
.context-usage-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px; border-radius: 6px;
  font-size: 11px; color: var(--text-secondary, #6b7280);
  cursor: default; position: relative;
  font-family: 'SF Mono', 'Consolas', monospace;
  white-space: nowrap;
}
.context-usage-badge:hover { background: var(--bg-secondary, #f9fafb); }
.usage-icon { font-size: 13px; }
.usage-bar {
  width: 40px; height: 4px; background: var(--border, #e5e7eb);
  border-radius: 2px; overflow: hidden;
}
.usage-bar-fill {
  height: 100%; background: var(--accent, #000);
  border-radius: 2px; transition: width 0.3s ease;
}
.status-warn .usage-bar-fill { background: #f59e0b; }
.status-critical .usage-bar-fill { background: #ef4444; }
.usage-pct { font-size: 10px; min-width: 32px; text-align: right; }

.usage-tooltip {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 100;
  background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px; padding: 10px 14px; min-width: 200px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.tooltip-row {
  display: flex; justify-content: space-between; gap: 24px;
  padding: 3px 0; font-size: 12px;
}
.tooltip-row span:first-child { color: var(--text-secondary, #6b7280); }
.tooltip-row span:last-child { color: var(--text-primary, #1f2937); font-weight: 500; }
</style>
```

- [ ] **Step 2: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/components/ContextUsageBadge.vue && git commit -m "feat: rewrite ContextUsageBadge for real-time OMP context monitoring"
```

---

### Task 4: 集成到 ChatInput

**Files:**
- Modify: `web/src/components/ChatInput.vue`

- [ ] **Step 1: Modify ChatInput.vue**

Read the current `D:\Maxma\MaxmaHere\web\src\components\ChatInput.vue` first, then add:

In the template, above the textarea, add a toolbar row:

```vue
<div class="input-toolbar">
  <ModelSelector />
  <div class="toolbar-spacer"></div>
  <ContextUsageBadge />
</div>
```

In the send function, include model parameters:

```typescript
// When sending a chat message:
ws.send(JSON.stringify({
  type: 'chat',
  payload: {
    message: userMessage,
    model: chatStore.currentModel,
    temperature: chatStore.temperature,
    max_tokens: chatStore.maxTokens,
  }
}))
```

In the script setup, import the new components:

```typescript
import ModelSelector from './ModelSelector.vue'
import ContextUsageBadge from './ContextUsageBadge.vue'
```

Add styles for the toolbar:

```css
.input-toolbar {
  display: flex; align-items: center;
  padding: 4px 8px; gap: 8px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}
.toolbar-spacer { flex: 1; }
```

- [ ] **Step 2: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/components/ChatInput.vue && git commit -m "feat: integrate ModelSelector and ContextUsageBadge into ChatInput"
```

---

### Task 5: 模型设置面板

**Files:**
- Create: `web/src/components/ModelSettingsPanel.vue`
- Modify: `web/src/components/SessionSidebar.vue`

- [ ] **Step 1: Create ModelSettingsPanel.vue**

```vue
<template>
  <div class="model-settings">
    <div class="settings-header">模型参数</div>

    <div class="setting-row">
      <label class="setting-label">Temperature</label>
      <div class="setting-control">
        <input
          type="range" min="0" max="2" step="0.1"
          :value="store.temperature"
          @input="store.setTemperature(Number(($event.target as HTMLInputElement).value))"
          class="setting-slider"
        />
        <span class="setting-value">{{ store.temperature.toFixed(1) }}</span>
      </div>
    </div>

    <div class="setting-row">
      <label class="setting-label">Max Tokens</label>
      <div class="setting-control">
        <input
          type="range" min="256" max="128000" step="256"
          :value="store.maxTokens"
          @input="store.setMaxTokens(Number(($event.target as HTMLInputElement).value))"
          class="setting-slider"
        />
        <span class="setting-value">{{ formatNum(store.maxTokens) }}</span>
      </div>
    </div>

    <div class="setting-row">
      <label class="setting-label">Thinking</label>
      <div class="setting-control">
        <button
          class="toggle-btn"
          :class="{ active: store.thinkingEnabled }"
          @click="store.toggleThinking(!store.thinkingEnabled)"
        >
          {{ store.thinkingEnabled ? '开启' : '关闭' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '../stores/chat'

const store = useChatStore()

function formatNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}
</script>

<style scoped>
.model-settings { padding: 12px; }
.settings-header {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--text-secondary, #6b7280);
  margin-bottom: 12px;
}
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0; gap: 12px;
}
.setting-row + .setting-row { border-top: 1px solid var(--border, #e5e7eb); }
.setting-label { font-size: 13px; color: var(--text-primary, #1f2937); min-width: 90px; }
.setting-control { display: flex; align-items: center; gap: 8px; }
.setting-slider {
  width: 120px; height: 4px; appearance: none;
  background: var(--border, #e5e7eb); border-radius: 2px; outline: none;
  cursor: pointer;
}
.setting-slider::-webkit-slider-thumb {
  appearance: none; width: 14px; height: 14px;
  background: var(--accent, #000); border-radius: 50%; cursor: pointer;
}
.setting-value {
  min-width: 40px; text-align: right;
  font-size: 12px; font-family: 'SF Mono', monospace;
  color: var(--text-primary, #1f2937);
}
.toggle-btn {
  padding: 4px 12px; border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px; background: transparent;
  font-size: 12px; color: var(--text-secondary, #6b7280);
  cursor: pointer;
}
.toggle-btn.active { background: #000; color: #fff; border-color: #000; }
</style>
```

- [ ] **Step 2: Integrate into SessionSidebar**

Read the current `D:\Maxma\MaxmaHere\web\src\components\SessionSidebar.vue` first. Find the settings/popup section and add:

```vue
<ModelSettingsPanel />
```

With the import:
```typescript
import ModelSettingsPanel from './ModelSettingsPanel.vue'
```

- [ ] **Step 3: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/components/ModelSettingsPanel.vue web/src/components/SessionSidebar.vue && git commit -m "feat: add ModelSettingsPanel to SessionSidebar"
```

---

### Task 6: WS 事件监听 — context_usage

**Files:**
- Modify: `web/src/stores/chat.ts`

- [ ] **Step 1: Add WS event handler**

In the WebSocket message handler (likely in `ChatView.vue` or `chat.ts` store), add handling for the `context_usage` event:

```typescript
// In WS message handler:
if (msg.type === 'context_usage') {
  const payload = msg.payload
  chatStore.updateContextUsage({
    estimatedTokens: payload.estimated_tokens || 0,
    maxTokens: payload.max_tokens || 128000,
    percentage: payload.percentage || 0,
    messageCount: payload.message_count || 0,
    modelName: payload.model_name || '',
  })
}
```

- [ ] **Step 2: Provider 选择 REST API**

Add a provider listing endpoint to the Python thin layer (`api/routes/providers.py`):

```python
@router.get("/api/providers")
async def list_providers(request: Request):
    """返回 OMP 可用的 provider 列表"""
    # For now, return a static list matching common OMP providers
    return [
        {"id": "openai", "label": "OpenAI", "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1"], "context_window": 128000},
        {"id": "anthropic", "label": "Anthropic", "models": ["claude-sonnet-4-20250514", "claude-haiku-3-5"], "context_window": 200000},
        {"id": "deepseek", "label": "DeepSeek", "models": ["deepseek-chat", "deepseek-reasoner"], "context_window": 64000},
        {"id": "google", "label": "Google", "models": ["gemini-2.5-flash", "gemini-2.5-pro"], "context_window": 1000000},
        {"id": "openrouter", "label": "OpenRouter", "models": ["openrouter/auto"], "context_window": 128000},
    ]
```

- [ ] **Step 3: Verify full build**

```bash
cd "D:/Maxma/MaxmaHere/web" && npm run build 2>&1 | tail -10
```

Expected: No errors, build completes.

- [ ] **Step 4: Final commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add -A && git commit -m "feat: WS context_usage handler + provider API endpoint"
```
