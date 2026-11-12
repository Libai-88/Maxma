import { useEffect, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EvolutionStats {
  total: number
  active: number
  candidates: number
  paused: number
  avg_confidence: number
}

interface RuleRecord {
  id: string
  rule_text: string
  scope: string
  keywords: string[]
  status: string
  confidence: number
  evidence_count: number
  positive_count: number
  negative_count: number
  last_used_at: string | null
  updated_at: string
}

interface PreviewMatch {
  id: string
  rule_text: string
  scope: string
  confidence: number
  score: number
  matched_keywords: string[]
  scope_matched: boolean
}

/** 自动提炼只认这四种句式——页面上逐字写出来，别让用户猜。 */
const TRIGGER_PATTERNS = [
  '请记住…… / 记住…… / 记一下……',
  '以后…… / 今后…… / 接下来……',
  '我喜欢…… / 我偏好…… / 我的偏好是……',
  '不要…… / 别再…… / 请不要……',
]

function asRule(value: Record<string, unknown>): RuleRecord {
  return {
    id: String(value.id ?? ''),
    rule_text: String(value.rule_text ?? ''),
    scope: String(value.scope ?? 'global'),
    keywords: Array.isArray(value.keywords) ? value.keywords.map(String) : [],
    status: String(value.status ?? 'candidate'),
    confidence: Number(value.confidence ?? 0),
    evidence_count: Number(value.evidence_count ?? 0),
    positive_count: Number(value.positive_count ?? 0),
    negative_count: Number(value.negative_count ?? 0),
    last_used_at: typeof value.last_used_at === 'string' ? value.last_used_at : null,
    updated_at: String(value.updated_at ?? ''),
  }
}

function fmtTime(iso: string | null): string {
  if (!iso) return '未使用'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未使用'
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function EvolutionView() {
  const [rules, setRules] = useState<RuleRecord[]>([])
  const [stats, setStats] = useState<EvolutionStats>({ total: 0, active: 0, candidates: 0, paused: 0, avg_confidence: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [learnText, setLearnText] = useState('')
  const [scope, setScope] = useState('global')
  const [notice, setNotice] = useState('')
  const [previewQuery, setPreviewQuery] = useState('')
  const [preview, setPreview] = useState<{ injection: string; matches: PreviewMatch[] } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [ruleData, statData] = await Promise.all([api.listEvolutionRules('active'), api.getEvolutionStats()])
      setRules(((ruleData.rules ?? []) as Array<Record<string, unknown>>).map(asRule))
      setStats(statData)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取行为偏好失败')
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
      setNotice(result.learned ? '已记录。下一条命中关键词的消息会把它带进上下文。' : '这句话没有被识别为明确的长期偏好——请用页面列出的四种句式。')
      if (result.learned) { setLearnText(''); await load() }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存行为偏好失败')
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

  async function runPreview() {
    const q = previewQuery.trim()
    if (!q || previewing) return
    setPreviewing(true)
    try {
      const res = await api.previewEvolution(q)
      setPreview({ injection: res.injection, matches: res.matches })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="flex-1 overflow-y-auto text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">行为偏好</h1>
            <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted-foreground">
              把你说过的明确长期要求存成可验证、可暂停的规则；只有命中关键词时才注入到当次请求，不额外调用模型。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</Button>
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '生效规则', value: stats.active },
            { label: '规则总数', value: stats.total },
            { label: '平均置信度', value: `${Math.round(stats.avg_confidence * 100)}%` },
            { label: '已暂停', value: stats.paused },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 text-center">
              <div className="font-mono text-[22px] font-bold tabular-nums text-foreground">{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">它具体怎么工作</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted-foreground">
            <li>只从<strong className="text-foreground">你明确说出的</strong>四种句式里提炼，普通对话不会被拿来猜性格：
              <ul className="mt-1 list-[circle] space-y-0.5 pl-4">
                {TRIGGER_PATTERNS.map((p) => <li key={p}><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{p}</code></li>)}
              </ul>
            </li>
            <li>每条规则由「一句话 + 作用域 + 自动切词得到的关键词」组成；命中判断是<strong className="text-foreground">字符串包含</strong>，不是模型判断。</li>
            <li>只有 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">active</code> 且关键词命中的规则才会进入上下文，一次最多 3 条、总长不超过 900 字符。</li>
            <li>「有效 / 降低权重」直接改这条规则的置信度；置信度低于 0.25 会自动暂停。全程不产生额外模型调用。</li>
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">预览：这句话会带进哪些偏好</h2>
          <p className="mt-1 text-xs text-muted-foreground">逐字显示会被追加到消息末尾的内容；预览不会修改任何记录。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={previewQuery}
              onChange={(e) => setPreviewQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runPreview() }}
              placeholder="输入一句话，例如：帮我写一个 Python 脚本"
              className="min-w-[180px] flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
            />
            <Button size="sm" onClick={() => void runPreview()} disabled={!previewQuery.trim() || previewing}>
              {previewing ? '预览中…' : '预览注入'}
            </Button>
          </div>
          {preview && (
            <div className="flex flex-col mt-3 gap-2">
              {preview.matches.length === 0 ? (
                <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-xs text-muted-foreground">这句话不会命中任何偏好，注入内容为空。</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.matches.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11px]">
                        <span className="text-foreground">{m.matched_keywords.slice(0, 2).join(' / ') || m.scope}</span>
                        <span className="text-muted-foreground">score {m.score}</span>
                      </span>
                    ))}
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-muted/40 px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{preview.injection}</pre>
                </>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">添加一条长期偏好</h2>
          <p className="mt-1 text-xs text-muted-foreground">与自动提炼用同一套句式；写清楚动作与边界，避免含糊。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={learnText}
              onChange={(e) => setLearnText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void learn() }}
              maxLength={4000}
              placeholder="例如：以后回答代码时先给出最小可运行示例"
              className="min-w-[180px] flex-1 rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
            />
            <input
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              maxLength={80}
              placeholder="作用域：global / 编程"
              className="w-[170px] rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
            />
            <Button size="sm" onClick={() => void learn()} disabled={!learnText.trim() || saving}>{saving ? '保存中…' : '记录'}</Button>
          </div>
          {notice && <p className="mt-2.5 text-[13px] text-primary">{notice}</p>}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">生效中的偏好</h2>
              <p className="mt-1 text-xs text-muted-foreground">只有 active 状态会参与注入；可随时暂停或降低权重。</p>
            </div>
          </div>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">正在读取…</p>
          ) : rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有行为偏好。说一句「以后……」或「请记住……」即可开始。</p>
          ) : (
            <div className="mt-3 grid gap-2.5">
              {rules.map((rule) => (
                <article key={rule.id} className="rounded-lg border border-border p-3.5">
                  <div className="flex items-start gap-2.5">
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground', rule.status === 'active' && 'bg-primary')} />
                    <p className="min-w-0 break-words text-sm text-foreground">{rule.rule_text}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[18px] text-[11px] text-muted-foreground">
                    <span className="rounded bg-secondary px-2 py-0.5">{rule.scope}</span>
                    <span>置信度 {Math.round(rule.confidence * 100)}%</span>
                    <span>证据 {rule.evidence_count}（+{rule.positive_count} / −{rule.negative_count}）</span>
                    <span>最近使用 {fmtTime(rule.last_used_at)}</span>
                  </div>
                  {rule.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px]">
                      {rule.keywords.slice(0, 6).map((k) => (
                        <span key={k} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{k}</span>
                      ))}
                      {rule.keywords.length > 6 && <span className="text-[10.5px] text-muted-foreground">+{rule.keywords.length - 6}</span>}
                    </div>
                  )}
                  <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="xs" onClick={() => void feedback(rule.id, 'positive')}>有效</Button>
                    <Button variant="outline" size="xs" onClick={() => void feedback(rule.id, 'negative')}>降低权重</Button>
                    <Button variant="destructive" size="xs" onClick={() => void pause(rule.id)}>暂停</Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="text-xs leading-relaxed text-muted-foreground">
          边界：行为偏好只影响提示词，不改变工具权限、审批门与拒止锚的拦截结果；它也不会在后台自己“成长”——没有你的明确句子，规则数量不会增加。
        </p>
      </div>
    </div>
  )
}