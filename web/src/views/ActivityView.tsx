import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, List } from 'lucide-react'
import { useActivityStore } from '@/stores/activity'
import type { ActivityStatsResponse } from '@/types'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/common/ConfirmDialog'

const CATEGORY_LABELS: Record<string, string> = {
  turn: 'Turn',
  tool: '工具',
  plan: '计划',
  compression: '压缩',
  approval: '审批',
  memory: '记忆',
  system: '系统',
}

const STATUS_LABELS: Record<string, string> = {
  connecting: '连接中',
  online: '实时',
  offline: '离线',
}

const STATUS_TITLES: Record<string, string> = {
  connecting: '正在与后端建立 SSE 推送连接，通常 1-2 秒内完成',
  online: '已通过 SSE 实时连接接收事件，事件发生时立即出现',
  offline: '实时连接未建立，正在通过每 5 秒定期轮询获取事件',
}

const INTRO_CATS: { cat: string; label: string; meaning: string; color: string }[] = [
  { cat: 'turn', label: 'Turn', meaning: 'AI 对话的一轮交互（用户提问 + AI 回复）', color: 'text-success' },
  { cat: 'tool', label: '工具', meaning: 'AI 调用了一个工具（如文件读写、MCP、搜索等）', color: 'text-link' },
  { cat: 'plan', label: '计划', meaning: 'AI 制定或更新了执行计划', color: '' },
  { cat: 'compression', label: '压缩', meaning: '上下文超长时被自动压缩以节省 Token', color: 'text-status-interrupted' },
  { cat: 'approval', label: '审批', meaning: 'AI 请求执行敏感操作，等待用户批准或已批准/拒绝', color: 'text-destructive' },
  { cat: 'memory', label: '记忆', meaning: 'AI 写入或更新了长期记忆（前往「记忆」页面查看）', color: '' },
  { cat: 'system', label: '系统', meaning: 'Maxma 自身的事件（启动、重启、配置变更等）', color: '' },
]

/** 运行时类型守卫：校验后端返回的 stats 结构是否符合 ActivityStatsResponse */
function isActivityStats(data: unknown): data is ActivityStatsResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.total === 'number' &&
    typeof d.by_category === 'object' && d.by_category !== null &&
    typeof d.started_at === 'number' &&
    typeof d.uptime_seconds === 'number'
  )
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false })
}

export default function ActivityView() {
  const activity = useActivityStore()
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [recentPulse, setRecentPulse] = useState(false)

  useEffect(() => {
    const s = useActivityStore.getState()
    s.fetchRecent(100)
    s.fetchStats()
    s.startStream()
    return () => { useActivityStore.getState().stopStream() }
  }, [])

  useEffect(() => {
    if (!activity.lastEventAt) return
    setRecentPulse(true)
    const t = setTimeout(() => setRecentPulse(false), 2000)
    return () => clearTimeout(t)
  }, [activity.lastEventAt])

  const safeStats: ActivityStatsResponse = isActivityStats(activity.stats)
    ? activity.stats
    : { total: 0, by_category: {}, started_at: 0, uptime_seconds: 0 }
  const statsTotal = safeStats.total
  const statsByCategory = safeStats.by_category

  const records = categoryFilter === 'all'
    ? activity.records
    : activity.records.filter(r => r.category === categoryFilter)
  const displayRecords = [...records].reverse()

  const statusLabel = STATUS_LABELS[activity.connectionState] ?? ''
  const statusTitle = STATUS_TITLES[activity.connectionState] ?? ''

  async function handleClear() {
    if (!(await confirmAction({ message: '确定清空当前活动记录吗？此操作不可撤销（不影响审计日志与已保存的会话）。', danger: true, confirmText: '清空' }))) return
    void activity.clear()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">活动中心</h1>
          <p className="text-sm text-muted-foreground mt-1">实时查看 Maxma 内部发生的事件——AI 对话轮次、工具调用、计划、审批等都会在这里出现。</p>
        </div>
        <div className="flex items-center gap-2 uppercase">
          <span
            title={statusTitle}
            className={cn(
              'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full bg-secondary text-muted-foreground cursor-help',
              activity.connectionState === 'online' && 'text-success',
              activity.connectionState === 'connecting' && 'text-status-interrupted',
            )}
          >
            <span className={cn(
              'inline-block size-2 rounded-full shrink-0',
              activity.connectionState === 'online' && 'bg-success',
              activity.connectionState === 'connecting' && 'bg-status-interrupted animate-pulse',
              activity.connectionState === 'offline' && 'border border-muted-foreground',
            )} />
            {statusLabel}
            {recentPulse && <span className="ml-1 px-1.5 text-[0.85em] font-semibold text-link">✦ 新事件</span>}
          </span>
          <button onClick={() => void activity.fetchRecent(100)} className="px-3.5 py-2.5 text-xs border border-border rounded-lg bg-card text-foreground hover:border-ring transition-colors">刷新</button>
          <button onClick={handleClear} className="px-3.5 py-2.5 text-xs border border-border rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">清空</button>
        </div>
      </header>

      <details open className="border border-border rounded-lg bg-card mb-4">
        <summary className="px-3.5 py-2.5 text-sm font-semibold text-foreground cursor-pointer select-none">这是什么页面？事件类别含义说明</summary>
        <div className="px-3.5 pb-3 text-[13px] text-muted-foreground leading-relaxed">
          <p className="mb-2">活动中心聚合了 Maxma 运行时的所有内部事件，便于排查问题或了解 AI 实际做了什么。每条记录显示：时间、类别、消息内容、（若涉及）工具名与会话 ID。</p>
          <div className="flex flex-col gap-1 mb-2">
            {INTRO_CATS.map(c => (
              <div key={c.cat} className="flex items-center gap-2">
                <span className={cn('inline-block px-2.5 py-1 rounded-full text-[0.85em] font-medium bg-secondary text-muted-foreground whitespace-nowrap shrink-0 min-w-[56px] text-center', c.color)}>{c.label}</span>
                <span>{c.meaning}</span>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground">
            💡 右上角状态有三种：<strong className="text-foreground">连接中</strong>（黄色脉冲，正在建立 SSE 推送）→ <strong className="text-foreground">实时</strong>（绿色实心圆，事件发生时立即出现）→ <strong className="text-foreground">离线</strong>（灰色空心圆，连接断开，Maxma 每 5 秒轮询一次）。出现「✦ 新事件」标记表示刚刚有事件通过实时连接到达。
          </p>
        </div>
      </details>

      {statsTotal > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="flex flex-col items-center px-4 py-2.5 bg-card border border-border rounded-lg min-w-[80px]">
            <span className="font-mono tabular-nums text-xl font-semibold text-link">{statsTotal}</span>
            <span className="text-[0.75em] text-muted-foreground uppercase">总事件</span>
          </div>
          {Object.entries(statsByCategory).map(([cat, count]) => (
            <div key={cat} className="flex flex-col items-center px-4 py-2.5 bg-card border border-border rounded-lg min-w-[80px]">
              <span className="font-mono tabular-nums text-xl font-semibold text-link">{count}</span>
              <span className="text-[0.75em] text-muted-foreground uppercase">{CATEGORY_LABELS[cat] ?? cat}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2.5">
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          aria-label="按类别筛选活动"
          className="px-3.5 py-2.5 border border-border rounded-lg bg-card text-foreground text-xs outline-none focus:border-ring"
        >
          <option value="all">全部类别</option>
          {Object.entries(statsByCategory).map(([cat, count]) => (
            <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat} ({count})</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto border border-border rounded-lg bg-card">
        {displayRecords.map(record => (
          <div
            key={`${record.timestamp}-${record.event_type}-${record.session_id || record.turn_id || ''}`}
            className={cn(
              'flex items-center gap-3 px-3.5 py-2.5 border-b border-border last:border-b-0 text-sm',
              record.level === 'warn' && 'bg-secondary',
              record.level === 'error' && 'bg-destructive/5',
            )}
          >
            <div className="font-mono text-[0.85em] text-muted-foreground whitespace-nowrap">{formatTime(record.timestamp)}</div>
            <div className={cn(
              'px-2.5 py-1 rounded-full text-[0.75em] font-medium bg-secondary text-muted-foreground whitespace-nowrap',
              record.category === 'tool' && 'text-link',
              record.category === 'turn' && 'text-success',
              record.category === 'compression' && 'text-status-interrupted',
              record.category === 'approval' && 'text-destructive',
            )}>
              {CATEGORY_LABELS[record.category] ?? record.category}
            </div>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <span className="text-foreground truncate">{record.message}</span>
              {record.tool_name && <span className="font-mono text-[0.85em] text-muted-foreground bg-secondary px-2 py-1.5 rounded">{record.tool_name}</span>}
              {record.session_id && <span className="font-mono text-[0.75em] text-muted-foreground">{record.session_id.slice(0, 8)}</span>}
            </div>
          </div>
        ))}
        {activity.records.length === 0 && (
          <div className="p-8 text-center">
            <div className="mb-3 flex justify-center">
              {activity.connectionState === 'connecting'
                ? <Info className="size-6 text-muted-foreground" />
                : <List className="size-6 text-muted-foreground" />}
            </div>
            <div className="font-semibold text-muted-foreground mb-1.5">{activity.connectionState === 'connecting' ? '正在建立实时连接...' : '暂无活动记录'}</div>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {activity.connectionState === 'connecting' ? (
                <>首次进入页面时正在与后端建立 SSE 推送连接，通常 1-2 秒内完成。连接成功后，AI 的内部活动会实时出现在这里。</>
              ) : (
                <>开始一段对话或让 AI 执行任务后，这里会实时显示 AI 的内部活动。<Link to="/" className="text-link font-semibold ml-1 hover:underline">→ 返回对话</Link></>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
