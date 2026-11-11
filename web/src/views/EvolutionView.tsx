import { useEffect, useState } from 'react'
import { api } from '@/api'
import { cn } from '@/lib/utils'

interface EvolutionStats {
  total: number
  active: number
  candidates: number
  paused: number
  avg_confidence: number
}

export default function EvolutionView() {
  const [rules, setRules] = useState<Array<Record<string, unknown>>>([])
  const [stats, setStats] = useState<EvolutionStats>({ total: 0, active: 0, candidates: 0, paused: 0, avg_confidence: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [learnText, setLearnText] = useState('')
  const [scope, setScope] = useState('global')
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [ruleData, statData] = await Promise.all([api.listEvolutionRules('active'), api.getEvolutionStats()])
      setRules(ruleData.rules ?? [])
      setStats(statData)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取成长策略失败')
    } finally {
      setLoading(false)
    }
  }

  async function learn() {
    const text = learnText.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      const result = await api.learnEvolutionRule(text, scope.trim() || 'global')
      setNotice(result.learned ? '已记录为可回滚的行为策略。' : '这句话没有被识别为明确的长期偏好。')
      if (result.learned) { setLearnText(''); await load() }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存成长策略失败')
    } finally {
      setSaving(false)
    }
  }

  async function feedback(id: string, value: 'positive' | 'negative') {
    try {
      await api.feedbackEvolutionRule(id, value)
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '更新策略失败')
    }
  }

  async function pause(id: string) {
    try {
      await api.setEvolutionRuleStatus(id, 'paused')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '暂停策略失败')
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="flex-1 overflow-y-auto text-foreground">
      <div className="flex flex-wrap justify-between gap-6 items-end mb-6">
        <div>
          <span className="text-[12px] font-extrabold tracking-[0.14em] text-link">EVOCORE</span>
          <h1 className="text-3xl md:text-[42px] font-semibold tracking-tight text-foreground my-2">行为偏好</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[620px]">把明确的用户反馈沉淀为可验证、可撤销、按需生效的行为偏好。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[92px] p-3 border border-border rounded-lg bg-card text-center">
            <strong className="block font-mono text-[22px] tabular-nums text-foreground">{stats.active}</strong>
            <span className="block text-[11px] text-muted-foreground mt-0.5">生效策略</span>
          </div>
          <div className="min-w-[92px] p-3 border border-border rounded-lg bg-card text-center">
            <strong className="block font-mono text-[22px] tabular-nums text-foreground">{stats.total}</strong>
            <span className="block text-[11px] text-muted-foreground mt-0.5">策略总数</span>
          </div>
          <div className="min-w-[92px] p-3 border border-border rounded-lg bg-card text-center">
            <strong className="block font-mono text-[22px] tabular-nums text-foreground">{Math.round(stats.avg_confidence * 100)}%</strong>
            <span className="block text-[11px] text-muted-foreground mt-0.5">平均置信度</span>
          </div>
        </div>
      </div>

      <section className="mt-4 p-[22px] border border-border rounded-lg bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">添加一条长期行为偏好</h2>
            <p className="text-[13px] text-muted-foreground mt-1">只处理明确的偏好或规则，不从普通对话猜测你的性格。</p>
          </div>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-secondary text-success whitespace-nowrap">无需额外模型调用</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <input
            value={learnText}
            onChange={e => setLearnText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void learn() }}
            maxLength={4000}
            placeholder="例如：以后回答代码时先给出最小可运行示例"
            className="flex-1 min-w-[120px] px-3 py-2.5 border border-border rounded-lg bg-background text-foreground text-sm outline-none focus:border-ring"
          />
          <input
            value={scope}
            onChange={e => setScope(e.target.value)}
            maxLength={80}
            placeholder="作用域：全局 / 编程"
            className="w-[170px] px-3 py-2.5 border border-border rounded-lg bg-background text-foreground text-sm outline-none focus:border-ring"
          />
          <button
            disabled={!learnText.trim() || saving}
            onClick={() => void learn()}
            className="px-3.5 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] transition-transform"
          >
            {saving ? '保存中…' : '记录成长'}
          </button>
        </div>
        {notice && <p className="mt-2.5 text-[13px] text-link">{notice}</p>}
      </section>

      <section className="mt-4 p-[22px] border border-border rounded-lg bg-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">当前行为偏好</h2>
            <p className="text-[13px] text-muted-foreground mt-1">只有 active 策略会在匹配当前请求时进入上下文；每条策略都可以暂停或纠正。</p>
          </div>
          <button onClick={() => void load()} className="px-3 py-2 rounded-lg bg-secondary text-foreground text-sm hover:bg-muted transition-colors">刷新</button>
        </div>
        {loading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">正在读取策略…</div>
        ) : rules.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">还没有行为偏好。明确告诉 Maxma“以后……”或“请记住……”即可开始。</div>
        ) : (
          <div className="grid gap-2.5 mt-4">
            {rules.map(rule => (
              <article key={String(rule.id)} className="p-3.5 border border-border rounded-lg">
                <div className="flex items-start gap-2.5">
                  <span className={cn('size-2 rounded-full bg-muted-foreground shrink-0 mt-1.5', String(rule.status) === 'active' && 'bg-success')} />
                  <p className="text-sm text-foreground">{String(rule.rule_text)}</p>
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground ml-[17px] mt-2">
                  <span>{String(rule.scope)}</span>
                  <span>置信度 {Math.round(Number(rule.confidence ?? 0) * 100)}%</span>
                  <span>{String(rule.evidence_count)} 次证据</span>
                </div>
                <div className="flex justify-end gap-2 mt-2.5">
                  <button onClick={() => void feedback(String(rule.id), 'positive')} className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs hover:bg-muted transition-colors">有效</button>
                  <button onClick={() => void feedback(String(rule.id), 'negative')} className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs hover:bg-muted transition-colors">降低权重</button>
                  <button onClick={() => void pause(String(rule.id))} className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-xs hover:bg-destructive/20 transition-colors">暂停</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="flex gap-2.5 my-3.5 mx-1 text-xs text-muted-foreground">
        <span className="text-link font-extrabold whitespace-nowrap">机制边界</span>
        <p>人格成长只改变可回滚的行为策略，不会覆盖工具权限、审批门或拒止锚拦截。</p>
      </div>
    </div>
  )
}
