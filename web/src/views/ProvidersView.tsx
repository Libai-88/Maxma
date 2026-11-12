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
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState<'test' | 'discover' | null>(null)
  const [formModels, setFormModels] = useState<string[]>([])
  const [pickedModels, setPickedModels] = useState<string[]>([])

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
      await api.createProvider({ label: form.label.trim(), provider_type: form.provider_type, base_url: form.base_url, api_key: form.api_key, ...(pickedModels.length ? { models: pickedModels } : {}) } as Partial<ProviderConfig>)
      showToast('已添加渠道')
      setForm({ label: '', provider_type: 'openai', base_url: PRESETS[0].baseUrl, api_key: '' })
      setFormModels([]); setPickedModels([])
      await load()
    } catch (e) {
      showToast('添加失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setCreating(false) }
  }

  const testProvider = async (id: string) => {
    setTesting(id)
    try {
      // 用已保存的 Key 测（旧实现如此；表单里的「测试连接」才测输入的 Key）
      const res = await api.testExistingProvider(id)
      setHealth((h) => ({ ...h, [id]: { ok: res.status === 'ok', message: res.detail ?? undefined } }))
    } catch (e) {
      setHealth((h) => ({ ...h, [id]: { ok: false, message: e instanceof Error ? e.message : String(e) } }))
    } finally { setTesting(null) }
  }

  const discoverForExisting = async (p: ProviderConfig) => {
    const pid = p.id ?? p.label
    setDiscovering(pid)
    try {
      const res = await api.discoverModelsForExisting(pid)
      if (res.models?.length) {
        await api.updateProvider(pid, { models: res.models })
        showToast(`已拉取 ${res.models.length} 个模型并写回该渠道`)
        await load()
      } else {
        showToast('该渠道没有可用模型', 'warning')
      }
    } catch (e) {
      showToast('拉取模型失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setDiscovering(null) }
  }

  const recheckHealth = async (p: ProviderConfig) => {
    const pid = p.id ?? p.label
    setRechecking(pid)
    try {
      const res = await api.checkProviderHealth(pid)
      setHealth((h) => ({ ...h, [pid]: { ok: res.status === 'ok', message: res.detail ?? res.summary ?? undefined } }))
      await load()
    } catch (e) {
      showToast('检测失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setRechecking(null) }
  }

  // 表单级：用输入的 Key 测连接 / 拉取模型（不落库）
  const testFormConnection = async () => {
    if (!form.api_key.trim()) { showToast('请先填写 API Key', 'warning'); return }
    setFormBusy('test')
    try {
      const res = await api.testConnection({ api_key: form.api_key, base_url: form.base_url, provider_type: form.provider_type })
      showToast(res.status === 'ok' ? '连接正常' : `连接失败：${res.detail ?? '未知原因'}`, res.status === 'ok' ? 'success' : 'error')
    } catch (e) {
      showToast('测试失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setFormBusy(null) }
  }

  const discoverForForm = async () => {
    if (!form.api_key.trim()) { showToast('请先填写 API Key', 'warning'); return }
    setFormBusy('discover')
    try {
      const res = await api.discoverModels({ api_key: form.api_key, base_url: form.base_url, provider_type: form.provider_type })
      setFormModels(res.models ?? [])
      setPickedModels(res.models ?? [])
      showToast(`发现 ${res.models?.length ?? 0} 个模型（默认全选）`)
    } catch (e) {
      showToast('拉取模型失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally { setFormBusy(null) }
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
                  <Button
                    variant="outline" size="sm"
                    disabled={discovering === pid || p.builtin}
                    title={p.builtin ? '内置免费模型由 Maxma 管理，不可拉取/修改' : '从该渠道拉取可用模型并写回'}
                    onClick={() => void discoverForExisting(p)}
                  >
                    {discovering === pid ? <Spinner className="size-3" /> : '拉取模型'}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={rechecking === pid} onClick={() => void recheckHealth(p)}>
                    {rechecking === pid ? <Spinner className="size-3" /> : '检测'}
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
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Key 经信封加密存储，界面只显示脱敏值。</p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={formBusy !== null} onClick={() => void testFormConnection()}>
                    {formBusy === 'test' ? <Spinner className="size-3" /> : null} 测试连接
                  </Button>
                  <Button variant="outline" size="sm" disabled={formBusy !== null} onClick={() => void discoverForForm()}>
                    {formBusy === 'discover' ? <Spinner className="size-3" /> : null} 拉取模型
                  </Button>
                  <Button size="sm" disabled={creating} onClick={() => void createProvider()}>
                    {creating ? <Spinner className="size-3" /> : <Plus />} 添加
                  </Button>
                </div>
              </div>
              {formModels.length > 0 && (
                <div className="mt-3 rounded-lg border border-border bg-background/40 p-2">
                  <p className="mb-1.5 text-xs text-muted-foreground">发现 {formModels.length} 个模型，勾选要启用的（默认全选）</p>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {formModels.map((m) => {
                      const on = pickedModels.includes(m)
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPickedModels((prev) => (on ? prev.filter((x) => x !== m) : [...prev, m]))}
                          aria-pressed={on}
                          className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${on ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
                        >
                          {m}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
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
