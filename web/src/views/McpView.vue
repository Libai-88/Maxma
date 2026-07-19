<template>
  <div class="mcp-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>MCP 服务</h2>
      <button v-if="mode === 'list'" class="ds-btn ds-btn--primary" @click="startAdd">+ 添加 MCP 服务器</button>
      <button v-else class="ds-btn" @click="cancelForm">← 返回列表</button>
    </div>

    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="loadError" class="empty">
        加载失败: {{ loadError }}
        <div class="retry-row">
          <button class="ds-btn ds-btn--primary" @click="loadServers">重试</button>
        </div>
      </div>
      <div v-else-if="servers.length === 0" class="empty enhanced-empty">
        <!-- Hero -->
        <div class="empty-hero">
          <svg class="empty-hero-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <!-- Server -->
            <rect x="8" y="6" width="32" height="36" rx="4" />
            <circle cx="24" cy="18" r="3.5" />
            <path d="M24 30v-6" />
            <path d="M16 32h4M28 32h4" />
            <!-- Connection lines -->
            <path d="M24 6V2M24 42v4" />
          </svg>
          <div class="empty-hero-text">
            <h3>开始使用 MCP 服务器</h3>
            <p>MCP 是一种让 Maxma 与外部工具和服务安全连接的通用方式。通过添加 MCP 服务器，你的 AI 就能读取文件、查询信息、运行命令，能力大幅扩展。</p>
          </div>
        </div>

        <!-- Guide cards -->
        <div class="guide-cards">
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 4v4M10 8h12v6a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Z" />
              <path d="M16 20v6" />
              <path d="M10 26h12" />
            </svg>
            <h4>什么是 MCP？</h4>
            <p>MCP 相当于 AI 与各种工具之间的"翻译官"。有了 MCP 服务器，Maxma 就能跟你的文件、数据库、网页等各种工具和服务"对话"，就像跟人交流一样自然。</p>
          </div>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 6a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h2a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2Z" />
              <path d="M10 6a4 4 0 0 0-4 4v12a4 4 0 0 0 4 4h2a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2Z" />
              <path d="M8 12h2M22 12h2" />
            </svg>
            <h4>常见用途</h4>
            <p>例如：读写和搜索本地文件、运行代码查看结果、获取网页内容、查询数据、管理代码版本、处理图片等。只要有命令行接口的工具或服务，都可以变成 MCP 服务器为 AI 所用。</p>
          </div>
          <div class="guide-card">
            <svg class="guide-card-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="16" cy="16" r="10" />
              <path d="M14 11l6 5-6 5" />
            </svg>
            <h4>快速开始</h4>
            <p><strong>1.</strong> 点击下方按钮添加服务器<br><strong>2.</strong> 给服务器取个名字、选好连接方式<br><strong>3.</strong> 填好必要信息，保存后即可启用</p>
          </div>
        </div>

        <!-- Role guidance -->
        <div class="role-guidance">
          <div class="role-card">
            <span class="role-badge">开发者</span>
            <span>了解命令行操作的话，点击下方「添加 MCP 服务器」自由配置</span>
          </div>
          <div class="role-card">
            <span class="role-badge">普通用户</span>
            <span>想快速体验的话，点击下方「添加示例服务器」一键上手</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="empty-actions">
          <button class="ds-btn ds-btn--primary" @click="startAdd">+ 添加 MCP 服务器</button>
          <button class="ds-btn" @click="startAddWithExample">添加示例服务器</button>
        </div>

        <!-- 模板快速入口：覆盖常用 MCP 服务器，让 Novice 不必查找文档 -->
        <div class="preset-templates">
          <div class="preset-templates-title">📦 常用 MCP 模板（点击一键填入）：</div>
          <div class="preset-template-list">
            <button
              v-for="t in mcpTemplates"
              :key="t.id"
              type="button"
              class="ds-btn preset-template-btn"
              @click="startAddWithTemplate(t)"
            >{{ t.label }}</button>
          </div>
        </div>
      </div>
      <div v-else class="card-grid">
        <div v-for="s in servers" :key="s.server_id" class="mcp-card">
          <!-- 顶部信息区 -->
          <div class="card-header">
            <div class="card-title-row">
              <span class="card-label">{{ s.server_id }}</span>
              <span class="transport-badge" :class="s.transport">{{ transportLabel(s.transport) }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: s.enabled }"
              :disabled="toggling.has(s.server_id)"
              :title="s.enabled ? '已启用' : '已停用'"
              @click="toggleServer(s.server_id, !s.enabled)"
            ></button>
          </div>

          <!-- 描述 -->
          <div v-if="s.description" class="card-desc">{{ s.description }}</div>

          <!-- 连接信息 -->
          <div class="card-connection">
            <template v-if="s.transport === 'stdio'">
              <span class="mono">{{ s.command || '-' }}</span>
              <span v-if="s.args?.length" class="mono args">{{ s.args.join(' ') }}</span>
            </template>
            <template v-else>
              <span class="mono url">{{ s.url || '-' }}</span>
            </template>
          </div>

          <!-- 工具数量 -->
          <div class="card-tools">
            <span class="tool-count">{{ s.tool_count }} 个工具</span>
            <span v-if="!s.enabled" class="disabled-tag">已停用</span>
          </div>

          <!-- 操作按钮 -->
          <div class="card-actions">
            <button class="action-btn" :disabled="loadingDetailId === s.server_id" @click="startEdit(s)">
              {{ loadingDetailId === s.server_id ? '加载...' : '编辑' }}
            </button>
            <button class="action-btn danger" :disabled="deletingId === s.server_id" @click="deleteServer(s.server_id)">
              {{ deletingId === s.server_id ? '删除中...' : '删除' }}
            </button>
          </div>
        </div>
      </div>

      <!-- OMP 自动发现 -->
      <div v-if="discoveredServers.length > 0" class="section omp-section">
        <div class="section-title">OMP 自动发现</div>
        <div v-for="s in discoveredServers" :key="s.id" class="server-card">
          <div class="server-header">
            <span class="server-name">{{ s.name }}</span>
            <span class="server-status" :class="s.status === 'connected' ? 'ok' : 'err'">{{ s.status }}</span>
            <span class="auto-tag">自动</span>
          </div>
          <div class="server-tools" v-if="s.tools && s.tools.length">
            <span v-for="t in s.tools" :key="t" class="tool-tag">{{ t }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 表单模式（添加/编辑） ── -->
    <form v-else class="wizard-form" @submit.prevent="handleSave">
      <!-- 模板快速入口（仅新增模式：让 Novice 不必从零填表） -->
      <div v-if="!isEditing" class="form-templates">
        <span class="form-templates-label">📦 套用模板：</span>
        <button
          v-for="t in mcpTemplates"
          :key="t.id"
          type="button"
          class="form-template-btn"
          @click="startAddWithTemplate(t)"
        >{{ t.label }}</button>
      </div>
      <!-- 基本信息 -->
      <div class="form-section">
        <label class="form-label">服务器 ID</label>
        <input
          v-model="form.server_id"
          class="input mono"
          placeholder="例如: github, filesystem, playwright"
          :disabled="isEditing"
          required
        />
        <div class="form-hint">给服务器取一个唯一的名字，会用作 AI 调用功能时的前缀（比如取名 github，工具名就是 github_search）</div>
      </div>

      <div class="form-section">
        <label class="form-label">
          传输方式
          <span
            class="help-icon"
            tabindex="0"
            role="button"
            aria-label="传输方式帮助"
            @mouseenter="showHelp($event, HELP_TRANSPORT)"
            @mouseleave="helpTip?.hide()"
            @focus="showHelp($event, HELP_TRANSPORT)"
            @blur="helpTip?.hide()"
          >?</span>
        </label>
        <select v-model="form.transport" class="input" :disabled="isEditing" required>
          <option value="stdio">stdio（本地程序）</option>
          <option value="sse">SSE（服务端推送消息）</option>
          <option value="streamable_http">Streamable HTTP</option>
          <option value="websocket">WebSocket</option>
        </select>
      </div>

      <div class="form-section">
        <label class="form-label">描述</label>
        <input v-model="form.description" class="input" placeholder="简要描述这个 MCP 服务器的用途" />
      </div>

      <!-- stdio 专用字段 -->
      <template v-if="form.transport === 'stdio'">
        <div class="form-section">
          <label class="form-label">
            命令
            <span
              class="help-icon"
              tabindex="0"
              role="button"
              aria-label="命令帮助"
            @mouseenter="showHelp($event, HELP_COMMAND)"
            @mouseleave="helpTip?.hide()"
            @focus="showHelp($event, HELP_COMMAND)"
              @blur="helpTip?.hide()"
            >?</span>
          </label>
          <input v-model="form.command" class="input mono" placeholder="例如: npx, python, node" required />
          <div class="form-hint">
            常用命令：npx（运行 Node.js 工具）、python（运行 Python 脚本）、node（运行 JavaScript）、git（代码管理）、docker（容器）等。
            其他命令需确保安全可信（不可包含路径分隔符）。
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">
            参数
            <span
              class="help-icon"
              tabindex="0"
              role="button"
              aria-label="参数帮助"
            @mouseenter="showHelp($event, HELP_ARGS)"
            @mouseleave="helpTip?.hide()"
            @focus="showHelp($event, HELP_ARGS)"
              @blur="helpTip?.hide()"
            >?</span>
          </label>
          <div class="kv-list">
            <div v-for="(_arg, i) in form.args" :key="i" class="kv-row">
              <input v-model="form.args[i]" class="input mono" placeholder="如: -y 或 --port=8080" />
              <button type="button" class="kv-remove" @click="form.args.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="kv-add" @click="form.args.push('')">+ 添加参数</button>
          </div>
          <div class="form-hint">
            例如 npx -y @modelcontextprotocol/server-filesystem D:\我的文件夹 这个命令，-y 和后面的路径各占一行。
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">环境变量</label>
          <div class="kv-list">
            <div v-for="(entry, i) in form.envEntries" :key="i" class="kv-row">
              <input v-model="entry.key" class="input mono" placeholder="KEY" />
              <input v-model="entry.value" class="input mono" placeholder="VALUE" />
              <button type="button" class="kv-remove" @click="form.envEntries.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="kv-add" @click="form.envEntries.push({ key: '', value: '' })">+ 添加环境变量</button>
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">工作目录</label>
          <input v-model="form.cwd" class="input mono" placeholder="可选，子进程的工作目录" />
        </div>
      </template>

      <!-- URL 类传输专用字段 -->
      <template v-if="form.transport !== 'stdio'">
        <div class="form-section">
          <label class="form-label">URL</label>
          <input v-model="form.url" class="input mono" placeholder="例如: http://localhost:3000/mcp" required />
          <div class="form-hint">
            仅允许连接到本机地址（localhost / 127.0.0.1 / 0.0.0.0 / ::1）。
            SSE/HTTP 用 http:// 开头，WebSocket 用 ws:// 或 wss:// 开头。
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">
            <input type="checkbox" v-model="form.tls_verify" />
            启用 TLS 证书校验
          </label>
          <div class="form-hint">
            默认开启。生产模式（MAXMA_ENV=production）下关闭会被忽略并强制启用。
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">请求头</label>
          <div class="kv-list">
            <div v-for="(entry, i) in form.headersEntries" :key="i" class="kv-row">
              <input v-model="entry.key" class="input mono" placeholder="Header-Name" />
              <input v-model="entry.value" class="input mono" placeholder="Value" />
              <button type="button" class="kv-remove" @click="form.headersEntries.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="kv-add" @click="form.headersEntries.push({ key: '', value: '' })">+ 添加请求头</button>
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">超时（秒）</label>
          <input v-model.number="form.timeout" type="number" class="input" placeholder="可选" min="0" step="0.1" />
        </div>

        <div v-if="form.transport === 'sse'" class="form-section">
          <label class="form-label">SSE 读取超时（秒）</label>
          <input v-model.number="form.sse_read_timeout" type="number" class="input" placeholder="可选" min="0" step="0.1" />
        </div>
      </template>

      <!-- 阶段 4.1：工具级 allowlist / blocklist -->
      <div class="form-section">
        <label class="form-label">
          允许的工具（allowlist，可选）
          <span
            class="help-icon"
            tabindex="0"
            role="button"
            aria-label="Allowlist 帮助"
            @mouseenter="showHelp($event, HELP_ALLOWLIST)"
            @mouseleave="helpTip?.hide()"
            @focus="showHelp($event, HELP_ALLOWLIST)"
            @blur="helpTip?.hide()"
          >?</span>
        </label>
        <div class="chips-list">
          <span v-for="(t, i) in form.allowed_tools" :key="'a'+i" class="chip">
            {{ t }}
            <button type="button" class="chip-remove" @click="form.allowed_tools!.splice(i, 1)">✕</button>
          </span>
          <input
            class="chip-input"
            v-model="newAllowedTool"
            placeholder="新增工具名或通配符（如 github_*）后回车"
            @keydown.enter.prevent="addChip(form.allowed_tools!, newAllowedTool); newAllowedTool = ''"
          />
        </div>
        <div class="form-hint">
          留空 = 允许全部功能。填写后只有列表中的功能可用。支持通配符（* 匹配任意字符）。
        </div>
        <div v-if="availableTools.length" class="form-hint">
          已加载工具（点击添加）：
          <span
            v-for="t in availableTools"
            :key="t"
            class="tool-pick"
            @click="addChip(form.allowed_tools!, t)"
          >{{ t }}</span>
        </div>
        <div v-else class="form-hint form-hint--info">
          💡 此服务器的工具由 AI 动态加载，暂不在此预列。如需查看可用工具，请在对话中询问 AI「列出当前可用的 MCP 工具」；如需精确控制，可在此手动填入工具名（如 <code>github_*</code>）。
        </div>
      </div>

      <div class="form-section">
        <label class="form-label">
          屏蔽的工具（blocklist，可选）
          <span
            class="help-icon"
            tabindex="0"
            role="button"
            aria-label="Blocklist 帮助"
            @mouseenter="showHelp($event, HELP_BLOCKLIST)"
            @mouseleave="helpTip?.hide()"
            @focus="showHelp($event, HELP_BLOCKLIST)"
            @blur="helpTip?.hide()"
          >?</span>
        </label>
        <div class="chips-list">
          <span v-for="(t, i) in form.blocked_tools" :key="'b'+i" class="chip chip-danger">
            {{ t }}
            <button type="button" class="chip-remove" @click="form.blocked_tools!.splice(i, 1)">✕</button>
          </span>
          <input
            class="chip-input"
            v-model="newBlockedTool"
            placeholder="新增工具名或通配符（如 admin_*）后回车"
            @keydown.enter.prevent="addChip(form.blocked_tools!, newBlockedTool); newBlockedTool = ''"
          />
        </div>
        <div class="form-hint">
          屏蔽优先于允许——被屏蔽的功能即使也在允许列表中也不会被 AI 使用。
        </div>
        <div v-if="availableTools.length" class="form-hint">
          已加载工具（点击屏蔽）：
          <span
            v-for="t in availableTools"
            :key="t"
            class="tool-pick tool-pick-danger"
            @click="addChip(form.blocked_tools!, t)"
          >{{ t }}</span>
        </div>
      </div>

      <!-- 保存按钮 -->
      <div class="form-actions">
        <button
          v-if="form.transport === 'stdio'"
          type="button"
          class="ds-btn"
          :disabled="testing || saving"
          @click="handleTestConnection"
        >
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button type="submit" class="ds-btn ds-btn--primary" :disabled="saving || testing">
          {{ saving ? '保存中...' : (isEditing ? '保存修改' : '创建服务器') }}
        </button>
        <span v-if="saveMessage" class="save-msg" :class="saveMessageClass">{{ saveMessage }}</span>
      </div>
    </form>

    <!-- ── 全局提示 ── -->
    <div v-if="globalMessage" class="global-message" :class="globalMessageClass">
      {{ globalMessage }}
    </div>

    <!-- ── 术语帮助提示 ── -->
    <DsTooltip ref="helpTip" :content="helpContent" placement="right" :delay="300" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import type { MCPServerConfig, MCPServerCreateBody, MCPTransport, DiscoveredServer } from '@/types'
import DsTooltip from '@/components/ui/DsTooltip.vue'

type Mode = 'list' | 'add' | 'edit'

// ── 列表状态 ──
const loading = ref(true)
const loadError = ref('')
// 列表接口返回的是 MCPServerInfo[]，但后端实际会带上 stdio/URL 等扩展字段
// （用于卡片连接信息展示），故用 MCPServerConfig[] 表达更准确的运行时形状。
const servers = ref<MCPServerConfig[]>([])
const mode = ref<Mode>('list')

// ── 表单状态 ──
const saving = ref(false)
const testing = ref(false)
const saveMessage = ref('')
const saveMessageClass = ref('')
const editingId = ref('')
const loadingDetailId = ref('')  // 编辑按钮加载状态
const deletingId = ref('')       // 删除按钮防抖

// ── 全局提示 ──
const globalMessage = ref('')
const globalMessageClass = ref('')

// ── 术语帮助提示 ──
const helpTip = ref<InstanceType<typeof DsTooltip>>()
const helpContent = ref('')

// 帮助文本常量（避免模板内嵌重复字面量）
	const HELP_TRANSPORT = '选择 MCP 服务器与 Maxma 的连接方式：\n\nstdio — 在本机启动一个程序（最常用），适合安装在本地的工具\nSSE — 通过长连接接收服务端推送的消息\nStreamable HTTP — 基于 HTTP 协议，支持数据流式传输\nWebSocket — 双向实时通信，适合需要持续交互的服务'

	const HELP_COMMAND = '需要运行的命令行程序（仅 stdio 模式需要填写）。\n\n常用选项：npx（运行 Node.js 工具）、python（运行 Python 脚本）、node（运行 JavaScript）、docker（运行容器）等。\n\n系统会检查命令是否在安全白名单中，不在名单中的命令会被禁止执行。'

	const HELP_ARGS = '传给命令行程序的额外参数，每行一个，按顺序传递。\n\n举个例子，运行这条命令：\n  npx -y @modelcontextprotocol/server-filesystem D:\我的文件夹\n\n在参数列表里就要填三行：\n  第 1 行：-y\n  第 2 行：@modelcontextprotocol/server-filesystem\n  第 3 行：D:\我的文件夹'

	const HELP_ALLOWLIST = '允许列表：限制该服务器只开放指定的功能。\n\n留空 = 该服务器的所有功能都可以被 AI 使用。\n填入后，只有名单里的功能才会被 AI 看到和调用。\n支持通配符 *，比如 github_* 表示所有以 github_ 开头的功能。'

	const HELP_BLOCKLIST = '屏蔽列表：禁止该服务器使用指定的功能。\n\n屏蔽的优先级高于允许列表——即使某个功能同时在允许列表中，也会被屏蔽。\n被屏蔽的功能不会被 AI 看到和使用。\n支持通配符 *。'

// ── OMP 自动发现 ──
const discoveredServers = ref<DiscoveredServer[]>([])

async function loadDiscovered() {
  const mySeq = ++loadDiscoveredSeq
  try {
    const data = await api.listMcpDiscovered()
    if (mySeq !== loadDiscoveredSeq) return
    discoveredServers.value = Array.isArray(data) ? data : []
  } catch { if (mySeq === loadDiscoveredSeq) discoveredServers.value = [] }
}

// ── toggle 防抖 ──
const toggling = reactive<Set<string>>(new Set())

// ── 阶段 4.1：可用工具列表 ──
const availableTools = ref<string[]>([])
const newAllowedTool = ref('')
const newBlockedTool = ref('')

// ── 竞态保护：数据加载序列号 ──
// 每个独立的异步加载流程使用独立的序列号。之前 loadServers 和 loadDiscovered 共享
// 同一个 loadSeq，导致 onMounted 中两者并发触发时，后启动的会让前一个的响应被
// 丢弃（如 loadServers 先 ++loadSeq=1，loadDiscovered 再 ++loadSeq=2，loadServers
// 的响应回来后 1 !== 2 直接 return，导致 servers 列表永远为空）。
let loadServersSeq = 0
let loadDiscoveredSeq = 0
let editSeq = 0

// ── setTimeout 统一清理 ──
const timers: number[] = []
function schedule(fn: () => void, delay: number) {
  const id = window.setTimeout(fn, delay)
  timers.push(id)
}
onUnmounted(() => {
  while (timers.length) {
    window.clearTimeout(timers.pop())
  }
})

// ── 表单结构：env/headers 用数组化避免 key 重命名导致 DOM 重建 ──
type KVEntry = { key: string; value: string }

const emptyForm = () => ({
  server_id: '',
  transport: 'stdio' as MCPTransport,
  enabled: true,
  description: '',
  // stdio 专用
  command: '',
  args: [] as string[],
  envEntries: [] as KVEntry[],
  cwd: '',
  // URL 类专用
  url: '',
  headersEntries: [] as KVEntry[],
  timeout: undefined as number | undefined,
  sse_read_timeout: undefined as number | undefined,
  tls_verify: true,
  // 工具 allowlist / blocklist
  allowed_tools: [] as string[],
  blocked_tools: [] as string[],
})

const form = reactive(emptyForm())

const isEditing = computed(() => mode.value === 'edit')

// ── helpers ──
function addChip(arr: string[], value: string) {
  const v = value.trim()
  if (v && !arr.includes(v)) {
    arr.push(v)
  }
}

function transportLabel(t: string): string {
  const map: Record<string, string> = {
    stdio: 'stdio',
    sse: 'SSE',
    streamable_http: 'HTTP',
    websocket: 'WS',
  }
  return map[t] || t
}

// 对象 ↔ 数组 转换
function objToEntries(obj: Record<string, string> | undefined): KVEntry[] {
  if (!obj) return []
  return Object.keys(obj).map((k) => ({ key: k, value: obj[k] }))
}

function entriesToObj(entries: KVEntry[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of entries) {
    const k = (e.key || '').trim()
    if (k) out[k] = e.value
  }
  return out
}

function showGlobal(msg: string, cls: 'ok' | 'error', autoClearMs = 2500) {
  globalMessage.value = msg
  globalMessageClass.value = cls
  if (autoClearMs > 0) {
    schedule(() => {
      if (globalMessage.value === msg) globalMessage.value = ''
    }, autoClearMs)
  }
}

// ── 帮助提示 ──
function showHelp(e: Event, text: string) {
  helpContent.value = text
  helpTip.value?.show(e)
}

// ── 列表加载 ──
async function loadServers() {
  const mySeq = ++loadServersSeq
  loading.value = true
  loadError.value = ''
  try {
    const res = await api.listMcpServers()
    if (mySeq !== loadServersSeq) return
    servers.value = (res.servers || []) as MCPServerConfig[]
  } catch (e: unknown) {
    if (mySeq === loadServersSeq) loadError.value = toErrorMessage(e)
  } finally {
    if (mySeq === loadServersSeq) loading.value = false
  }
}

// ── 新增 ──
function startAdd() {
  Object.assign(form, emptyForm())
  availableTools.value = []
  newAllowedTool.value = ''
  newBlockedTool.value = ''
  saveMessage.value = ''
  saveMessageClass.value = ''
  mode.value = 'add'
}

// ── 新增（预填示例） ──
function startAddWithExample() {
  Object.assign(form, {
    ...emptyForm(),
    server_id: 'filesystem',
    transport: 'stdio' as MCPTransport,
    description: '让 AI 能够读取、写入和管理你电脑上的本地文件',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
  })
  availableTools.value = []
  newAllowedTool.value = ''
  newBlockedTool.value = ''
  saveMessage.value = ''
  saveMessageClass.value = ''
  mode.value = 'add'
}

// ── 常用 MCP 服务器模板：覆盖最常见的 Novice / Power 用户场景 ──
// 点击模板后预填表单，用户只需修改路径 / Token 即可保存
interface McpTemplate {
  id: string
  label: string
  server_id: string
  description: string
  command: string
  args: string[]
  envEntries?: KVEntry[]
}

const mcpTemplates: McpTemplate[] = [
  {
    id: 'filesystem',
    label: '📁 文件系统',
    server_id: 'filesystem',
    description: '让 AI 能读取、写入、搜索你电脑上的本地文件',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
  },
  {
    id: 'playwright',
    label: '🌐 浏览器自动化',
    server_id: 'playwright',
    description: '通过 Playwright 控制浏览器，AI 可以打开网页、点击、截图、提取内容（官方 Microsoft 包）',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
  },
  {
    id: 'fetch',
    label: '🔎 网页抓取',
    server_id: 'fetch',
    description: '让 AI 能抓取任意 URL 的网页内容并转为 Markdown',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
  },
  {
    id: 'git',
    label: '🔀 Git 仓库',
    server_id: 'git',
    description: '让 AI 能查看 Git 仓库状态、diff、log、创建分支、提交等。⚠️ 需先安装 uv（pip install uv），uvx 是 uv 自带的命令',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '/path/to/your/repo'],
  },
  {
    id: 'memory',
    label: '🧠 持久记忆',
    server_id: 'memory',
    description: '基于知识图谱的长期记忆，AI 能跨会话记住实体和关系',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    id: 'github',
    label: '🐙 GitHub',
    server_id: 'github',
    description: '让 AI 能查看 GitHub 仓库、Issue、PR、搜索代码',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envEntries: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: '' }],
  },
]

function startAddWithTemplate(t: McpTemplate) {
  Object.assign(form, {
    ...emptyForm(),
    server_id: t.server_id,
    transport: 'stdio' as MCPTransport,
    description: t.description,
    command: t.command,
    args: [...t.args],
    envEntries: t.envEntries ? t.envEntries.map(e => ({ ...e })) : [],
  })
  availableTools.value = []
  newAllowedTool.value = ''
  newBlockedTool.value = ''
  saveMessage.value = ''
  saveMessageClass.value = ''
  mode.value = 'add'
}

// ── 编辑（带竞态保护 + 加载状态） ──
async function startEdit(server: MCPServerConfig) {
  const mySeq = ++editSeq
  loadingDetailId.value = server.server_id
  saveMessage.value = ''
  saveMessageClass.value = ''
  availableTools.value = []
  newAllowedTool.value = ''
  newBlockedTool.value = ''

  try {
    const full = await api.getMcpServer(server.server_id)
    // 竞态保护：期间用户可能点了其他卡片或离开页面
    if (mySeq !== editSeq) return

    Object.assign(form, {
      server_id: full.server_id,
      transport: full.transport,
      enabled: full.enabled,
      description: full.description || '',
      command: full.command || '',
      args: full.args || [],
      envEntries: objToEntries(full.env),
      cwd: full.cwd || '',
      url: full.url || '',
      headersEntries: objToEntries(full.headers),
      timeout: full.timeout,
      sse_read_timeout: full.sse_read_timeout,
      tls_verify: full.tls_verify !== false,
      allowed_tools: full.allowed_tools || [],
      blocked_tools: full.blocked_tools || [],
    })
    editingId.value = server.server_id
    mode.value = 'edit'

    // 加载该服务器已加载的工具列表（失败不阻塞编辑）
    try {
      const res = await api.listMcpServerTools(server.server_id)
      if (mySeq !== editSeq) return
      availableTools.value = res.tools || []
    } catch {
      if (mySeq !== editSeq) return
      availableTools.value = []
    }
  } catch (e: unknown) {
    if (mySeq !== editSeq) return
    showGlobal('加载服务器详情失败: ' + toErrorMessage(e), 'error')
  } finally {
    if (mySeq === editSeq) {
      loadingDetailId.value = ''
    }
  }
}

function cancelForm() {
  editSeq++  // 取消正在进行的编辑请求
  mode.value = 'list'
  saveMessage.value = ''
  saveMessageClass.value = ''
  loadingDetailId.value = ''
  Object.assign(form, emptyForm())  // 清除表单数据，防止下次打开编辑时残留
}

// ── 测试连接（仅 stdio） ──
async function handleTestConnection() {
  if (!form.command) {
    saveMessage.value = '请填写命令'
    saveMessageClass.value = 'error'
    return
  }
  if (testing.value) return  // 防抖
  testing.value = true
  saveMessage.value = ''
  saveMessageClass.value = ''
  try {
    const argsList = form.args.filter((a) => a != null && a !== '')
    const envMap = entriesToObj(form.envEntries)

    const result = await api.testMcpConnection({
      command: form.command,
      args: argsList,
      env: envMap,
    })

    if (result.success) {
      saveMessage.value = `连接成功（解析命令: ${result.resolved_command || '-'}）`
      saveMessageClass.value = 'ok'
    } else {
      saveMessage.value = result.error || '连接失败'
      saveMessageClass.value = 'error'
    }
  } catch (e: unknown) {
    saveMessage.value = '请求失败: ' + toErrorMessage(e)
    saveMessageClass.value = 'error'
  } finally {
    testing.value = false
  }
}

// ── 保存（新增/编辑） ──
async function handleSave() {
  if (saving.value) return  // 防抖
  // 前端基础校验
  if (!form.server_id.trim()) {
    saveMessage.value = '请填写服务器 ID'
    saveMessageClass.value = 'error'
    return
  }
  if (form.transport === 'stdio' && !form.command.trim()) {
    saveMessage.value = '请填写命令'
    saveMessageClass.value = 'error'
    return
  }
  if (form.transport !== 'stdio' && !form.url.trim()) {
    saveMessage.value = '请填写 URL'
    saveMessageClass.value = 'error'
    return
  }

  saving.value = true
  saveMessage.value = ''
  saveMessageClass.value = ''
  try {
    // body 公共字段（create / update 共用）
    const body: MCPServerCreateBody = {
      server_id: form.server_id.trim(),
      transport: form.transport,
      enabled: form.enabled,
      description: form.description,
    }
    if (form.transport === 'stdio') {
      body.command = form.command
      const argsList = form.args.filter((a) => a != null && a !== '')
      if (argsList.length) body.args = argsList
      const envMap = entriesToObj(form.envEntries)
      if (Object.keys(envMap).length) body.env = envMap
      if (form.cwd) body.cwd = form.cwd
    } else {
      body.url = form.url
      body.tls_verify = form.tls_verify
      const headersMap = entriesToObj(form.headersEntries)
      if (Object.keys(headersMap).length) body.headers = headersMap
      if (form.timeout != null) body.timeout = form.timeout
      if (form.transport === 'sse' && form.sse_read_timeout != null) {
        body.sse_read_timeout = form.sse_read_timeout
      }
    }
    if (form.allowed_tools.length) body.allowed_tools = form.allowed_tools
    if (form.blocked_tools.length) body.blocked_tools = form.blocked_tools

    if (mode.value === 'add') {
      await api.createMcpServer(body)
      saveMessage.value = '创建成功'
    } else {
      // update 时 server_id / transport 仅由 URL 确定，body 中多余字段后端自动忽略
      await api.updateMcpServer(editingId.value, body)
      saveMessage.value = '保存成功'
    }
    saveMessageClass.value = 'ok'

    // saving 锁延迟释放：避免 800ms 窗口期内用户重复点击
    schedule(() => {
      mode.value = 'list'
      Object.assign(form, emptyForm())
      editingId.value = ''
      loadServers()
      saving.value = false
    }, 800)
  } catch (e: unknown) {
    saveMessage.value = '失败: ' + toErrorMessage(e)
    saveMessageClass.value = 'error'
    saving.value = false  // 失败立即释放
  }
}

// ── 启用/停用（防抖） ──
async function toggleServer(serverId: string, enabled: boolean) {
  if (toggling.has(serverId)) return  // 防抖
  toggling.add(serverId)
  try {
    await api.updateMcpServer(serverId, { enabled })
    const s = servers.value.find((x) => x.server_id === serverId)
    if (s) s.enabled = enabled
    showGlobal(enabled ? `已启用 ${serverId}` : `已停用 ${serverId}`, 'ok')
  } catch (e: unknown) {
    showGlobal('操作失败: ' + toErrorMessage(e), 'error')
    // 失败时刷新列表以恢复真实状态
    loadServers()
  } finally {
    toggling.delete(serverId)
  }
}

// ── 删除（防抖 + 利用返回值刷新） ──
async function deleteServer(serverId: string) {
  if (deletingId.value) return
  if (!window.confirm(`确定删除 MCP 服务器 "${serverId}" 吗？`)) return
  deletingId.value = serverId
  try {
    const res = await api.deleteMcpServer(serverId)
    // 优先利用后端返回的列表刷新（确保 tool_count 等同步）
    if (res?.servers) {
      servers.value = res.servers as MCPServerConfig[]
    } else {
      servers.value = servers.value.filter((s) => s.server_id !== serverId)
    }
    showGlobal(`已删除 ${serverId}`, 'ok')
  } catch (e: unknown) {
    showGlobal('删除失败: ' + toErrorMessage(e), 'error')
  } finally {
    deletingId.value = ''
  }
}

onMounted(() => { loadServers(); loadDiscovered() })
</script>

<style scoped>
.mcp-view {
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

.loading, .empty {
  color: var(--text-secondary);
  padding: 40px 0;
  text-align: center;
}
.empty-hint {
  font-size: 13px;
  margin-top: 8px;
  opacity: 0.7;
}

/* ── 增强空状态引导 ── */
.enhanced-empty {
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;
}

.empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  max-width: 480px;
}

.empty-hero-icon {
  width: 64px;
  height: 64px;
  color: var(--accent);
  opacity: 0.7;
}

.empty-hero-text h3 {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.empty-hero-text p {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-secondary);
  margin: 0;
}

.guide-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  max-width: 720px;
  width: 100%;
}

.guide-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  transition: transform var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}
@media (prefers-reduced-motion: no-preference) {
  .guide-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
}

.guide-card-icon {
  width: 40px;
  height: 40px;
  color: var(--accent);
  opacity: 0.8;
  flex-shrink: 0;
}

.guide-card h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.guide-card p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  margin: 0;
}

	.empty-actions {
	  display: flex;
	  gap: 12px;
	  align-items: center;
	}

	/* ── 分角色引导 ── */
	.role-guidance {
	  display: flex;
	  gap: 16px;
	  max-width: 720px;
	  width: 100%;
	}
	.role-card {
	  flex: 1;
	  display: flex;
	  align-items: center;
	  gap: 10px;
	  padding: 12px 16px;
	  border-radius: var(--radius-lg);
	  border: 1px solid var(--border);
	  background: var(--bg-card);
	  font-size: 13px;
	  line-height: 1.5;
	  color: var(--text-secondary);
	}
	.role-badge {
	  flex-shrink: 0;
	  font-size: 11px;
	  font-weight: 600;
	  padding: 2px 10px;
	  border-radius: 100px;
	  background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
	  color: var(--accent);
	  letter-spacing: 0.3px;
	}
	.role-card:last-child .role-badge {
	  background: color-mix(in srgb, var(--status-ok) 10%, var(--bg-card));
	  color: var(--status-ok);
	}

/* ── 帮助图标 ── */
.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--text-tertiary);
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  cursor: help;
  margin-left: 4px;
  transition: border-color var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out),
              background var(--duration-fast) var(--ease-out);
  user-select: none;
  vertical-align: middle;
  position: relative;
  top: -1px;
}
.help-icon:hover,
.help-icon:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
  outline: none;
}

/* ── 卡片网格 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
@media (max-width: 640px) {
  .card-grid { grid-template-columns: 1fr; }
}

.mcp-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-16);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
@media (prefers-reduced-motion: no-preference) {
  .mcp-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-md);
  }
}
/* 启用状态左侧高亮条 */
.mcp-card:has(.toggle-btn.active) {
  border-left: 3px solid var(--status-ok);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-header::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-ok);
  flex-shrink: 0;
  margin-right: 8px;
}
.mcp-card:not(:has(.toggle-btn.active)) .card-header::before {
  background: var(--text-tertiary);
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-label {
  font-weight: 600;
  font-size: 15px;
}

.transport-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.transport-badge.stdio { background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card)); color: var(--status-ok); }
.transport-badge.sse { background: color-mix(in srgb, var(--accent) 12%, var(--bg-card)); color: var(--accent); }
.transport-badge.streamable_http { background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card)); color: var(--status-warn); }
.transport-badge.websocket { background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card)); color: var(--status-error); }

.toggle-btn {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: var(--border);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.toggle-btn::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg-primary);
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}
.toggle-btn.active {
  background: var(--accent);
}
.toggle-btn.active::after {
  transform: translateX(18px);
}

.card-desc {
  font-size: 14px;
  color: var(--text-secondary);
}

.card-connection {
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-connection .mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  color: var(--text-secondary);
}
.card-connection .args {
  opacity: 0.7;
}
.card-connection .url {
  word-break: break-all;
}

.card-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.tool-count {
  color: var(--text-secondary);
}
.disabled-tag {
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}
.action-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}
.action-btn:hover {
  border-color: var(--accent);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.danger {
  color: var(--status-error);
}
.action-btn.danger:hover {
  border-color: var(--status-error);
}

/* ── 表单 ── */
.wizard-form {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-hint {
  font-size: 13px;
  color: var(--text-tertiary);
}
/* Novice 引导：信息型提示，区别于普通说明文字 */
.form-hint--info {
  padding: 8px 10px;
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--text-secondary);
  border-radius: 4px;
  line-height: 1.5;
}
.form-hint--info code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  padding: 1px 4px;
  background: var(--bg-secondary);
  border-radius: 3px;
  color: var(--text-primary);
}

.input {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.input:focus {
  border-color: var(--accent);
}
.input.mono {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
}
.input:disabled {
  opacity: 0.6;
}

select.input {
  cursor: pointer;
}

/* ── KV 列表（args / env / headers） ── */
.kv-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kv-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.kv-row .input {
  flex: 1;
}
.kv-remove {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}
.kv-remove:hover {
  border-color: var(--status-error);
  color: var(--status-error);
}
.kv-add {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  align-self: flex-start;
}
.kv-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── 表单操作 ── */
.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.save-msg {
  font-size: 13px;
}
.save-msg.ok { color: var(--status-ok); }
.save-msg.error { color: var(--status-error); }

/* ── 全局提示 ── */
.global-message {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}
.global-message.ok {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
  color: var(--status-ok);
}
.global-message.error {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
  color: var(--status-error);
}

/* ── 阶段 4.1：chips 输入（allowlist / blocklist） ── */
.chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  min-height: 38px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
  color: var(--accent);
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
.chip.chip-danger {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
  color: var(--status-error);
}
.chip-remove {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  line-height: 1;
}
.chip-input {
  flex: 1;
  min-width: 200px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  padding: 4px;
}
.tool-pick {
  display: inline-block;
  margin: 2px 4px 2px 0;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  cursor: pointer;
  border: 1px solid var(--border);
}
.tool-pick:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.tool-pick-danger:hover {
  border-color: var(--status-error);
  color: var(--status-error);
}

/* ── OMP 自动发现区 ── */
.retry-row {
  margin-top: 12px;
}

.omp-section {
  margin-top: 24px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.server-card {
  opacity: 0.85;
}

.auto-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 100px;
  background: var(--border);
  color: var(--text-tertiary);
  margin-left: 8px;
}

.tool-tag {
  font-size: 12px;
  padding: 2px 8px;
	  border-radius: 4px;
	  background: var(--bg-secondary);
	  color: var(--text-secondary);
	}

/* ── 响应式 ── */
@media (max-width: 640px) {
  .guide-cards {
    grid-template-columns: 1fr;
  }
  .empty-actions {
    flex-direction: column;
  }
}

/* ── 模板快速入口（空状态） ── */
.preset-templates {
  max-width: 720px;
  width: 100%;
  margin-top: 8px;
}
.preset-templates-title {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
  text-align: center;
}
.preset-template-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.preset-template-btn {
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.preset-template-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

/* ── 表单顶部模板入口 ── */
.form-templates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
}
.form-templates-label {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 600;
  margin-right: 4px;
}
.form-template-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.form-template-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
</style>
