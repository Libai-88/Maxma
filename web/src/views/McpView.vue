<template>
  <div class="mcp-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>MCP 服务</h2>
      <button v-if="mode === 'list'" class="btn primary" @click="startAdd">+ 添加 MCP 服务器</button>
      <button v-else class="btn" @click="cancelForm">← 返回列表</button>
    </div>

    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="loadError" class="empty">
        加载失败: {{ loadError }}
        <div class="retry-row">
          <button class="btn primary" @click="loadServers">重试</button>
        </div>
      </div>
      <div v-else-if="servers.length === 0" class="empty">
        尚未配置任何 MCP 服务器。点击上方按钮添加。
        <div class="empty-hint">MCP（Model Context Protocol）让 Maxma 能调用外部工具和服务。</div>
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
        <div class="form-hint">唯一标识符，用作工具名前缀（如 github_search）</div>
      </div>

      <div class="form-section">
        <label class="form-label">传输方式</label>
        <select v-model="form.transport" class="input" :disabled="isEditing" required>
          <option value="stdio">stdio（本地子进程）</option>
          <option value="sse">SSE（服务器推送事件）</option>
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
          <label class="form-label">命令</label>
          <input v-model="form.command" class="input mono" placeholder="例如: npx, python, node" required />
          <div class="form-hint">
            推荐命令：npx / node / python / uvx / go / cargo / docker / git / bash 等。
            其他命令需自行确保安全（不可包含路径分隔符）。
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">参数</label>
          <div class="kv-list">
            <div v-for="(_arg, i) in form.args" :key="i" class="kv-row">
              <input v-model="form.args[i]" class="input mono" placeholder="参数" />
              <button type="button" class="kv-remove" @click="form.args.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="kv-add" @click="form.args.push('')">+ 添加参数</button>
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
            仅允许 host 白名单（localhost / 127.0.0.1 / 0.0.0.0 / ::1）。
            SSE/HTTP 用 http/https，WebSocket 用 ws/wss。
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
        <label class="form-label">允许的工具（allowlist，可选）</label>
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
          留空 = 允许全部。配置后仅允许的工具可用。支持通配符（* 匹配任意字符）。
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
      </div>

      <div class="form-section">
        <label class="form-label">屏蔽的工具（blocklist，可选）</label>
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
          blocklist 优先于 allowlist。被屏蔽的工具不会出现在 LLM 可见工具列表中。
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
          class="btn"
          :disabled="testing || saving"
          @click="handleTestConnection"
        >
          {{ testing ? '测试中...' : '测试连接' }}
        </button>
        <button type="submit" class="btn primary" :disabled="saving || testing">
          {{ saving ? '保存中...' : (isEditing ? '保存修改' : '创建服务器') }}
        </button>
        <span v-if="saveMessage" class="save-msg" :class="saveMessageClass">{{ saveMessage }}</span>
      </div>
    </form>

    <!-- ── 全局提示 ── -->
    <div v-if="globalMessage" class="global-message" :class="globalMessageClass">
      {{ globalMessage }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import type { MCPServerConfig, MCPServerCreateBody, MCPTransport } from '@/types'

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

// ── OMP 自动发现 ──
// OMP 自动发现接口返回结构无后端契约约束，本地用最小形状描述用于渲染。
interface DiscoveredServer {
  id: string
  name: string
  status: string
  tools?: string[]
}
const discoveredServers = ref<DiscoveredServer[]>([])

async function loadDiscovered() {
  try {
    const res = await fetch('/api/mcp/discovered')
    const data = await res.json() as unknown
    discoveredServers.value = Array.isArray(data) ? (data as DiscoveredServer[]) : []
  } catch { discoveredServers.value = [] }
}

// ── toggle 防抖 ──
const toggling = reactive<Set<string>>(new Set())

// ── 阶段 4.1：可用工具列表 ──
const availableTools = ref<string[]>([])
const newAllowedTool = ref('')
const newBlockedTool = ref('')

// ── 竞态保护：编辑请求序列号 ──
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

// ── 列表加载 ──
async function loadServers() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await api.listMcpServers()
    // 后端实际返回带 stdio/URL 等扩展字段，这里做一次显式类型断言。
    servers.value = (res.servers || []) as MCPServerConfig[]
  } catch (e: unknown) {
    loadError.value = toErrorMessage(e)
  } finally {
    loading.value = false
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
    // body 既用于 create 也用于 update；MCPServerCreateBody 是 MCPServerUpdateBody 的结构超集，
    // 因此可以同时传给 api.createMcpServer 和 api.updateMcpServer（结构兼容）。
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

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

/* ── 卡片网格 ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.mcp-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.transport-badge.stdio { background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card)); color: var(--status-ok); }
.transport-badge.sse { background: #e3f2fd; color: #1565c0; }
.transport-badge.streamable_http { background: #fff3e0; color: #e65100; }
.transport-badge.websocket { background: #f3e5f5; color: #7b1fa2; }

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
  font-size: 13px;
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
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 12px;
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-hint {
  font-size: 12px;
  color: var(--text-tertiary);
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
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
  color: var(--status-ok);
}
.global-message.error {
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
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
  color: var(--accent);
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
.chip.chip-danger {
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
  font-size: 11px;
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
  font-size: 11px;
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
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 100px;
  background: var(--border);
  color: var(--text-tertiary);
  margin-left: 8px;
}

.tool-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}
</style>
