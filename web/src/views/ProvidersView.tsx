import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tag } from '@/components/ui/tag'
import { Spinner } from '@/components/ui/spinner'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { showToast } from '@/lib/toast'
import type { ProviderConfig } from '@/types'
import { Trash2, Plus, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'

const PRESETS: Array<{ id: string; label: string; baseUrl: string }> = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'moonshot', label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'fireworks', label: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
  { id: 'novita', label: 'Novita', baseUrl: 'https://api.novita.ai/v3/openai' },
  { id: 'nvidia', label: 'NVIDIA', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'x', label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { id: 'xiaomimimo', label: 'MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
]

export default function ProvidersView() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [pluginModels, setPluginModels] = useState<Array<{ provider: string; name: string; displayName?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ label: '', provider_type: 'openai', base_url: PRESETS[0].baseUrl, api_key: '' })
  const [testing, setTesting] = useState<string | null>(null)
  const [health, setHealth] = useState<Record<string, { ok: boolean; message?: string }>>({})

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.listProviders()
      setProviders(res.providers ?? [])
      const models = await api.listPluginModels('codearts-auth').catch(() => ({ providers: [] }))
      const flat = (('providers' in models ? models.providers : []) as Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }>)
        .flatMap((p) => (p.models ?? []).map((m) => ({ provider: p.id, name: m.id, displayName: m.name })))
      setPluginModels(flat)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const createProvider = async () => {
    if (!form.label.trim() || !form.api_key.trim()) { showToast('请填写名称与 API Key', 'warning'); return }
    setCreating(true)
    try {
      await api.createProvider({ label: form.label.trim(), provider_type: form.provider_type, base_url: form.base_url, api_key: form.api_key } as Partial<ProviderConfig>)
      showToast('已添加渠道')
      setForm({ label: '', provider_type: 'openai', base_url: PRESETS[0].baseUrl, api_key: '' })
      await load()
    } catch (e) {
      showToast('添加失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setCreating(false) }
  }

  const testProvider = async (id: string) => {
    setTesting(id)
    try {
      const target = providers.find((x) => (x.id ?? x.label) === id)
      if (!target?.base_url) return
      const res = await api.testConnection({ api_key: '', base_url: target.base_url, provider_type: target.provider_type })
      setHealth((h) => ({ ...h, [id]: { ok: res.status === 'ok', message: res.detail ?? undefined } }))
    } catch (e) {
      setHealth((h) => ({ ...h, [id]: { ok: false, message: e instanceof Error ? e.message : String(e) } }))
    } finally { setTesting(null) }
  }

  const toggleProvider = async (p: ProviderConfig) => {
    try {
      await api.updateProvider(p.id ?? p.label, { enabled: !p.enabled })
      await load()
    } catch (e) {
      showToast('切换失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  const removeProvider = async (id: string) => {
    if (!await confirmAction({ message: '确定删除该模型渠道？此操作不可撤销。', danger: true, confirmText: '删除' })) return
    try {
      await api.deleteProvider(id)
      await load()
    } catch (e) {
      showToast('删除失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }

  return (
    <div className="app-scroll mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">模型提供商</h2>
          <p className="mt-1 text-sm text-muted-foreground">配置 API Key 或使用内置免费通道；Ollama 等本地服务无需 Key。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw /> 刷新</Button>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          <section className="space-y-2">
            {providers.map((p) => {
              const pid = p.id ?? p.label
              const st = health[pid]
              return (
                <div key={pid} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.base_url}</p>
                    {st && (
                      <p className={st.ok ? 'mt-1 flex items-center gap-1 text-xs text-status-done' : 'mt-1 flex items-center gap-1 text-xs text-destructive'}>
                        {st.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {st.ok ? '连接正常' : st.message}
                      </p>
                    )}
                  </div>
                  <Switch checked={p.enabled !== false} onCheckedChange={() => void toggleProvider(p)} aria-label={`启用 ${p.label}`} />
                  <Button variant="outline" size="sm" disabled={testing === pid} onClick={() => void testProvider(pid)}>
                    {testing === pid ? <Spinner className="size-3" /> : '测试'}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="删除渠道" onClick={() => void removeProvider(pid)}><Trash2 /></Button>
                </div>
              )
            })}
            {providers.length === 0 && (
              <div className="rounded-xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                尚未配置任何渠道。内置免费通道无需配置即可使用。
              </div>
            )}
          </section>

          {pluginModels.length > 0 && (
            <section className="mt-6">
              <h3 className="mb-2 text-sm font-medium">插件提供的模型</h3>
              <div className="flex flex-wrap gap-1.5">
                {pluginModels.map((m, i) => <Tag key={i}>{m.displayName || m.name}</Tag>)}
              </div>
            </section>
          )}

          <section className="mt-8">
            <h3 className="mb-3 text-sm font-medium">添加渠道</h3>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, provider_type: preset.id, base_url: preset.baseUrl }))}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${form.provider_type === preset.id ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs text-muted-foreground">名称
                  <Input className="mt-1" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="我的渠道" />
                </label>
                <label className="text-xs text-muted-foreground">Base URL
                  <Input className="mt-1" value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
                </label>
                <label className="text-xs text-muted-foreground sm:col-span-2">API Key
                  <Input className="mt-1" type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-…（本地服务可留空）" />
                </label>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Key 经信封加密存储，界面只显示脱敏值。</p>
                <Button size="sm" disabled={creating} onClick={() => void createProvider()}>
                  {creating ? <Spinner className="size-3" /> : <Plus />} 添加
                </Button>
              </div>
            </div>
          </section>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            模型不可用？<Link to="/help" className="underline">查看帮助</Link>
          </p>
        </>
      )}
    </div>
  )
}
