import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api } from '@/api'
import { usePluginStore } from '@/stores/plugin'
import type { PluginDetail, PluginConfigSchema, PluginConfigProperty } from '@/types/plugin'

/** 等价移植自 PluginDetailView.vue。 */

interface PluginStoreApi {
  getPluginDetail: (name: string) => Promise<PluginDetail>
  togglePlugin: (name: string, enabled: boolean) => Promise<void>
  uninstallPlugin: (name: string) => Promise<void>
}

/** 哪些插件有自带的管理界面（目前只有 Jet Hub / codearts-auth）。 */
const MANAGEMENT_UI: Record<string, true> = { 'codearts-auth': true }

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}

/** 简单的 markdown 转义渲染（与旧视图口径一致：只转义 + 换行转 <br>）。 */
function renderReadme(readme: string): string {
  return readme
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

export default function PluginDetailView() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const store = usePluginStore() as unknown as PluginStoreApi

  const pluginName = name ?? ''
  const hasManagementUi = Boolean(MANAGEMENT_UI[pluginName])

  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [pluginConfig, setPluginConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadDetail() {
    setLoading(true)
    setError('')
    try {
      const d = await store.getPluginDetail(pluginName)
      setDetail(d)
      // 加载配置（失败不阻塞详情页）
      try {
        const configRes = await api.getPluginConfig(pluginName)
        setPluginConfig(configRes.config || {})
      } catch {
        setPluginConfig({})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDetail()
  }, [pluginName]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggle() {
    if (!detail) return
    try {
      await store.togglePlugin(pluginName, !detail.enabled)
      setDetail({ ...detail, enabled: !detail.enabled })
    } catch {
      // Error handled by store
    }
  }

  async function handleUninstall() {
    if (!window.confirm(`确定要卸载插件 "${pluginName}"？此操作不可撤销。`)) return
    try {
      await store.uninstallPlugin(pluginName)
      navigate('/plugins')
    } catch {
      // Error handled by store
    }
  }

  async function handleConfigUpdate(config: Record<string, unknown>) {
    try {
      await api.updatePluginConfig(pluginName, config)
      setPluginConfig(config)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="ds-view ds-view--narrow mx-auto flex flex-1 min-h-0 flex-col overflow-y-auto">
      <div className="view-header mb-6">
        <Button variant="outline" size="sm" className="mb-3" onClick={() => navigate('/plugins')}>
          <ArrowLeft className="size-3.5" />
          返回插件市场
        </Button>
        <h2 className="text-xl font-semibold text-foreground">{pluginName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">插件详情与配置</p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : detail ? (
        <>
          {/* 基本信息 */}
          <div className="mb-6 border-b border-border pb-6">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {detail.version && <InfoItem label="版本" value={detail.version} />}
              {detail.author && <InfoItem label="作者" value={detail.author} />}
              {detail.license && <InfoItem label="许可证" value={detail.license} />}
              {detail.homepage && <InfoItem label="主页" link={detail.homepage} />}
              {detail.repository && <InfoItem label="仓库" link={detail.repository} />}
              {detail.installed_at && <InfoItem label="安装时间" value={formatDate(detail.installed_at)} />}
            </div>
          </div>

          {/* 描述 */}
          {detail.description && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionTitle>描述</SectionTitle>
              <p className="m-0 text-sm leading-relaxed text-muted-foreground">{detail.description}</p>
            </div>
          )}

          {/* 功能特性 */}
          {detail.features && detail.features.length > 0 && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionTitle>功能特性</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                {detail.features.map((f) => (
                  <Badge key={f} variant="secondary" className="text-xs">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* 依赖 */}
          {detail.dependencies && Object.keys(detail.dependencies).length > 0 && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionTitle>依赖</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {Object.entries(detail.dependencies).map(([dep, ver]) => (
                  <div key={dep} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
                    <span className="font-mono text-foreground">{dep}</span>
                    <span className="font-mono text-muted-foreground">{ver}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* README */}
          {detail.readme && (
            <div className="mb-6 border-b border-border pb-6">
              <SectionTitle>README</SectionTitle>
              <div
                className="rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: renderReadme(detail.readme) }}
              />
            </div>
          )}

          {/* 配置 */}
          <div className="mb-6 border-b border-border pb-6">
            <SectionTitle>配置</SectionTitle>
            {detail.config_schema ? (
              <PluginConfigPanelView
                schema={detail.config_schema}
                config={pluginConfig}
                onUpdate={(c) => void handleConfigUpdate(c)}
              />
            ) : (
              <p className="m-0 text-sm text-muted-foreground">此插件没有可配置的选项。</p>
            )}
          </div>

          {/* 操作 */}
          <div className="mb-6 flex flex-wrap gap-3">
            {detail.enabled && hasManagementUi && (
              <Button onClick={() => navigate(`/plugins/${encodeURIComponent(pluginName)}/jet-hub`)}>
                打开管理界面
              </Button>
            )}
            <Button variant={detail.enabled ? 'outline' : 'default'} onClick={() => void handleToggle()}>
              {detail.enabled ? '禁用插件' : '启用插件'}
            </Button>
            <Button variant="destructive" onClick={() => void handleUninstall()}>
              卸载插件
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-base font-semibold text-foreground">{children}</h3>
}

function InfoItem({ label, value, link }: { label: string; value?: string; link?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
          {link}
        </a>
      ) : (
        <span className="text-sm text-foreground">{value}</span>
      )}
    </div>
  )
}

/** 等价移植自 PluginConfigPanel.vue：按 config_schema 生成表单。 */
function PluginConfigPanelView({
  schema,
  config,
  onUpdate,
}: {
  schema: PluginConfigSchema
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({ ...config })

  // config 变化时同步（对应旧视图的 watch）
  useEffect(() => {
    setLocalConfig({ ...config })
  }, [config])

  function setField(key: string, value: unknown) {
    setLocalConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onUpdate({ ...localConfig })
      }}
    >
      {Object.entries(schema.properties).map(([key, prop]) => (
        <ConfigField
          key={key}
          id={key}
          prop={prop}
          required={schema.required?.includes(key) ?? false}
          value={localConfig[key]}
          onChange={(v) => setField(key, v)}
        />
      ))}
      <div className="mt-6 flex gap-3">
        <Button type="submit">保存配置</Button>
        <Button type="button" variant="outline" onClick={() => setLocalConfig({ ...config })}>
          重置
        </Button>
      </div>
    </form>
  )
}

function ConfigField({
  id,
  prop,
  required,
  value,
  onChange,
}: {
  id: string
  prop: PluginConfigProperty
  required: boolean
  value: unknown
  onChange: (v: unknown) => void
}) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {prop.title || id}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {prop.description && <p className="mb-2 mt-1 text-xs text-muted-foreground">{prop.description}</p>}

      {prop.type === 'string' && !prop.enum && (
        <Input
          id={id}
          type="text"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {prop.enum && (
        <select
          id={id}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {prop.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      )}

      {prop.type === 'number' && (
        <Input
          id={id}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      )}

      {prop.type === 'boolean' && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4"
          />
          <span>启用</span>
        </label>
      )}
    </div>
  )
}
