import { useEffect, useState } from 'react'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Spinner } from '@/components/ui/spinner'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { showToast } from '@/lib/toast'

interface QualityRule {
  id: string
  name: string
  description: string
  language: string
  severity: string
  pattern: string
  enabled: boolean
  source: string
  editable: boolean
}

/** 质量规则：可编辑规则 CRUD（后端校验代码产出）。 */
export default function RulesView() {
  const [rules, setRules] = useState<QualityRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<{ name: string; description: string; language: string; severity: 'error' | 'warning' | 'info'; pattern: string }>({ name: '', description: '', language: 'markdown', severity: 'warning', pattern: '' })
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.request<{ rules: QualityRule[] }>('/rules')
      setRules(res.rules ?? [])
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const submit = async () => {
    if (!form.name.trim() || !form.pattern.trim()) { showToast('请填写名称与匹配模式', 'warning'); return }
    setSaving(true)
    try {
      if (editingId) await api.updateRule(editingId, { ...form, enabled: true })
      else await api.createRule({ ...form, enabled: true })
      showToast(editingId ? '已更新' : '已创建')
      setEditingId(null)
      setForm({ name: '', description: '', language: 'markdown', severity: 'warning', pattern: '' })
      await load()
    } catch (e) {
      showToast('保存失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setSaving(false) }
  }

  const toggleRule = async (rule: QualityRule) => {
    try {
      await api.toggleRule(rule.id, !rule.enabled)
      await load()
    } catch (e) {
      showToast('切换失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const deleteRule = async (id: string) => {
    if (!await confirmAction({ message: '确定删除该规则？', danger: true, confirmText: '删除' })) return
    try {
      await api.deleteRule(id)
      await load()
    } catch (e) {
      showToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  return (
    <div className="app-scroll mx-auto w-full max-w-2xl px-6 py-8">
      <header className="mb-6">
        <h2 className="text-lg font-semibold">质量规则</h2>
        <p className="mt-1 text-sm text-muted-foreground">约束 Agent 产出的校验规则：命中即按严重度提示或拦截。</p>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {rule.name}
                      <span className="ml-2 text-xs text-muted-foreground">{rule.language} · {rule.severity}{rule.source === 'builtin' ? ' · 内置' : ''}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{rule.description}</p>
                    {!rule.editable && <p className="mt-1 text-[11px] text-muted-foreground">内置规则不可编辑</p>}
                  </div>
                  <Switch checked={rule.enabled} onCheckedChange={() => void toggleRule(rule)} disabled={!rule.editable} aria-label={`启用 ${rule.name}`} />
                  {rule.editable && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditingId(rule.id); setForm({ name: rule.name, description: rule.description, language: rule.language, severity: (rule.severity === 'error' || rule.severity === 'info' ? rule.severity : 'warning'), pattern: rule.pattern }) }}>
                      编辑
                    </Button>
                  )}
                  {rule.editable && <Button variant="ghost" size="icon-sm" aria-label="删除规则" onClick={() => void deleteRule(rule.id)}>✕</Button>}
                </div>
              </div>
            ))}
            {rules.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">暂无规则</p>}
          </section>

          <section className="mt-8">
            <h3 className="mb-3 text-sm font-medium">{editingId ? '编辑规则' : '新建规则'}</h3>
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">名称
                  <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="text-xs text-muted-foreground">语言
                  <select className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3.5 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} aria-label="语言">
                    {['markdown', 'python', 'typescript', 'javascript'].map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">严重度
                  <select className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3.5 text-sm" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as 'error' | 'warning' | 'info' })} aria-label="严重度">
                    {['info', 'warning', 'error'].map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-muted-foreground">描述
                <Input className="mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
              <label className="block text-xs text-muted-foreground">匹配模式（正则）
                <textarea className="mt-1 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs" rows={3} value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
              </label>
              <div className="flex justify-end gap-2">
                {editingId && <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setForm({ name: '', description: '', language: 'markdown', severity: 'warning', pattern: '' }) }}>取消</Button>}
                <Button size="sm" disabled={saving} onClick={() => void submit()}>{saving ? <Spinner className="size-3" /> : null} 保存</Button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
