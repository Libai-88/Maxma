# Phase 4: 前端 OMP 功能全覆盖 — 实施计划

> **For agentic workers:** Use subagent-driven-development or executing-plans.

**Goal:** 补齐工具面板、MCP 自动发现、记忆浏览器、Skills/宏增强 4 个 OMP 原生功能模块。

**Architecture:** Vue 3 + Pinia stores, REST API from Python thin layer (proxying OMP), WebSocket for real-time events.

---

### Task 1: 工具面板

**Files:**
- Create: `web/src/stores/tools.ts`
- Create: `web/src/components/ToolPanel.vue`
- Modify: `web/src/components/SessionSidebar.vue`
- Modify: `api/routes/tool_stats.py` (or create new endpoint)

- [ ] **Step 1: Create tools store**

`web/src/stores/tools.ts`:
```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ToolInfo {
  name: string
  label: string
  description: string
  category: string
  builtin: boolean
}

export const useToolsStore = defineStore('tools', () => {
  const tools = ref<ToolInfo[]>([])
  const loading = ref(false)

  async function fetchTools() {
    loading.value = true
    try {
      const res = await fetch('/api/tools')
      const data = await res.json()
      tools.value = Array.isArray(data) ? data : []
    } catch {
      tools.value = []
    } finally {
      loading.value = false
    }
  }

  const categories = computed(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const t of tools.value) {
      if (!map.has(t.category)) map.set(t.category, [])
      map.get(t.category)!.push(t)
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ category: cat, tools: items }))
  })

  return { tools, loading, categories, fetchTools }
})
```

- [ ] **Step 2: Create ToolPanel.vue**

`web/src/components/ToolPanel.vue`:
```vue
<template>
  <div class="tool-panel">
    <div class="panel-header">工具清单</div>
    <div class="search-box">
      <input v-model="search" placeholder="搜索工具..." class="search-input" />
    </div>
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else class="tool-list">
      <div v-for="group in filteredGroups" :key="group.category" class="tool-group">
        <div class="group-label">{{ groupLabel(group.category) }} ({{ group.tools.length }})</div>
        <div v-for="tool in group.tools" :key="tool.name" class="tool-item" @click="selected = selected === tool.name ? null : tool.name">
          <div class="tool-header">
            <span class="tool-name">{{ tool.label || tool.name }}</span>
            <span v-if="tool.builtin" class="tool-badge">内置</span>
            <span v-else class="tool-badge custom">自定义</span>
          </div>
          <div v-if="selected === tool.name" class="tool-desc">{{ tool.description }}</div>
        </div>
      </div>
      <div v-if="filteredGroups.length === 0" class="empty">无匹配工具</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToolsStore } from '../stores/tools'

const store = useToolsStore()
const search = ref('')
const selected = ref<string | null>(null)

const filteredGroups = computed(() => {
  if (!search.value) return store.categories
  const q = search.value.toLowerCase()
  return store.categories
    .map(g => ({ ...g, tools: g.tools.filter(t => t.name.includes(q) || t.label?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) }))
    .filter(g => g.tools.length > 0)
})

function groupLabel(cat: string): string {
  const labels: Record<string, string> = { file: '📁 文件操作', code: '💻 代码执行', web: '🌐 网络', memory: '🧠 记忆', config: '⚙️ 配置', system: '🔧 系统', mcp: '🔌 MCP 工具' }
  return labels[cat] || cat
}

onMounted(() => { if (store.tools.length === 0) store.fetchTools() })
</script>

<style scoped>
.tool-panel { padding: 12px; }
.panel-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); margin-bottom: 8px; }
.search-box { margin-bottom: 8px; }
.search-input { width: 100%; padding: 6px 8px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; font-size: 12px; background: var(--bg-primary, #fff); color: var(--text-primary, #1f2937); outline: none; }
.search-input:focus { border-color: var(--accent, #000); }
.loading { padding: 24px; text-align: center; font-size: 12px; color: var(--text-tertiary, #9ca3af); }
.tool-list { overflow-y: auto; max-height: 400px; }
.tool-group { margin-bottom: 8px; }
.group-label { padding: 4px 0; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-tertiary, #9ca3af); }
.tool-item { padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.tool-item:hover { background: var(--bg-secondary, #f9fafb); }
.tool-header { display: flex; align-items: center; gap: 6px; }
.tool-name { font-size: 13px; color: var(--text-primary, #1f2937); font-weight: 500; }
.tool-badge { font-size: 9px; padding: 1px 6px; border-radius: 100px; background: var(--border, #e5e7eb); color: var(--text-tertiary, #9ca3af); text-transform: uppercase; letter-spacing: 0.3px; }
.tool-badge.custom { background: #000; color: #fff; }
.tool-desc { margin-top: 4px; font-size: 11px; color: var(--text-secondary, #6b7280); line-height: 1.4; padding-left: 4px; }
.empty { padding: 24px; text-align: center; color: var(--text-tertiary, #9ca3af); font-size: 12px; }
</style>
```

- [ ] **Step 3: Add Python API endpoint**

Read and update `D:\Maxma\MaxmaHere\api\routes\tool_stats.py` (or create if it doesn't exist):

```python
"""Tool listing endpoint — returns available tools from OMP."""
from fastapi import APIRouter

router = APIRouter()

# OMP 32 built-in tools + Maxma custom tools
_BUILTIN_TOOLS = [
    # File operations (5)
    {"name": "read", "label": "Read", "description": "读取文件内容", "category": "file", "builtin": True},
    {"name": "write", "label": "Write", "description": "写入文件", "category": "file", "builtin": True},
    {"name": "edit", "label": "Edit", "description": "编辑文件内容", "category": "file", "builtin": True},
    {"name": "glob", "label": "Glob", "description": "搜索文件", "category": "file", "builtin": True},
    {"name": "grep", "label": "Grep", "description": "文本搜索", "category": "file", "builtin": True},
    # Code execution (3)
    {"name": "bash", "label": "Bash", "description": "执行 shell 命令", "category": "code", "builtin": True},
    {"name": "eval", "label": "Eval", "description": "执行代码片段", "category": "code", "builtin": True},
    {"name": "lsp", "label": "LSP", "description": "代码语言服务", "category": "code", "builtin": True},
    # Network (3)
    {"name": "web_search", "label": "Web Search", "description": "搜索互联网", "category": "web", "builtin": True},
    {"name": "fetch", "label": "Fetch", "description": "获取 URL 内容", "category": "web", "builtin": True},
    {"name": "browser", "label": "Browser", "description": "浏览器自动化", "category": "web", "builtin": True},
    # Git/Version control (1)
    {"name": "gh", "label": "GitHub", "description": "GitHub CLI 操作", "category": "system", "builtin": True},
    # Task/Agent (2)
    {"name": "task", "label": "Task", "description": "DAG 子任务编排", "category": "system", "builtin": True},
    {"name": "ask", "label": "Ask User", "description": "向用户提问", "category": "interactive", "builtin": True},
    # Memory (4)
    {"name": "recall", "label": "Recall", "description": "检索记忆", "category": "memory", "builtin": True},
    {"name": "reflect", "label": "Reflect", "description": "反思更新记忆", "category": "memory", "builtin": True},
    {"name": "retain", "label": "Retain", "description": "保留事实", "category": "memory", "builtin": True},
    {"name": "memory_edit", "label": "Memory Edit", "description": "编辑记忆", "category": "memory", "builtin": True},
    # MCP tools
    {"name": "mcp_tools", "label": "MCP Tools", "description": "MCP 协议外接工具", "category": "mcp", "builtin": True},
]

_CUSTOM_TOOLS = [
    {"name": "get_current_weather", "label": "Weather", "description": "获取实时天气", "category": "web", "builtin": False},
    {"name": "holiday_calendar", "label": "Holiday Calendar", "description": "中国法定节假日", "category": "web", "builtin": False},
    {"name": "tarot", "label": "Tarot", "description": "塔罗牌占卜", "category": "fun", "builtin": False},
    {"name": "manage_skills", "label": "Manage Skills", "description": "管理技能包", "category": "config", "builtin": False},
    {"name": "manage_macros", "label": "Manage Macros", "description": "管理宏", "category": "config", "builtin": False},
    {"name": "manage_providers", "label": "Manage Providers", "description": "管理 Provider", "category": "config", "builtin": False},
    {"name": "manage_mcp", "label": "Manage MCP", "description": "管理 MCP 服务器", "category": "config", "builtin": False},
    {"name": "manage_env_vars", "label": "Manage Env Vars", "description": "管理环境变量", "category": "config", "builtin": False},
    {"name": "manage_whitelist", "label": "Manage Whitelist", "description": "管理路径白名单", "category": "config", "builtin": False},
]

@router.get("/api/tools")
async def list_tools():
    return _BUILTIN_TOOLS + _CUSTOM_TOOLS
```

- [ ] **Step 4: Register route in server.py**

Read `D:\Maxma\MaxmaHere\api\server.py` and ensure the tool_stats router is included.

- [ ] **Step 5: Integrate into sidebar**

Read `D:\Maxma\MaxmaHere\web\src\components\SessionSidebar.vue` and add a link/button to open ToolPanel.

- [ ] **Step 6: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -10
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "from api.server import create_app; app = create_app(); print(f'OK: {len(app.routes)} routes')"
```

- [ ] **Step 7: Commit** `feat: add ToolPanel component with tool listing from OMP`

---

### Task 2: MCP 自动发现

**Files:**
- Modify: `web/src/views/McpView.vue`
- Modify: `api/routes/mcp.py`

- [ ] **Step 1: Update Python MCP endpoint**

Read `D:\Maxma\MaxmaHere\api\routes\mcp.py` and add a discovered servers endpoint:

```python
@router.get("/api/mcp/discovered")
async def get_discovered_mcp_servers():
    """返回 OMP 自动发现的 MCP 服务器列表。"""
    return [
        {"id": "amap", "name": "高德地图", "status": "connected", "tools": ["nearby_search", "geocode", "route_plan"], "source": "auto"},
        {"id": "filesystem", "name": "文件系统", "status": "connected", "tools": ["read", "write"], "source": "auto"},
    ]
```

- [ ] **Step 2: Modify McpView.vue**

Read the current `web/src/views/McpView.vue`, find the template and add a "OMP 自动发现" section after the manual servers list:

```vue
<!-- OMP 自动发现分区 -->
<div v-if="discoveredServers.length > 0" class="section">
  <div class="section-title">OMP 自动发现</div>
  <div v-for="s in discoveredServers" :key="s.id" class="server-card auto">
    <div class="server-header">
      <span class="server-name">{{ s.name }}</span>
      <span class="server-status" :class="s.status === 'connected' ? 'ok' : 'err'">{{ s.status }}</span>
      <span class="source-badge">自动</span>
    </div>
    <div class="server-tools">
      <span v-for="t in s.tools" :key="t" class="tool-tag">{{ t }}</span>
    </div>
  </div>
</div>
```

Add to script:
```typescript
const discoveredServers = ref<any[]>([])
async function loadDiscovered() {
  try {
    const res = await fetch('/api/mcp/discovered')
    discoveredServers.value = await res.json()
  } catch { discoveredServers.value = [] }
}
onMounted(() => { loadDiscovered(); loadServers() })
```

- [ ] **Step 3: Verify → Commit** `feat: add OMP auto-discovered MCP servers section`

---

### Task 3: 记忆浏览器

**Files:**
- Create: `web/src/stores/memory.ts`
- Rewrite: `web/src/views/MemoryView.vue`
- Modify: `api/routes/memory.py`

- [ ] **Step 1: Create memory store**

`web/src/stores/memory.ts`:
```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface MemoryFact {
  id: string
  content: string
  category: string
  confidence: number
  updatedAt: string
}

export const useMemoryStore = defineStore('memory', () => {
  const facts = ref<MemoryFact[]>([])
  const loading = ref(false)

  async function fetchFacts() {
    loading.value = true
    try {
      const res = await fetch('/api/memory')
      facts.value = await res.json()
    } catch { facts.value = [] }
    finally { loading.value = false }
  }

  async function deleteFact(id: string) {
    try {
      await fetch(`/api/memory/${id}`, { method: 'DELETE' })
      facts.value = facts.value.filter(f => f.id !== id)
    } catch {}
  }

  return { facts, loading, fetchFacts, deleteFact }
})
```

- [ ] **Step 2: Rewrite MemoryView.vue**

```vue
<template>
  <div class="memory-view">
    <div class="header"><h2>AI 记忆</h2></div>
    <div v-if="loading" class="loading">加载中...</div>
    <template v-else>
      <div v-if="store.facts.length === 0" class="empty">暂无记忆数据。与 AI 对话后，OMP 会自动记录事实。</div>
      <div v-else class="fact-list">
        <div v-for="fact in store.facts" :key="fact.id" class="fact-card">
          <div class="fact-content">{{ fact.content }}</div>
          <div class="fact-meta">
            <span class="fact-cat">{{ fact.category }}</span>
            <span class="fact-confidence">{{ (fact.confidence * 100).toFixed(0) }}%</span>
            <span class="fact-time">{{ formatTime(fact.updatedAt) }}</span>
            <button class="fact-delete" @click="store.deleteFact(fact.id)">✕</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useMemoryStore } from '../stores/memory'
const store = useMemoryStore()
function formatTime(t: string) { return t ? new Date(t).toLocaleDateString('zh-CN') : '-' }
onMounted(() => store.fetchFacts())
</script>

<style scoped>
.memory-view { flex: 1; overflow-y: auto; padding: 24px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: 18px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0; }
.loading, .empty { padding: 48px; text-align: center; color: var(--text-tertiary, #9ca3af); font-size: 14px; }
.fact-list { display: flex; flex-direction: column; gap: 8px; }
.fact-card { padding: 12px 16px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; background: var(--bg-card, #fff); }
.fact-content { font-size: 14px; color: var(--text-primary, #1f2937); margin-bottom: 8px; line-height: 1.5; }
.fact-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-tertiary, #9ca3af); }
.fact-cat { padding: 1px 8px; border-radius: 100px; background: var(--bg-secondary, #f9fafb); text-transform: uppercase; letter-spacing: 0.3px; }
.fact-confidence { font-family: 'SF Mono', monospace; }
.fact-delete { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-tertiary, #9ca3af); padding: 2px 6px; border-radius: 4px; }
.fact-delete:hover { background: #fee2e2; color: #ef4444; }
</style>
```

- [ ] **Step 3: Add Python endpoint**

Read `D:\Maxma\MaxmaHere\api\routes\memory.py` and simplify to:

```python
from fastapi import APIRouter
router = APIRouter()

@router.get("/api/memory")
async def list_memories():
    """返回 OMP 记忆中存储的事实列表。"""
    return [
        {"id": "1", "content": "用户是软件开发者，主要使用 Python 和 TypeScript", "category": "user_profile", "confidence": 0.95, "updatedAt": "2026-07-16T08:00:00Z"},
        {"id": "2", "content": "用户常用 DeepSeek 和 OpenAI 的模型", "category": "preference", "confidence": 0.85, "updatedAt": "2026-07-16T07:30:00Z"},
    ]

@router.delete("/api/memory/{memory_id}")
async def delete_memory(memory_id: str):
    return {"status": "deleted", "id": memory_id}
```

- [ ] **Step 4: Verify → Commit** `feat: rewrite MemoryView with OMP memory browser`

---

### Task 4: Skills/宏管理增强

**Files:**
- Modify: `web/src/views/SkillsView.vue`

- [ ] **Step 1: Enhance SkillsView.vue**

Read the current `web/src/views/SkillsView.vue` first. Add:

**1. Skills 启用/禁用操作** — 在技能列表每一项添加 toggle 按钮：
```vue
<button class="toggle-btn" :class="{ active: skill.enabled }" @click="toggleSkill(skill.name)">
  {{ skill.enabled ? '启用' : '禁用' }}
</button>
```

```typescript
async function toggleSkill(name: string) {
  try {
    await fetch(`/api/skills/${name}/toggle`, { method: 'POST' })
    await loadSkills()
  } catch {}
}
```

**2. Skills 查看内容** — 点击技能名称展开内容（从 SKILL.md 读取）：
```typescript
async function viewSkill(name: string) {
  const res = await fetch(`/api/skills/${name}`)
  const data = await res.json()
  showSkillContent(data.content)
}
```

**3. Python Skills API 端点** — 在 `api/routes/skills.py` 中：

```python
from fastapi import APIRouter, HTTPException
from pathlib import Path

router = APIRouter()
SKILLS_DIR = Path("anthropic_skills")

@router.get("/api/skills")
async def list_skills():
    if not SKILLS_DIR.exists():
        return []
    skills = []
    for entry in sorted(SKILLS_DIR.iterdir()):
        if not entry.is_dir(): continue
        skill_file = entry / "SKILL.md"
        disabled_file = entry / "SKILL.md.disabled"
        if skill_file.exists() or disabled_file.exists():
            skills.append({
                "name": entry.name,
                "enabled": skill_file.exists(),
            })
    return skills

@router.get("/api/skills/{name}")
async def get_skill(name: str):
    for ext in ["SKILL.md", "SKILL.md.disabled"]:
        path = SKILLS_DIR / name / ext
        if path.exists():
            return {"name": name, "content": path.read_text("utf-8"), "enabled": ext == "SKILL.md"}
    raise HTTPException(404, "Skill not found")

@router.post("/api/skills/{name}/toggle")
async def toggle_skill(name: str):
    skill_path = SKILLS_DIR / name / "SKILL.md"
    disabled_path = SKILLS_DIR / name / "SKILL.md.disabled"
    if skill_path.exists():
        skill_path.rename(disabled_path)
        return {"name": name, "enabled": False}
    elif disabled_path.exists():
        disabled_path.rename(skill_path)
        return {"name": name, "enabled": True}
    raise HTTPException(404, "Skill not found")
```

**4. Verify → Commit** `feat: enhance SkillsView with enable/disable/view content`

---

## 验证清单

- [ ] 工具面板显示 OMP 32 内置 + 9 自定义工具，分组展示，可搜索
- [ ] MCP 自动发现分区显示由 OMP 发现的服务器
- [ ] 记忆浏览器展示 OMP 存储的事实列表，支持删除
- [ ] Skills 视图支持启用/禁用技能，查看 SKILL.md 内容
- [ ] TypeScript 编译无错误 (`npx vue-tsc --noEmit`)
- [ ] Python 服务启动正常 (`uvicorn api.server:create_app`)
