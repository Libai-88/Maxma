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
              :title="s.enabled ? '已启用' : '已停用'"
              @click="toggleServer(s.server_id, !s.enabled)"
            ></button>
          </div>

          <!-- 描述 -->
          <div v-if="s.description" class="card-desc">{{ s.description }}</div>

          <!-- 连接信息 -->
          <div class="card-connection">
            <template v-if="s.transport === 'stdio'">
              <span class="mono">{{ (s as any).command || '-' }}</span>
              <span v-if="(s as any).args?.length" class="mono args">{{ (s as any).args.join(' ') }}</span>
            </template>
            <template v-else>
              <span class="mono url">{{ (s as any).url || '-' }}</span>
            </template>
          </div>

          <!-- 工具数量 -->
          <div class="card-tools">
            <span class="tool-count">{{ s.tool_count }} 个工具</span>
            <span v-if="!s.enabled" class="disabled-tag">已停用</span>
          </div>

          <!-- 操作按钮 -->
          <div class="card-actions">
            <button class="action-btn" @click="startEdit(s)">编辑</button>
            <button class="action-btn danger" @click="deleteServer(s.server_id)">删除</button>
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
        </div>

        <div class="form-section">
          <label class="form-label">参数</label>
          <div class="kv-list">
            <div v-for="(arg, i) in form.args" :key="i" class="kv-row">
              <input v-model="form.args[i]" class="input mono" placeholder="参数" />
              <button type="button" class="kv-remove" @click="form.args.splice(i, 1)">✕</button>
            </div>
            <button type="button" class="kv-add" @click="form.args.push('')">+ 添加参数</button>
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">环境变量</label>
          <div class="kv-list">
            <div v-for="(val, key) in form.env" :key="key" class="kv-row">
              <input :value="key" class="input mono" placeholder="KEY" @input="renameEnvKey(key, ($event.target as HTMLInputElement).value)" />
              <input v-model="form.env[key]" class="input mono" placeholder="VALUE" />
              <button type="button" class="kv-remove" @click="delete form.env[key]">✕</button>
            </div>
            <button type="button" class="kv-add" @click="addEnvVar()">+ 添加环境变量</button>
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
        </div>

        <div class="form-section">
          <label class="form-label">请求头</label>
          <div class="kv-list">
            <div v-for="(val, key) in form.headers" :key="key" class="kv-row">
              <input :value="key" class="input mono" placeholder="Header-Name" @input="renameHeaderKey(key, ($event.target as HTMLInputElement).value)" />
              <input v-model="form.headers[key]" class="input mono" placeholder="Value" />
              <button type="button" class="kv-remove" @click="delete form.headers[key]">✕</button>
            </div>
            <button type="button" class="kv-add" @click="addHeader()">+ 添加请求头</button>
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

      <!-- 保存按钮 -->
      <div class="form-actions">
        <button type="submit" class="btn primary" :disabled="saving">
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
import { ref, reactive, computed, onMounted } from 'vue'
import { api } from '@/api'
import type { MCPServerInfo, MCPServerConfig, MCPTransport } from '@/types'

type Mode = 'list' | 'add' | 'edit'

const loading = ref(true)
const servers = ref<MCPServerInfo[]>([])
const mode = ref<Mode>('list')
const saving = ref(false)
const saveMessage = ref('')
const saveMessageClass = ref('')
const globalMessage = ref('')
const globalMessageClass = ref('')

const editingId = ref('')

const emptyForm = () => ({
  server_id: '',
  transport: 'stdio' as MCPTransport,
  enabled: true,
  description: '',
  command: '',
  args: [] as string[],
  env: {} as Record<string, string>,
  cwd: '',
  url: '',
  headers: {} as Record<string, string>,
  timeout: undefined as number | undefined,
  sse_read_timeout: undefined as number | undefined,
})

const form = reactive(emptyForm())

const isEditing = computed(() => mode.value === 'edit')

function transportLabel(t: string): string {
  const map: Record<string, string> = {
    stdio: 'stdio',
    sse: 'SSE',
    streamable_http: 'HTTP',
    websocket: 'WS',
  }
  return map[t] || t
}

async function loadServers() {
  loading.value = true
  globalMessage.value = ''
  try {
    const res = await api.listMcpServers()
    servers.value = res.servers
  } catch (e: any) {
    globalMessage.value = '加载失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
  } finally {
    loading.value = false
  }
}

function startAdd() {
  Object.assign(form, emptyForm())
  mode.value = 'add'
  saveMessage.value = ''
}

async function startEdit(server: MCPServerInfo) {
  mode.value = 'edit'
  editingId.value = server.server_id
  saveMessage.value = ''
  try {
    const full = await api.getMcpServer(server.server_id)
    Object.assign(form, {
      server_id: full.server_id,
      transport: full.transport,
      enabled: full.enabled,
      description: full.description || '',
      command: (full as any).command || '',
      args: (full as any).args || [],
      env: (full as any).env || {},
      cwd: (full as any).cwd || '',
      url: (full as any).url || '',
      headers: (full as any).headers || {},
      timeout: (full as any).timeout,
      sse_read_timeout: (full as any).sse_read_timeout,
    })
  } catch (e: any) {
    globalMessage.value = '加载服务器详情失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
    mode.value = 'list'
  }
}

function cancelForm() {
  mode.value = 'list'
  saveMessage.value = ''
}

function addEnvVar() {
  const key = prompt('环境变量名 (KEY):')
  if (key && !(key in form.env)) {
    form.env[key] = ''
  }
}

function addHeader() {
  const key = prompt('请求头名称 (例如 Authorization):')
  if (key && !(key in form.headers)) {
    form.headers[key] = ''
  }
}

function renameEnvKey(oldKey: string, newKey: string) {
  if (newKey && newKey !== oldKey && !(newKey in form.env)) {
    form.env[newKey] = form.env[oldKey]
    delete form.env[oldKey]
  }
}

function renameHeaderKey(oldKey: string, newKey: string) {
  if (newKey && newKey !== oldKey && !(newKey in form.headers)) {
    form.headers[newKey] = form.headers[oldKey]
    delete form.headers[oldKey]
  }
}

async function handleSave() {
  saving.value = true
  saveMessage.value = ''
  saveMessageClass.value = ''
  try {
    const body: any = {
      server_id: form.server_id,
      transport: form.transport,
      enabled: form.enabled,
      description: form.description,
    }
    // 根据 transport 添加对应字段
    if (form.transport === 'stdio') {
      body.command = form.command
      if (form.args.length) body.args = form.args
      if (Object.keys(form.env).length) body.env = form.env
      if (form.cwd) body.cwd = form.cwd
    } else {
      body.url = form.url
      if (Object.keys(form.headers).length) body.headers = form.headers
      if (form.timeout != null) body.timeout = form.timeout
      if (form.transport === 'sse' && form.sse_read_timeout != null) {
        body.sse_read_timeout = form.sse_read_timeout
      }
    }

    if (mode.value === 'add') {
      await api.createMcpServer(body)
      saveMessage.value = '创建成功'
      saveMessageClass.value = 'ok'
    } else {
      await api.updateMcpServer(editingId.value, body)
      saveMessage.value = '保存成功'
      saveMessageClass.value = 'ok'
    }
    setTimeout(() => {
      mode.value = 'list'
      loadServers()
    }, 800)
  } catch (e: any) {
    saveMessage.value = '失败: ' + (e?.message || String(e))
    saveMessageClass.value = 'error'
  } finally {
    saving.value = false
  }
}

async function toggleServer(serverId: string, enabled: boolean) {
  try {
    await api.updateMcpServer(serverId, { enabled })
    const s = servers.value.find(x => x.server_id === serverId)
    if (s) s.enabled = enabled
    globalMessage.value = enabled ? `已启用 ${serverId}` : `已停用 ${serverId}`
    globalMessageClass.value = 'ok'
    setTimeout(() => { globalMessage.value = '' }, 2000)
  } catch (e: any) {
    globalMessage.value = '操作失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
  }
}

async function deleteServer(serverId: string) {
  if (!confirm(`确定删除 MCP 服务器 "${serverId}" 吗？`)) return
  try {
    await api.deleteMcpServer(serverId)
    servers.value = servers.value.filter(s => s.server_id !== serverId)
    globalMessage.value = `已删除 ${serverId}`
    globalMessageClass.value = 'ok'
    setTimeout(() => { globalMessage.value = '' }, 2000)
  } catch (e: any) {
    globalMessage.value = '删除失败: ' + (e?.message || String(e))
    globalMessageClass.value = 'error'
  }
}

onMounted(loadServers)
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
  color: #fff;
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
.transport-badge.stdio { background: #e8f5e9; color: #2e7d32; }
.transport-badge.sse { background: #e3f2fd; color: #1565c0; }
.transport-badge.streamable_http { background: #fff3e0; color: #e65100; }
.transport-badge.websocket { background: #f3e5f5; color: #7b1fa2; }

.toggle-btn {
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: #ccc;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.toggle-btn::after {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
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
  background: #f5f5f5;
  color: #999;
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
.action-btn.danger {
  color: #d32f2f;
}
.action-btn.danger:hover {
  border-color: #d32f2f;
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
  border-color: #d32f2f;
  color: #d32f2f;
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
.save-msg.error { color: #d32f2f; }

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
  background: #e8f5e9;
  color: #2e7d32;
}
.global-message.error {
  background: #ffebee;
  color: #d32f2f;
}
</style>
