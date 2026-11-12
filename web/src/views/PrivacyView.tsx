import { useEffect, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/common/ConfirmDialog'
import type { AuditLogRecord, AuditLogStats } from '@/types'
import { useSessionStore } from '@/stores/session'
import { useChatStore } from '@/stores/chat'
import { createLogger } from '@/utils/logger'

const log = createLogger('PrivacyView')

interface StorageItem {
  icon: string
  label: string
  path: string
}

const storageItems: StorageItem[] = [
  { icon: '🧠', label: '长期记忆', path: 'config/personas/memory.yaml' },
  { icon: '💬', label: '对话历史', path: 'api/data/const-sessions/' },
  { icon: '🔑', label: '提供商配置', path: 'api/data/providers.yaml' },
  { icon: '🔧', label: 'MCP 配置', path: 'api/data/mcp_servers.yaml' },
  { icon: '📋', label: '环境变量', path: '.env' },
  { icon: '🛡️', label: '拒止锚配置', path: 'api/data/maxma_blocker.yaml' },
  { icon: '📝', label: '审计日志', path: 'logs/audit.jsonl' },
  { icon: '📊', label: '上传文件', path: 'uploads/' },
]

const emptyStats: AuditLogStats = { total: 0, by_type: {}, by_status: {}, top_targets: [] }

function isOmpDisabledError(msg: string): boolean {
  return /404/.test(msg) && /OMP replaces/i.test(msg)
}

function formatTime(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Section({ title, desc, children }: { title: string; desc: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-base font-semibold text-foreground">{title}</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {children}
    </section>
  )
}

export default function PrivacyView() {
  const [auditStats, setAuditStats] = useState<AuditLogStats>(emptyStats)
  const [statsLoading, setStatsLoading] = useState(false)
  const [logFilter, setLogFilter] = useState('')
  const [auditLog, setAuditLog] = useState<AuditLogRecord[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [actionMessageType, setActionMessageType] = useState<'ok' | 'error'>('ok')
  const [disabled, setDisabled] = useState(false)
  const [disabledReason, setDisabledReason] = useState('')

  const refreshSessions = useSessionStore((s) => s.refreshSessions)
  const disconnectChannel = useChatStore((s) => s.disconnectChannel)
  const removeTurnsFromStorage = useChatStore((s) => s.removeTurnsFromStorage)

  async function loadStats() {
    if (disabled) return
    setStatsLoading(true)
    try {
      const res = await api.getAuditStats()
      setAuditStats(res.stats)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isOmpDisabledError(msg)) {
        setDisabled(true)
        setDisabledReason(msg)
      } else {
        log.debug('Failed to load audit stats:', e)
      }
    } finally {
      setStatsLoading(false)
    }
  }

  async function loadAuditLog() {
    if (disabled) return
    setLogLoading(true)
    try {
      const params = logFilter ? `?event_type=${logFilter}&limit=50` : '?limit=50'
      const res = await api.getAuditLog(params)
      setAuditLog(res.records)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isOmpDisabledError(msg)) {
        setDisabled(true)
        setDisabledReason(msg)
      } else {
        log.debug('Failed to load audit log:', e)
      }
    } finally {
      setLogLoading(false)
    }
  }

  async function clearHistory() {
    const ok = await confirmAction({ title: '清除对话历史', message: '确定清除所有对话历史？此操作不可恢复。', confirmText: '清除', danger: true })
    if (!ok) return
    setActionLoading(true)
    setActionMessage('')
    try {
      const { sessions } = await api.listSessions()
      let succeeded = 0
      let failed = 0
      for (const s of sessions || []) {
        try {
          // 修复 GHOST-SESSION-001：走标准删除流程（断开 WS + 删缓存 + 刷新列表）。
          disconnectChannel(s.session_id)
          removeTurnsFromStorage(s.session_id)
          await api.deleteSession(s.session_id)
          succeeded++
        } catch (e: unknown) {
          failed++
          log.warn('[PrivacyView] 删除会话失败:', e instanceof Error ? e.message : String(e))
        }
      }
      await refreshSessions().catch(() => {})
      if (failed === 0) {
        setActionMessage(`已清除 ${succeeded} 个会话`)
        setActionMessageType('ok')
      } else if (succeeded === 0) {
        setActionMessage(`清除失败（${failed} 个会话）`)
        setActionMessageType('error')
      } else {
        setActionMessage(`部分完成：已清除 ${succeeded} 个会话，${failed} 个失败`)
        setActionMessageType('error')
      }
    } catch (e: unknown) {
      setActionMessage('清除失败: ' + (e instanceof Error ? e.message : String(e)))
      setActionMessageType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function clearAuditLog() {
    const ok = await confirmAction({ title: '清除审计日志', message: '确定清除所有审计日志？', confirmText: '清除', danger: true })
    if (!ok) return
    setActionLoading(true)
    setActionMessage('')
    try {
      const res = await api.clearAuditLog()
      setActionMessage(`已清除 ${res.deleted} 条审计记录`)
      setActionMessageType('ok')
      await loadStats()
      await loadAuditLog()
    } catch (e: unknown) {
      setActionMessage('清除失败: ' + (e instanceof Error ? e.message : String(e)))
      setActionMessageType('error')
    } finally {
      setActionLoading(false)
    }
  }

  async function encryptKeys() {
    setActionLoading(true)
    setActionMessage('')
    try {
      const res = await api.encryptApiKeys()
      setActionMessage(`已加密 ${res.encrypted} 个 API 密钥`)
      setActionMessageType('ok')
    } catch (e: unknown) {
      setActionMessage('加密失败: ' + (e instanceof Error ? e.message : String(e)))
      setActionMessageType('error')
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => {
    void loadStats()
    void loadAuditLog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col mx-auto w-full max-w-4xl gap-4 p-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">隐私仪表盘</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            查看 Maxma 把数据存在哪里、监控了哪些网络活动，并执行清除 / 加密等数据管理操作。
          </p>
        </div>

        <details open className="rounded-lg border border-border bg-card">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground">
            这个页面能帮你做什么？
          </summary>
          <div className="px-4 pb-3 text-xs leading-relaxed text-muted-foreground">
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5">
              <li><strong className="text-foreground">数据存储位置</strong>：列出所有本地数据文件，了解你的对话 / 配置 / 密钥 / 日志分别保存在哪里。</li>
              <li><strong className="text-foreground">网络活动统计</strong>：当后端审计能力可用时，展示按类型聚合的请求总数与高频目标。</li>
              <li><strong className="text-foreground">最近审计日志</strong>：按事件类型筛选并查看最近 50 条审计记录（API 调用 / 文件访问 / 配置变更）。</li>
              <li><strong className="text-foreground">数据管理</strong>：清除对话历史、清除审计日志、对 API 密钥做静态加密——操作不可撤销，请谨慎。</li>
            </ol>
            <p className="mt-2 text-muted-foreground">审计管理已整合到此页面中，请直接查看下方各区域。</p>
          </div>
        </details>

        {disabled && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm leading-relaxed text-foreground">
            <div className="mb-1 text-base font-bold text-destructive">审计日志功能在 OMP 模式下不可用</div>
            <div className="text-muted-foreground">
              后端已切换到 OMP（oh-my-pi）架构，审计日志子系统被移除。隐私仪表盘的审计统计与日志区域已隐藏。
              数据存储位置与数据管理仍可用，请直接查看下方区域。
            </div>
            {disabledReason && (
              <div title={disabledReason} className="mt-2 truncate font-mono text-xs text-muted-foreground">
                后端响应：{disabledReason}
              </div>
            )}
          </div>
        )}

        <Section
          title="数据存储位置"
          desc={<>Maxma 采用本地优先架构——所有数据都保存在你自己的机器上，不会上传到任何云端。</>}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {storageItems.map((item) => (
              <div key={item.label} className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-panel px-3.5 py-3">
                <span className="text-xl">{item.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{item.label}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground" title={item.path}>{item.path}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {!disabled && (
          <>
            <Section
              title="网络活动统计"
              desc={<>展示按事件类型聚合的请求总数与高频目标，帮助确认 AI 行为是否符合预期。</>}
            >
              {statsLoading ? (
                <div className="text-sm text-muted-foreground">加载中...</div>
              ) : auditStats.total === 0 ? (
                <div className="text-sm text-muted-foreground">暂无审计记录</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    <div className="min-w-20 rounded-md border border-border bg-panel px-4 py-3 text-center">
                      <div className="text-xl font-bold text-foreground">{auditStats.total}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">总请求数</div>
                    </div>
                    {Object.entries(auditStats.by_type).map(([type, count]) => (
                      <div key={type} className="min-w-20 rounded-md border border-border bg-panel px-4 py-3 text-center">
                        <div className="text-xl font-bold text-foreground">{count}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{type}</div>
                      </div>
                    ))}
                  </div>
                  {auditStats.top_targets?.length > 0 && (
                    <div className="mt-3">
                      <h4 className="mb-2 mt-3 text-sm font-semibold text-muted-foreground">高频目标</h4>
                      <div className="flex flex-col gap-1">
                        {auditStats.top_targets.map((t) => (
                          <div key={t.target} className="flex justify-between rounded-sm bg-panel px-2.5 py-1.5 text-xs">
                            <span className="font-mono text-foreground">{t.target}</span>
                            <span className="text-muted-foreground">{t.count} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section
              title="最近审计日志"
              desc={<>按事件类型筛选并查看最近 50 条审计记录。点击「刷新」获取最新数据。</>}
            >
              <div className="mb-2 flex gap-2">
                <select
                  className="rounded-md border border-border bg-card px-3 py-2.5 text-xs text-foreground"
                  value={logFilter}
                  onChange={(e) => { setLogFilter(e.target.value); void loadAuditLogWithFilter(e.target.value) }}
                >
                  <option value="">全部类型</option>
                  <option value="api_call">API 调用</option>
                  <option value="file_access">文件访问</option>
                  <option value="config_change">配置变更</option>
                </select>
                <button
                  type="button"
                  className="rounded-md border border-border bg-card px-3.5 py-2.5 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                  onClick={() => void loadAuditLog()}
                >
                  刷新
                </button>
              </div>
              {logLoading ? (
                <div className="text-sm text-muted-foreground">加载中...</div>
              ) : auditLog.length === 0 ? (
                <div className="text-sm text-muted-foreground">暂无日志</div>
              ) : (
                <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                  {auditLog.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-sm bg-panel px-2.5 py-1.5 text-xs">
                      <span className="shrink-0 font-mono text-muted-foreground">{formatTime(entry.timestamp)}</span>
                      <span className="shrink-0 rounded-sm bg-muted px-2 py-1.5 text-[11px]">{entry.type}</span>
                      <span className="flex-1 truncate text-foreground">{entry.target}</span>
                      <span className="shrink-0 font-semibold text-muted-foreground">{entry.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}

        <Section
          title="数据管理"
          desc={<>下列操作会直接修改本地数据，<strong className="text-foreground">不可撤销</strong>。请确认后再点击。</>}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={actionLoading} title="删除所有会话及其消息，不可恢复" onClick={clearHistory}>
              清除所有对话历史
            </Button>
            {!disabled && (
              <Button variant="outline" disabled={actionLoading} title="清空审计数据库，不影响对话历史与 API 密钥" onClick={clearAuditLog}>
                清除审计日志
              </Button>
            )}
            <Button variant="outline" disabled={actionLoading} title="对存储在 providers.yaml 中的 API Key 做静态加密" onClick={encryptKeys}>
              加密 API 密钥
            </Button>
          </div>
          <div className="mt-2.5 flex flex-col gap-1">
            <div className="border-l-2 border-border bg-panel px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">清除所有对话历史</strong>：删除全部会话（含临时与已固定）及其消息记录，但保留审计日志、配置、密钥。</div>
            <div className="border-l-2 border-border bg-panel px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">清除审计日志</strong>：仅清空审计数据库（事件记录），不影响对话历史或密钥。</div>
            <div className="border-l-2 border-border bg-panel px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">加密 API 密钥</strong>：将 <code className="rounded-sm bg-muted px-1.5 py-1.5 font-mono text-[11px]">providers.yaml</code> 中明文存储的 API Key 转为加密形式，重启后仍可正常使用。</div>
          </div>
          {actionMessage && (
            <div className={'mt-2 rounded-md px-3 py-1.5 text-sm ' + (actionMessageType === 'ok' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive')}>
              {actionMessage}
            </div>
          )}
        </Section>
      </div>
    </div>
  )

  // 筛选变更时立即用新值重新拉取（state 异步更新，不能直接复用 loadAuditLog）。
  async function loadAuditLogWithFilter(value: string) {
    if (disabled) return
    setLogLoading(true)
    try {
      const params = value ? `?event_type=${value}&limit=50` : '?limit=50'
      const res = await api.getAuditLog(params)
      setAuditLog(res.records)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isOmpDisabledError(msg)) { setDisabled(true); setDisabledReason(msg) }
      else log.debug('Failed to load audit log:', e)
    } finally {
      setLogLoading(false)
    }
  }
}
