import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Puzzle, X, Settings, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/components/common/ConfirmDialog'
import { usePluginStore } from '@/stores/plugin'
import { useCapabilitiesStore } from '@/stores/capabilities'
import type { Plugin, PluginCategory } from '@/types/plugin'

/**
 * 「插件」管理页（等价移植自 PluginListView.vue）。
 *
 * 能力诚实（CAP-HONESTY-001）：`capabilities.features.plugins.marketplace`
 * 为 false（当前发布状态）时，POST /api/plugins/install 对任何未随包分发的
 * spec 一律回 501。因此这里按 marketplace 标志分支：
 *   - 开：网络安装（npm 包名 / GitHub URL / git URL），未来安全评审落地后启用
 *   - 关：只暴露「启用随包分发的插件」，不渲染网络安装入口，并拒绝网络来源的写入
 */

// 本地契约：store 由另一个 agent 同时产出，这里只声明本视图消费的成员，
// 保证在 store 精确类型落地前本文件也能独立通过 tsc。
const CATEGORY_OPTIONS: { value: PluginCategory | ''; label: string }[] = [
  { value: '', label: '所有分类' },
  { value: 'productivity', label: '生产力' },
  { value: 'development', label: '开发工具' },
  { value: 'ai-assistant', label: 'AI 助手' },
  { value: 'integration', label: '集成' },
  { value: 'utility', label: '实用工具' },
  { value: 'other', label: '其他' },
]

/** 网络来源（URL / git / GitHub）判定：marketplace 关闭时这些来源一律拒绝写入。 */
function looksLikeNetworkSpec(spec: string): boolean {
  const s = spec.trim().toLowerCase()
  return (
    s.includes('://') ||
    s.startsWith('git+') ||
    s.startsWith('github:') ||
    s.includes('github.com/') ||
    s.includes('gitlab.com/') ||
    s.includes('bitbucket.org/')
  )
}

export default function PluginListView() {
  const navigate = useNavigate()
  const store = usePluginStore()
  const caps = useCapabilitiesStore()

  const [installSpec, setInstallSpec] = useState('')
  const [localError, setLocalError] = useState('')

  // 搜索 / 过滤（本地持有，避免依赖 store 的派生字段；同时同步给 store.setFilter）
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PluginCategory | ''>('')
  const [enabled, setEnabled] = useState<'' | 'true' | 'false'>('')

  const marketplaceEnabled = caps.capabilities?.features?.plugins?.marketplace === true

  const installBoxTitle = marketplaceEnabled ? '安装插件' : '启用随包分发的插件'
  const installPlaceholder = marketplaceEnabled
    ? 'npm 包名 / GitHub URL / git URL...'
    : '插件标识，例如 codearts-auth'
  const installActionLabel = marketplaceEnabled ? '安装' : '启用'
  const installNote = marketplaceEnabled
    ? '安装来源需先通过安全评审（下载校验、体积与条目上限、路径穿越防护）。'
    : '当前仅支持启用随 Maxma 分发的插件；从网络安装第三方插件需要先通过安全评审，' +
      '该能力位（plugins.marketplace）开启后此输入框才会接受 npm / GitHub 来源。'
  const emptyListDesc = marketplaceEnabled
    ? '在上方输入 npm 包名或 GitHub URL 安装插件。'
    : '在上方输入插件标识（如 codearts-auth）即可启用随包分发的插件。'

  useEffect(() => {
    void caps.fetchCapabilities()
    void store.loadPlugins()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPlugins = useMemo(() => {
    let result = store.plugins
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    }
    if (category) result = result.filter((p) => p.category === category)
    if (enabled !== '') result = result.filter((p) => p.enabled === (enabled === 'true'))
    return result
  }, [store.plugins, query, category, enabled])

  function emitFilter(nextQuery: string, nextCategory: PluginCategory | '', nextEnabled: '' | 'true' | 'false') {
    setQuery(nextQuery)
    setCategory(nextCategory)
    setEnabled(nextEnabled)
    store.setFilter({
      query: nextQuery,
      category: (nextCategory || undefined) as PluginCategory | undefined,
      enabled: nextEnabled === '' ? undefined : nextEnabled === 'true',
    })
  }

  async function handleInstall() {
    const spec = installSpec.trim()
    if (!spec || store.installing) return
    setLocalError('')
    // marketplace=false：隐藏了网络安装入口，也拒绝把网络来源写进安装接口
    if (!marketplaceEnabled && looksLikeNetworkSpec(spec)) {
      setLocalError('当前未开启第三方插件网络安装，仅支持启用随包分发的插件标识。')
      return
    }
    try {
      await store.installPlugin({ spec })
      setInstallSpec('')
    } catch {
      // Error handled by store
    }
  }

  async function handleToggle(name: string) {
    const plugin = store.plugins.find((p) => p.name === name)
    if (!plugin) return
    try {
      await store.togglePlugin(name, !plugin.enabled)
    } catch {
      // Error handled by store
    }
  }

  function handleConfigure(name: string) {
    navigate(`/plugins/${encodeURIComponent(name)}`)
  }

  async function handleUninstall(name: string) {
    if (!(await confirmAction({ message: `确定要卸载插件 "${name}"？此操作不可撤销。`, danger: true, confirmText: '卸载' }))) return
    try {
      await store.uninstallPlugin(name)
    } catch {
      // Error handled by store
    }
  }

  return (
    <div className="ds-view flex flex-1 min-h-0 flex-col overflow-y-auto">
      <div className="view-header mb-6">
        <h2 className="text-xl font-semibold text-foreground">插件</h2>
        <p className="mt-1 text-sm text-muted-foreground">管理随 Maxma 分发的插件——启用、配置与卸载</p>
      </div>

      {/* 安装 / 启用框 */}
      <div className="glass-panel mb-4 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="plugin-install-spec" className="text-[0.82rem] font-semibold text-muted-foreground">
            {installBoxTitle}
          </label>
          <div className="flex gap-2">
            <Input
              id="plugin-install-spec"
              value={installSpec}
              type="text"
              placeholder={installPlaceholder}
              disabled={store.installing}
              onChange={(e) => setInstallSpec(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleInstall()
              }}
            />
            <Button
              onClick={() => void handleInstall()}
              disabled={store.installing || !installSpec.trim()}
              className="shrink-0"
            >
              {store.installing ? '处理中...' : installActionLabel}
            </Button>
          </div>
          <p className="m-0 text-xs leading-relaxed text-muted-foreground">{installNote}</p>
          {localError && <p className="m-0 text-xs text-destructive">{localError}</p>}
        </div>
        {store.installProgress && (
          <div className="mt-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
            {store.installProgress.status === 'success'
              ? '✓'
              : store.installProgress.status === 'error'
                ? '✗'
                : '⏳'}{' '}
            {store.installProgress.spec} -{' '}
            {store.installProgress.status === 'success'
              ? '已启用'
              : store.installProgress.status === 'error'
                ? '启用失败'
                : '正在处理...'}
          </div>
        )}
      </div>

      {/* 搜索与过滤 */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="搜索插件名称、描述、标签..."
            className="pl-8"
            onChange={(e) => emitFilter(e.target.value, category, enabled)}
          />
          {query && (
            <button
              type="button"
              aria-label="清除搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => emitFilter('', category, enabled)}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-lg border border-input bg-transparent px-3.5 text-sm text-foreground outline-none focus-visible:border-ring"
            value={category}
            onChange={(e) => emitFilter(query, e.target.value as PluginCategory | '', enabled)}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border border-input bg-transparent px-3.5 text-sm text-foreground outline-none focus-visible:border-ring"
            value={enabled}
            onChange={(e) => emitFilter(query, category, e.target.value as '' | 'true' | 'false')}
          >
            <option value="">全部状态</option>
            <option value="true">已启用</option>
            <option value="false">已禁用</option>
          </select>
        </div>
      </div>

      {/* 错误提示 */}
      {store.error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          <span>{store.error}</span>
          <button type="button" aria-label="关闭" onClick={() => store.clearError()} className="text-base leading-none">
            ✕
          </button>
        </div>
      )}

      {/* 加载状态 */}
      {store.loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : filteredPlugins.length === 0 ? (
        <div className="glass-panel flex flex-col items-center rounded-lg border border-border px-4 py-12 text-center">
          <div className="mb-3 text-muted-foreground">
            <Puzzle className="size-8" />
          </div>
          <div className="mb-1.5 text-base font-semibold text-foreground">
            {store.plugins.length === 0 ? '没有可启用的插件' : '没有匹配的插件'}
          </div>
          <div className="text-sm text-muted-foreground">
            {store.plugins.length === 0 ? emptyListDesc : '尝试调整搜索条件或过滤器。'}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-md:grid-cols-1">
          {filteredPlugins.map((plugin) => (
            <PluginCardView
              key={plugin.name}
              plugin={plugin}
              onToggle={() => void handleToggle(plugin.name)}
              onConfigure={() => handleConfigure(plugin.name)}
              onUninstall={() => void handleUninstall(plugin.name)}
              onOpen={() => handleConfigure(plugin.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 等价移植自 PluginCard.vue 的卡片（内联，避免新增文件）。 */
function PluginCardView({
  plugin,
  onToggle,
  onConfigure,
  onUninstall,
  onOpen,
}: {
  plugin: Plugin
  onToggle: () => void
  onConfigure: () => void
  onUninstall: () => void
  onOpen: () => void
}) {
  return (
    <div
      className={cn(
        'glass-panel flex cursor-pointer flex-col gap-2 rounded-lg border border-border p-4 text-foreground transition-colors hover:border-primary/40',
        !plugin.enabled && 'opacity-60',
      )}
      onClick={onOpen}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          <Puzzle className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.95rem] font-semibold">{plugin.name}</div>
          {plugin.version && <div className="font-mono text-xs text-muted-foreground">v{plugin.version}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="xs"
            variant={plugin.enabled ? 'default' : 'outline'}
            title={plugin.enabled ? '禁用' : '启用'}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {plugin.enabled ? '禁用' : '启用'}
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            title="配置"
            onClick={(e) => {
              e.stopPropagation()
              onConfigure()
            }}
          >
            <Settings className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            title="卸载"
            onClick={(e) => {
              e.stopPropagation()
              onUninstall()
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {plugin.description && <div className="text-sm leading-relaxed text-muted-foreground">{plugin.description}</div>}
      {plugin.tags && plugin.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {plugin.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[0.7rem]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      {plugin.features && plugin.features.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {plugin.features.map((feature) => (
            <Badge key={feature} variant="outline" className="text-[0.7rem]">
              {feature}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
