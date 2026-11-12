import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Puzzle, AlertTriangle, Server, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/api'
import type { MCPServerConfig, MCPServerCreateBody, MCPTransport, DiscoveredServer } from '@/types'
import { McpMarket } from '@/components/mcp/McpMarket'

/** 扩展管理：MCP 服务器 CRUD 与已加载 Skills。 */

const VALID_TABS = ['tools', 'skills', 'mcp'] as const
type ExtensionTab = (typeof VALID_TABS)[number]
const MARKET_PAGE_SIZE = 12

interface ToolInfo {
  name: string
  label?: string
  description?: string
  category?: string
  builtin?: boolean
  source?: string
}

interface McpServerInfo {
  id?: string
  name?: string
  status?: string
  tool_count?: number
}

interface CapabilitiesData {
  tools?: ToolInfo[]
  mcp_servers?: McpServerInfo[]
  system?: { sidecar_available?: boolean; session_count?: number }
}

interface MarketSkill {
  slug: string
  name?: string
  description?: string
  description_zh?: string
  source?: string
  ownerName?: string
  downloads?: number
  stars?: number
}

interface DiscoveredSkill {
  name: string
  description: string
  source: string
  base_dir?: string
  file_path?: string
}

// ── 表单结构：把数组/对象字段都以「每行一条」的文本表示，保存时再解析 ──
interface McpForm {
  server_id: string
  transport: MCPTransport
  enabled: boolean
  description: string
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
  timeout: string
  tls_verify: boolean
  allowed_tools: string
  blocked_tools: string
}

function emptyForm(): McpForm {
  return {
    server_id: '',
    transport: 'stdio',
    enabled: true,
    description: '',
    command: '',
    args: '',
    env: '',
    cwd: '',
    url: '',
    headers: '',
    timeout: '',
    tls_verify: true,
    allowed_tools: '',
    blocked_tools: '',
  }
}

function linesToArray(lines: string): string[] {
  return lines
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function linesToObj(lines: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of lines.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) {
      const key = line.slice(0, i).trim()
      if (key) out[key] = line.slice(i + 1).trim()
    }
  }
  return out
}

function objToLines(obj?: Record<string, string>): string {
  if (!obj) return ''
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

export default function ExtensionView() {
  const location = useLocation()
  const navigate = useNavigate()

  const tabParam = new URLSearchParams(location.search).get('tab')
  const activeTab: ExtensionTab = VALID_TABS.includes(tabParam as ExtensionTab)
    ? (tabParam as ExtensionTab)
    : 'tools'

  function setTab(tab: ExtensionTab) {
    navigate(
      { pathname: location.pathname, search: tab === 'tools' ? '' : `?tab=${tab}` },
      { replace: true },
    )
  }

  // ── 通用加载 / 错误 ──
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ── 工具 / Skills / MCP 概览数据 ──
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([])
  const [skills, setSkills] = useState<DiscoveredSkill[]>([])
  const [systemStatus, setSystemStatus] = useState<{ sidecar_available: boolean }>({ sidecar_available: false })

  // ── 技能市场 ──
  const [skillQuery, setSkillQuery] = useState('')
  const [marketPage, setMarketPage] = useState(1)
  const [marketTotal, setMarketTotal] = useState(0)
  const [marketSkills, setMarketSkills] = useState<MarketSkill[]>([])
  const [skillMarketLoading, setSkillMarketLoading] = useState(false)
  const [skillMarketError, setSkillMarketError] = useState('')
  const [installingSkill, setInstallingSkill] = useState('')

  const builtinTools = useMemo(() => tools.filter((t) => t.source !== 'custom'), [tools])
  const customTools = useMemo(() => tools.filter((t) => t.source === 'custom'), [tools])

  // 已安装技能名（name / base_dir 末段 / file_path 倒数第二段）——运行时构建的集合
  const installedSkillNames = useMemo(() => {
    const set = new Set<string>()
    for (const skill of skills) {
      for (const cand of [
        skill.name,
        skill.base_dir?.split(/[\\/]/).filter(Boolean).pop(),
        skill.file_path?.split(/[\\/]/).slice(-2, -1)[0],
      ]) {
        if (cand) set.add(cand)
      }
    }
    return set
  }, [skills])

  // ── 数据加载 ──
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const caps = await api.request<CapabilitiesData>('/capabilities')
      setTools(caps.tools || [])
      setMcpServers(caps.mcp_servers || [])
      setSystemStatus({ sidecar_available: caps.system?.sidecar_available ?? false })
      // SKILLS-UI-001：自动发现 Skills（sidecar 未就绪时为空，不阻塞页面）
      try {
        const discovered = await api.request<{ name: string; description: string; source: string }[]>('/skills/discovered')
        setSkills(Array.isArray(discovered) ? discovered : [])
      } catch {
        setSkills([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function searchSkillMarket() {
    setMarketPage(1)
    // marketPage 变更会在下一次渲染生效，这里直接用第 1 页请求
    setSkillMarketLoading(true)
    setSkillMarketError('')
    try {
      const query = new URLSearchParams({ page_size: String(MARKET_PAGE_SIZE), page: '1' })
      if (skillQuery.trim()) query.set('q', skillQuery.trim())
      const result = await api.request<{ skills: MarketSkill[]; total: number }>('/skills/market?' + query.toString())
      setMarketSkills(result.skills || [])
      setMarketTotal(result.total || 0)
    } catch (e) {
      setSkillMarketError(e instanceof Error ? e.message : String(e))
    } finally {
      setSkillMarketLoading(false)
    }
  }

  function changeSkillMarketPage(delta: number) {
    const next = Math.max(1, marketPage + delta)
    setMarketPage(next)
    // setMarketPage 是异步的，直接按 next 发一次请求
    setSkillMarketLoading(true)
    setSkillMarketError('')
    void (async () => {
      try {
        const query = new URLSearchParams({ page_size: String(MARKET_PAGE_SIZE), page: String(next) })
        if (skillQuery.trim()) query.set('q', skillQuery.trim())
        const result = await api.request<{ skills: MarketSkill[]; total: number }>('/skills/market?' + query.toString())
        setMarketSkills(result.skills || [])
        setMarketTotal(result.total || 0)
      } catch (e) {
        setSkillMarketError(e instanceof Error ? e.message : String(e))
      } finally {
        setSkillMarketLoading(false)
      }
    })()
  }

  async function installSkill(skill: MarketSkill) {
    if (!window.confirm(`确认安装社区技能“${skill.name || skill.slug}”？技能内容来自外部来源，请先确认其可信度。`)) return
    setInstallingSkill(skill.slug)
    try {
      await api.request('/skills/market/install', { method: 'POST', body: JSON.stringify({ slug: skill.slug }) })
      await load()
    } catch (e) {
      setSkillMarketError(e instanceof Error ? e.message : String(e))
    } finally {
      setInstallingSkill('')
    }
  }

  return (
    <div className="ds-view flex flex-1 min-h-0 flex-col overflow-y-auto">
      <div className="view-header mb-4">
        <h2 className="text-xl font-semibold text-foreground">插件与工具</h2>
        <p className="mt-1 text-sm text-muted-foreground">管理外部工具连接，查看已加载的 Skills</p>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="插件类别" className="mb-4 flex gap-2 rounded-lg border border-border bg-card p-2">
        {([
          { id: 'tools', label: '工具' },
          { id: 'skills', label: 'Skills' },
          { id: 'mcp', label: 'MCP 服务' },
        ] as { id: ExtensionTab; label: string }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={cn(
              'min-h-9 flex-1 rounded-lg text-sm text-muted-foreground transition-colors',
              activeTab === t.id && 'bg-background text-foreground shadow-sm',
            )}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* MCP 服务（独立 CRUD 子视图，内嵌） */}
      {activeTab === 'mcp' ? (
        <McpSection />
      ) : loading ? (
        <div role="status" aria-live="polite" className="py-3">
          <span className="sr-only">正在扫描插件与 Skills…</span>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, n) => (
              <div key={n} className="grid gap-2 rounded-lg border border-border bg-card p-4">
                <span className="block h-2.5 rounded-full bg-muted" />
                <span className="block h-2.5 w-[78%] rounded-full bg-muted" />
                <span className="block h-2.5 w-[46%] rounded-full bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="glass-panel flex flex-col items-center rounded-lg border border-border px-4 py-10 text-center">
          <div className="mb-3 text-destructive"><AlertTriangle className="size-7" /></div>
          <div className="mb-1 text-base font-semibold text-foreground">插件列表暂时不可用</div>
          <p className="mb-4 text-sm text-muted-foreground">
            {error.includes('操作过于频繁') ? '请求过于频繁，稍后重试即可；页面上的其它功能不受影响。' : error}
          </p>
          <Button variant="outline" onClick={() => void load()}>重试</Button>
        </div>
      ) : (
        <>
          {/* 系统状态（工具 tab） */}
          {activeTab === 'tools' && (
            <div className="glass-panel mb-6 rounded-lg border border-border p-4">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <span className={cn('size-2 rounded-full', systemStatus.sidecar_available ? 'bg-primary' : 'bg-muted-foreground')} />
                  Pi Agent {systemStatus.sidecar_available ? '运行中' : '离线'}
                </div>
                <StatItem value={tools.length} label="工具" />
                <StatItem value={mcpServers.length} label="已配置 MCP 服务" />
                <StatItem value={customTools.length} label="自定义工具" />
              </div>
            </div>
          )}

          {/* 自定义工具 */}
          {activeTab === 'tools' && customTools.length > 0 && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionHeading>自定义工具 ({customTools.length})</SectionHeading>
              <div className="flex flex-col gap-2">
                {customTools.map((t) => (
                  <ExtCard key={t.name} name={t.label || t.name} source={t.category} description={t.description} />
                ))}
              </div>
            </div>
          )}

          {/* Pi 默认工具 */}
          {activeTab === 'tools' && builtinTools.length > 0 && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionHeading>Pi 默认工具 ({builtinTools.length})</SectionHeading>
              <div className="flex flex-wrap gap-2">
                {builtinTools.map((t) => (
                  <div key={t.name} title={t.description} className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground">
                    {t.label || t.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skills tab */}
          {activeTab === 'skills' && (
            <div className="mb-6 border-b border-border pb-6">
              <SkillMarket
                skillQuery={skillQuery}
                setSkillQuery={setSkillQuery}
                skillMarketLoading={skillMarketLoading}
                skillMarketError={skillMarketError}
                marketSkills={marketSkills}
                marketTotal={marketTotal}
                marketPage={marketPage}
                marketPageSize={MARKET_PAGE_SIZE}
                installingSkill={installingSkill}
                installedSkillNames={installedSkillNames}
                onSearch={() => void searchSkillMarket()}
                onChangePage={(d) => changeSkillMarketPage(d)}
                onInstall={(s) => void installSkill(s)}
              />

              <SectionHeading>已发现的 Skills ({skills.length})</SectionHeading>
              <div className="flex flex-col gap-2">
                {skills.map((sk) => (
                  <ExtCard
                    key={sk.name}
                    name={sk.name}
                    source={sk.source}
                    sourceWarn={sk.source === 'auto'}
                    description={sk.description}
                  />
                ))}
              </div>
              {skills.length === 0 && (
                <div className="rounded-lg border border-border py-8 text-center">
                  <div className="mb-1 text-sm font-medium text-foreground">未发现 Skills</div>
                  <div className="text-sm text-muted-foreground">Pi 会从当前配置的技能目录自动加载可用技能。</div>
                </div>
              )}
            </div>
          )}

          {/* 工具 tab 空态 */}
          {activeTab === 'tools' && builtinTools.length === 0 && customTools.length === 0 && (
            <div className="glass-panel flex flex-col items-center rounded-lg border border-border px-4 py-10 text-center">
              <div className="mb-3 text-muted-foreground"><Puzzle className="size-7" /></div>
              <div className="text-base font-semibold text-foreground">暂无可用工具</div>
            </div>
          )}

          {/* 刷新 */}
          <div className="mb-6 flex">
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              {loading ? '刷新中…' : '⟳ 刷新'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function StatItem({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-base font-semibold text-foreground">{children}</h3>
}

function ExtCard({
  name,
  source,
  sourceWarn,
  description,
}: {
  name: string
  source?: string
  sourceWarn?: boolean
  description?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{name}</span>
        {source && (
          <Badge variant={sourceWarn ? 'destructive' : 'secondary'} className="text-xs">{source}</Badge>
        )}
      </div>
      {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
    </div>
  )
}

/** 可选社区技能市场。 */
function SkillMarket({
  skillQuery,
  setSkillQuery,
  skillMarketLoading,
  skillMarketError,
  marketSkills,
  marketTotal,
  marketPage,
  marketPageSize,
  installingSkill,
  installedSkillNames,
  onSearch,
  onChangePage,
  onInstall,
}: {
  skillQuery: string
  setSkillQuery: (v: string) => void
  skillMarketLoading: boolean
  skillMarketError: string
  marketSkills: MarketSkill[]
  marketTotal: number
  marketPage: number
  marketPageSize: number
  installingSkill: string
  installedSkillNames: Set<string>
  onSearch: () => void
  onChangePage: (d: number) => void
  onInstall: (s: MarketSkill) => void
}) {
  const totalPages = Math.ceil(marketTotal / marketPageSize)
  return (
    <div className="glass-panel mb-6 rounded-lg border border-border p-4">
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <strong className="text-sm text-foreground">Maxma 随包 Skills</strong>
        <span className="text-xs leading-relaxed text-muted-foreground">
          编码、调试、执行流程、研究、文档、表格和安全审计能力已内置，无需下载或额外服务。
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-foreground">可选社区技能市场</h3>
          <p className="mb-0 mt-1 text-xs text-muted-foreground">按需搜索并安装社区共享的 Agent Skills</p>
        </div>
        <a href="https://skillhub.cn" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
          打开市场 <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="my-3 flex gap-2">
        <Input
          value={skillQuery}
          placeholder="搜索中文或英文技能"
          onChange={(e) => setSkillQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch()
          }}
        />
        <Button disabled={skillMarketLoading} onClick={onSearch} className="shrink-0">
          {skillMarketLoading ? '搜索中…' : '搜索'}
        </Button>
      </div>
      {skillMarketError ? (
        <p className="text-sm text-destructive">{skillMarketError}</p>
      ) : skillMarketLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">正在搜索 SkillHub…</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
          {marketSkills.map((item) => {
            const installed = installedSkillNames.has(item.slug)
            return (
              <article key={item.slug} className="min-w-0 rounded-lg border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm text-foreground">{item.name || item.slug}</strong>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.source === 'official' ? '官方' : '社区'}</span>
                </div>
                <p className="my-2 min-h-[3.4em] text-xs leading-relaxed text-muted-foreground">
                  {item.description_zh || item.description || '暂无简介'}
                </p>
                <div className="flex gap-2.5 text-xs text-muted-foreground">
                  <span>{item.ownerName || 'SkillHub'}</span>
                  <span>↓ {Number(item.downloads || 0).toLocaleString()}</span>
                  <span>★ {Number(item.stars || 0).toLocaleString()}</span>
                </div>
                <Button
                  size="sm"
                  variant={installed ? 'secondary' : 'default'}
                  className="mt-2.5 w-full"
                  disabled={installingSkill === item.slug || installed}
                  onClick={() => onInstall(item)}
                >
                  {installed ? '已安装' : installingSkill === item.slug ? '安装中…' : '下载并安装'}
                </Button>
              </article>
            )
          })}
          {marketSkills.length === 0 && (
            <div className="col-span-full py-6 text-center text-sm text-muted-foreground">输入关键词搜索 SkillHub 中的技能。</div>
          )}
          {marketTotal > marketPageSize && (
            <div className="col-span-full flex items-center justify-center gap-3 pt-1 text-xs text-muted-foreground">
              <Button size="xs" variant="outline" disabled={marketPage <= 1 || skillMarketLoading} onClick={() => onChangePage(-1)}>
                上一页
              </Button>
              <span>第 {marketPage} 页，共 {totalPages} 页</span>
              <Button
                size="xs"
                variant="outline"
                disabled={marketPage * marketPageSize >= marketTotal || skillMarketLoading}
                onClick={() => onChangePage(1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** MCP 服务器 CRUD（等价移植自内嵌的 McpView.vue 的列表 / 表单 / 启停 / 测试 / 删除）。 */
function McpSection() {
  const [mode, setMode] = useState<'list' | 'add' | 'edit'>('list')
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([])

  const [form, setForm] = useState<McpForm>(emptyForm())
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveMessageOk, setSaveMessageOk] = useState(false)
  const [availableTools, setAvailableTools] = useState<string[]>([])
  const [globalMessage, setGlobalMessage] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [loadingDetailId, setLoadingDetailId] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResultMap, setTestResultMap] = useState<Record<string, { success: boolean; error: string | null }>>({})
  const [toggling, setToggling] = useState<string[]>([])

  const loadServers = useCallback(async () => {
    setServersLoading(true)
    setLoadError('')
    try {
      const res = await api.listMcpServers()
      setServers((res.servers || []) as MCPServerConfig[])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setServersLoading(false)
    }
  }, [])

  const loadDiscovered = useCallback(async () => {
    try {
      const data = await api.listMcpDiscovered()
      setDiscoveredServers(Array.isArray(data) ? data : [])
    } catch {
      setDiscoveredServers([])
    }
  }, [])

  useEffect(() => {
    void loadServers()
    void loadDiscovered()
  }, [loadServers, loadDiscovered])

  function showGlobal(msg: string) {
    setGlobalMessage(msg)
    window.setTimeout(() => setGlobalMessage((cur) => (cur === msg ? '' : cur)), 2500)
  }

  function startAdd() {
    setForm(emptyForm())
    setAvailableTools([])
    setSaveMessage('')
    setEditingId('')
    setMode('add')
  }

  function startAddWithExample() {
    setForm({
      ...emptyForm(),
      server_id: 'filesystem',
      transport: 'stdio',
      description: '让 AI 能够读取、写入和管理你电脑上的本地文件',
      command: 'npx',
      args: '-y\n@modelcontextprotocol/server-filesystem\n/path/to/allowed/dir',
    })
    setAvailableTools([])
    setSaveMessage('')
    setEditingId('')
    setMode('add')
  }

  function cancelForm() {
    setMode('list')
    setSaveMessage('')
    setForm(emptyForm())
    setEditingId('')
  }

  async function startEdit(server: MCPServerConfig) {
    setLoadingDetailId(server.server_id)
    setSaveMessage('')
    setAvailableTools([])
    try {
      const full = await api.getMcpServer(server.server_id)
      setForm({
        server_id: full.server_id,
        transport: full.transport,
        enabled: full.enabled,
        description: full.description || '',
        command: full.command || '',
        args: (full.args || []).join('\n'),
        env: objToLines(full.env),
        cwd: full.cwd || '',
        url: full.url || '',
        headers: objToLines(full.headers),
        timeout: full.timeout != null ? String(full.timeout) : '',
        tls_verify: full.tls_verify !== false,
        allowed_tools: (full.allowed_tools || []).join('\n'),
        blocked_tools: (full.blocked_tools || []).join('\n'),
      })
      setEditingId(server.server_id)
      setMode('edit')
      try {
        const res = await api.listMcpServerTools(server.server_id)
        setAvailableTools(res.tools || [])
      } catch {
        setAvailableTools([])
      }
    } catch (e) {
      showGlobal('加载服务器详情失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoadingDetailId('')
    }
  }

  async function handleSave() {
    if (saving) return
    if (!form.server_id.trim()) {
      setSaveMessage('请填写服务器 ID')
      setSaveMessageOk(false)
      return
    }
    if (form.transport === 'stdio' && !form.command.trim()) {
      setSaveMessage('请填写命令')
      setSaveMessageOk(false)
      return
    }
    if (form.transport !== 'stdio' && !form.url.trim()) {
      setSaveMessage('请填写 URL')
      setSaveMessageOk(false)
      return
    }

    const body: MCPServerCreateBody = {
      server_id: form.server_id.trim(),
      transport: form.transport,
      enabled: form.enabled,
      description: form.description,
    }
    if (form.transport === 'stdio') {
      body.command = form.command
      const args = linesToArray(form.args)
      if (args.length) body.args = args
      const env = linesToObj(form.env)
      if (Object.keys(env).length) body.env = env
      if (form.cwd) body.cwd = form.cwd
    } else {
      body.url = form.url
      body.tls_verify = form.tls_verify
      const headers = linesToObj(form.headers)
      if (Object.keys(headers).length) body.headers = headers
      if (form.timeout) body.timeout = Number(form.timeout)
    }
    const allowed = linesToArray(form.allowed_tools)
    if (allowed.length) body.allowed_tools = allowed
    const blocked = linesToArray(form.blocked_tools)
    if (blocked.length) body.blocked_tools = blocked

    setSaving(true)
    setSaveMessage('')
    try {
      if (mode === 'add') {
        await api.createMcpServer(body)
        setSaveMessage('创建成功')
      } else {
        await api.updateMcpServer(editingId, body)
        setSaveMessage('保存成功')
      }
      setSaveMessageOk(true)
      api.reloadMcp().catch(() => {})
      setMode('list')
      setForm(emptyForm())
      setEditingId('')
      await loadServers()
    } catch (e) {
      setSaveMessage('失败: ' + (e instanceof Error ? e.message : String(e)))
      setSaveMessageOk(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleServer(serverId: string, enabled: boolean) {
    if (toggling.includes(serverId)) return
    setToggling((prev) => [...prev, serverId])
    try {
      await api.updateMcpServer(serverId, { enabled })
      api.reloadMcp().catch(() => {})
      setServers((prev) => prev.map((s) => (s.server_id === serverId ? { ...s, enabled } : s)))
      showGlobal(enabled ? `已启用 ${serverId}` : `已停用 ${serverId}`)
    } catch (e) {
      showGlobal('操作失败: ' + (e instanceof Error ? e.message : String(e)))
      await loadServers()
    } finally {
      setToggling((prev) => prev.filter((id) => id !== serverId))
    }
  }

  async function deleteServer(serverId: string) {
    if (deletingId) return
    if (!window.confirm(`确定删除 MCP 服务器 "${serverId}" 吗？`)) return
    setDeletingId(serverId)
    try {
      const res = await api.deleteMcpServer(serverId)
      if (res?.servers) setServers(res.servers as MCPServerConfig[])
      else setServers((prev) => prev.filter((s) => s.server_id !== serverId))
      showGlobal(`已删除 ${serverId}`)
    } catch (e) {
      showGlobal('删除失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setDeletingId('')
    }
  }

  async function testServer(s: MCPServerConfig) {
    if (testingId) return
    setTestingId(s.server_id)
    setTestResultMap((prev) => ({ ...prev, [s.server_id]: { success: false, error: '测试中…' } }))
    try {
      const body = s.transport === 'stdio'
        ? { command: s.command ?? '', args: s.args ?? [], env: s.env ?? {}, transport: 'stdio' }
        : { command: '', args: [], env: {}, transport: s.transport, url: s.url ?? '' }
      const res = await api.testMcpConnection(body)
      setTestResultMap((prev) => ({ ...prev, [s.server_id]: { success: res.success, error: res.error ?? null } }))
    } catch (e) {
      setTestResultMap((prev) => ({ ...prev, [s.server_id]: { success: false, error: e instanceof Error ? e.message : String(e) } }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">MCP 服务</h2>
        {mode === 'list' ? (
          <Button onClick={startAdd}>+ 添加 MCP 服务器</Button>
        ) : (
          <Button variant="outline" onClick={cancelForm}>← 返回列表</Button>
        )}
      </div>

      {globalMessage && (
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">{globalMessage}</div>
      )}

      {mode === 'list' ? (
        serversLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
        ) : loadError ? (
          <div className="rounded-lg border border-destructive/40 px-3.5 py-2.5 text-sm text-destructive">
            加载失败: {loadError}
            <div className="mt-2"><Button size="sm" onClick={() => void loadServers()}>重试</Button></div>
          </div>
        ) : (
          <>
            <McpMarket onInstalled={() => { void loadServers(); void loadDiscovered() }} />

            {servers.length === 0 ? (
              <McpEmptyState onAdd={startAdd} onExample={startAddWithExample} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                {servers.map((s) => (
                  <div key={s.server_id} className="glass-panel flex flex-col gap-2 rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{s.server_id}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="secondary" className="text-xs">{s.transport === 'streamable_http' ? 'HTTP' : s.transport === 'stdio' ? 'stdio' : s.transport}</Badge>
                        <button
                          type="button"
                          title={s.enabled ? '已启用' : '已停用'}
                          className={cn('size-4 rounded-full border', s.enabled ? 'border-primary bg-primary' : 'border-border bg-muted')}
                          disabled={toggling.includes(s.server_id)}
                          onClick={() => void toggleServer(s.server_id, !s.enabled)}
                        />
                      </div>
                    </div>
                    {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                    <div className="font-mono text-xs text-muted-foreground">
                      {s.transport === 'stdio' ? (s.command || '-') : (s.url || '-')}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{s.tool_count} 个工具</span>
                      {!s.enabled && <Badge variant="outline" className="text-xs">已停用</Badge>}
                    </div>
                    {testResultMap[s.server_id] && (
                      <div className={cn('text-xs', testResultMap[s.server_id].success ? 'text-primary' : 'text-destructive')}>
                        {testResultMap[s.server_id].success ? '✓ 连接正常' : `✗ ${testResultMap[s.server_id].error}`}
                      </div>
                    )}
                    <div className="mt-1 flex gap-2">
                      <Button size="xs" variant="outline" disabled={testingId !== null} onClick={() => void testServer(s)}>
                        {testingId === s.server_id ? '测试中...' : '测试连接'}
                      </Button>
                      <Button size="xs" variant="outline" disabled={loadingDetailId === s.server_id} onClick={() => void startEdit(s)}>
                        {loadingDetailId === s.server_id ? '加载...' : '编辑'}
                      </Button>
                      <Button size="xs" variant="destructive" disabled={deletingId === s.server_id} onClick={() => void deleteServer(s.server_id)}>
                        {deletingId === s.server_id ? '删除中...' : '删除'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* OMP 自动发现 */}
            {discoveredServers.length > 0 && (
              <div className="glass-panel rounded-lg border border-border p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">OMP 自动发现</div>
                <div className="flex flex-col gap-2">
                  {discoveredServers.map((s) => (
                    <div key={s.id} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{s.name}</span>
                        <Badge variant={s.status === 'connected' ? 'secondary' : 'destructive'} className="text-xs">{s.status}</Badge>
                        <Badge variant="outline" className="text-xs">自动</Badge>
                      </div>
                      {s.tools && s.tools.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {s.tools.map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      ) : (
        <McpFormView
          form={form}
          setForm={setForm}
          editing={mode === 'edit'}
          availableTools={availableTools}
          saving={saving}
          saveMessage={saveMessage}
          saveMessageOk={saveMessageOk}
          onSave={() => void handleSave()}
          onCancel={cancelForm}
        />
      )}
    </div>
  )
}

function McpEmptyState({ onAdd, onExample }: { onAdd: () => void; onExample: () => void }) {
  return (
    <div className="glass-panel flex flex-col items-center gap-4 rounded-lg border border-border px-6 py-10 text-center">
      <Server className="size-10 text-muted-foreground" />
      <div>
        <h3 className="text-base font-semibold text-foreground">开始使用 MCP 服务器</h3>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          MCP 是一种让 Maxma 与外部工具和服务安全连接的通用方式。通过添加 MCP 服务器，你的 AI 就能读取文件、查询信息、运行命令，能力大幅扩展。
        </p>
      </div>
      <div className="grid w-full grid-cols-3 gap-3 max-md:grid-cols-1">
        <GuideCard title="什么是 MCP？" text={'MCP 相当于 AI 与各种工具之间的"翻译官"。有了 MCP 服务器，Maxma 就能跟你的文件、数据库、网页等各种工具和服务"对话"，就像跟人交流一样自然。'} />
        <GuideCard title="常见用途" text="例如：读写和搜索本地文件、运行代码查看结果、获取网页内容、查询数据、管理代码版本、处理图片等。只要有命令行接口的工具或服务，都可以变成 MCP 服务器为 AI 所用。" />
        <GuideCard title="快速开始" text="1. 点击下方按钮添加服务器 2. 给服务器取个名字、选好连接方式 3. 填好必要信息，保存后即可启用" />
      </div>
      <div className="flex gap-2">
        <Button onClick={onAdd}>+ 添加 MCP 服务器</Button>
        <Button variant="outline" onClick={onExample}>添加示例服务器</Button>
      </div>
    </div>
  )
}

function GuideCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-left">
      <h4 className="mb-1 text-sm font-semibold text-foreground">{title}</h4>
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}

function McpFormView({
  form,
  setForm,
  editing,
  availableTools,
  saving,
  saveMessage,
  saveMessageOk,
  onSave,
  onCancel,
}: {
  form: McpForm
  setForm: (f: McpForm) => void
  editing: boolean
  availableTools: string[]
  saving: boolean
  saveMessage: string
  saveMessageOk: boolean
  onSave: () => void
  onCancel: () => void
}) {
  function patch(p: Partial<McpForm>) {
    setForm({ ...form, ...p })
  }
  const fieldClass = 'h-9 w-full rounded-lg border border-input bg-transparent px-3.5 text-sm text-foreground outline-none focus-visible:border-ring'
  return (
    <div className="glass-panel flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <FormField label="服务器 ID" hint="唯一标识，创建后不可改">
          <Input value={form.server_id} disabled={editing} onChange={(e) => patch({ server_id: e.target.value })} />
        </FormField>
        <FormField label="连接方式">
          <select className={fieldClass} value={form.transport} onChange={(e) => patch({ transport: e.target.value as MCPTransport })}>
            <option value="stdio">stdio（本机启动程序）</option>
            <option value="streamable_http">Streamable HTTP（远程 HTTP）</option>
          </select>
        </FormField>
        <FormField label="描述">
          <Input value={form.description} onChange={(e) => patch({ description: e.target.value })} />
        </FormField>
        <FormField label="启用">
          <label className="flex h-9 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="size-4" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
            保存后启用
          </label>
        </FormField>

        {form.transport === 'stdio' ? (
          <>
            <FormField label="命令" hint="npx / python / node / docker 等（仅 stdio）">
              <Input value={form.command} onChange={(e) => patch({ command: e.target.value })} />
            </FormField>
            <FormField label="工作目录 cwd（可选）">
              <Input value={form.cwd} onChange={(e) => patch({ cwd: e.target.value })} />
            </FormField>
            <FormField label="参数（每行一个）">
              <textarea className={cn(fieldClass, 'h-20 py-1.5')} value={form.args} onChange={(e) => patch({ args: e.target.value })} />
            </FormField>
            <FormField label="环境变量（每行 KEY=VALUE）">
              <textarea className={cn(fieldClass, 'h-20 py-1.5')} value={form.env} onChange={(e) => patch({ env: e.target.value })} />
            </FormField>
          </>
        ) : (
          <>
            <FormField label="URL">
              <Input value={form.url} onChange={(e) => patch({ url: e.target.value })} />
            </FormField>
            <FormField label="超时（毫秒，可选）">
              <Input type="number" value={form.timeout} onChange={(e) => patch({ timeout: e.target.value })} />
            </FormField>
            <FormField label="请求头（每行 KEY=VALUE）">
              <textarea className={cn(fieldClass, 'h-20 py-1.5')} value={form.headers} onChange={(e) => patch({ headers: e.target.value })} />
            </FormField>
            <FormField label="TLS 校验">
              <label className="flex h-9 items-center gap-2 text-sm text-foreground">
                <input type="checkbox" className="size-4" checked={form.tls_verify} onChange={(e) => patch({ tls_verify: e.target.checked })} />
                校验服务端证书
              </label>
            </FormField>
          </>
        )}

        <FormField label="允许列表（每行一个，留空=全部开放）">
          <textarea className={cn(fieldClass, 'h-20 py-1.5')} value={form.allowed_tools} onChange={(e) => patch({ allowed_tools: e.target.value })} />
        </FormField>
        <FormField label="屏蔽列表（每行一个，优先级高于允许列表）">
          <textarea className={cn(fieldClass, 'h-20 py-1.5')} value={form.blocked_tools} onChange={(e) => patch({ blocked_tools: e.target.value })} />
        </FormField>
      </div>

      {availableTools.length > 0 && (
        <div className="text-xs text-muted-foreground">
          该服务器已加载的工具：{availableTools.join('、')}
        </div>
      )}

      {saveMessage && (
        <div className={cn('text-sm', saveMessageOk ? 'text-primary' : 'text-destructive')}>{saveMessage}</div>
      )}

      <div className="flex gap-2">
        <Button disabled={saving} onClick={onSave}>{saving ? '保存中…' : editing ? '保存配置' : '创建服务器'}</Button>
        <Button variant="outline" onClick={onCancel}>返回列表</Button>
      </div>
    </div>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
