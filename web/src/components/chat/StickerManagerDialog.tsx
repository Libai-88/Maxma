import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Download, ExternalLink, RefreshCw, Store, Trash2, Upload } from 'lucide-react'
import { openExternal } from '@/utils/env'
import {
  deleteStickerPack,
  downloadStickerPack,
  getStickerMarket,
  getStickerPacks,
  getStickerSettings,
  importStickerPack,
  installStickerMarketPack,
  saveStickerSettings,
  scanStickerPack,
  type StickerMarketPack,
} from '@/api/stickers'
import type { StickerPack, StickerSettings } from '@/types/sticker'

const SOURCE_LABEL: Record<string, string> = {
  bundled: '随包内置',
  builtin: '随包内置',
  user: '我的收藏',
  legacy: '旧版迁移',
  remote: '远程市场',
}

export function StickerManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [settings, setSettings] = useState<StickerSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [market, setMarket] = useState<StickerMarketPack[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketWarning, setMarketWarning] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reloadPacks = async () => {
    const res = await getStickerPacks()
    setPacks(res.packs ?? [])
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void Promise.allSettled([getStickerPacks(), getStickerSettings()])
      .then(([packsRes, settingsRes]) => {
        if (cancelled) return
        if (packsRes.status === 'fulfilled') setPacks(packsRes.value.packs ?? [])
        if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.settings)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const persist = async (patch: Partial<StickerSettings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      const res = await saveStickerSettings(patch)
      if (res.settings) setSettings(res.settings)
      setNotice('已保存')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '保存失败')
    }
  }

  const togglePack = async (pack: StickerPack) => {
    if (!settings) return
    const enabled = settings.enabledPacks.includes(pack.id)
      ? settings.enabledPacks.filter((id) => id !== pack.id)
      : [...settings.enabledPacks, pack.id]
    if (enabled.length === 0) {
      setNotice('至少保留一个启用图库')
      return
    }
    setPacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, enabled: enabled.includes(pack.id) } : p))
    await persist({ enabledPacks: enabled })
  }

  const scan = async (pack: StickerPack) => {
    setBusy(pack.id)
    setNotice('')
    try {
      const res = await scanStickerPack(pack.id)
      if (res.pack) setPacks((prev) => prev.map((p) => p.id === pack.id ? res.pack! : p))
      setNotice(`已扫描 ${pack.name}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '扫描失败')
    } finally {
      setBusy('')
    }
  }

  const loadMarket = async (refresh = false) => {
    setMarketLoading(true)
    setMarketWarning('')
    try {
      const res = await getStickerMarket(refresh)
      setMarket(res.packs ?? [])
      if (!res.ok && res.warning) setMarketWarning(res.warning)
    } catch (err) {
      setMarketWarning(err instanceof Error ? err.message : '市场目录加载失败')
    } finally {
      setMarketLoading(false)
    }
  }

  const install = async (pack: StickerMarketPack) => {
    setBusy(pack.id)
    setNotice('')
    try {
      const res = await installStickerMarketPack(pack.id)
      await reloadPacks()
      setMarket((prev) => prev.map((p) => p.id === pack.id ? { ...p, installed: true, installedVersion: p.version } : p))
      setNotice(`已安装 ${pack.name}（${res.total} 张）`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '安装失败')
    } finally {
      setBusy('')
    }
  }

  const importFile = async (file: File | null) => {
    if (!file) return
    setBusy('import')
    setNotice('')
    try {
      const res = await importStickerPack(file)
      await reloadPacks()
      setNotice(`已导入 ${res.id}（${res.total} 张）`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '导入失败')
    } finally {
      setBusy('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const exportPack = async (pack: StickerPack) => {
    setBusy(`export-${pack.id}`)
    try {
      await downloadStickerPack(pack.id)
      setNotice(`已导出 ${pack.name}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBusy('')
    }
  }

  const removePack = async (pack: StickerPack) => {
    if (!window.confirm(`删除远程图库「${pack.name}」？图片会从本机移除，但不会删除对应市场源。`)) return
    setBusy(`delete-${pack.id}`)
    try {
      await deleteStickerPack(pack.id)
      await reloadPacks()
      setNotice(`已删除 ${pack.name}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>表情图库管理</DialogTitle>
          <DialogDescription>
            图库就是磁盘上的一个目录（index.db + manifest.json + 图片）。禁用只影响选择和提示词，不删文件。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">加载图库…</p>
        ) : (
          <div className="grid max-h-[65vh] gap-4 overflow-x-hidden overflow-y-auto pr-1">
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">图库</h3>
              <div className="space-y-1.5">
                {packs.map((pack) => {
                  const enabled = settings?.enabledPacks.includes(pack.id) ?? pack.enabled
                  const active = settings?.packId === pack.id
                  return (
                    <div key={pack.id} className={cn('flex items-center gap-3 rounded-lg border border-border px-3 py-2', active && 'border-primary/40 bg-primary/5')}>
                      <Switch
                        checked={enabled}
                        onCheckedChange={() => void togglePack(pack)}
                        aria-label={`启用 ${pack.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{pack.name}</span>
                          {active && <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-caption text-primary">默认</span>}
                        </div>
                        <p className="truncate text-micro text-muted-foreground">
                          {pack.count} 张 · {SOURCE_LABEL[pack.source ?? ''] ?? pack.source} · {pack.id}
                          {pack.license ? ` · ${pack.license}` : ''}
                        </p>
                      </div>
                      {!active && enabled && (
                        <Button size="xs" variant="ghost" onClick={() => void persist({ packId: pack.id })}>设为默认</Button>
                      )}
                      {pack.source !== 'bundled' && pack.source !== 'builtin' && (
                        <Button size="icon-sm" variant="ghost" disabled={busy === pack.id} onClick={() => void scan(pack)} aria-label={`重新扫描 ${pack.name}`}>
                          <RefreshCw className={cn(busy === pack.id && 'animate-spin')} />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" disabled={busy === `export-${pack.id}`} onClick={() => void exportPack(pack)} aria-label={`导出 ${pack.name}`}>
                        <Download />
                      </Button>
                      {pack.source === 'remote' && (
                        <Button size="icon-sm" variant="ghost" disabled={busy === `delete-${pack.id}`} onClick={() => void removePack(pack)} aria-label={`删除 ${pack.name}`}>
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-medium text-muted-foreground">ZIP 导入 / 市场</h3>
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>
                    <Upload className="mr-1 size-3" />导入 ZIP
                  </Button>
                  <Button size="xs" variant="ghost" disabled={marketLoading} onClick={() => void loadMarket(true)}>
                    <Store className="mr-1 size-3" />{marketLoading ? '加载中…' : '刷新市场'}
                  </Button>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => void importFile(e.target.files?.[0] ?? null)}
              />
              {marketWarning && <p className="text-xs text-muted-foreground">{marketWarning}</p>}
              {market.length > 0 && (
                <p className="text-micro text-muted-foreground">许可证与来源由目录声明，安装前请自行核对授权范围；应用不会执行图库内的脚本。</p>
              )}
              {market.length > 0 && (
                <div className="grid max-h-52 gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
                  {market.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{entry.name} <span className="text-muted-foreground">v{entry.version || '?'}</span></p>
                        <p className="truncate text-micro text-muted-foreground">
                          {entry.count || '?'} 张 · {entry.maintainer || '未知作者'} · {entry.license || '许可证未声明'} · {entry.description || entry.id}
                        </p>
                        {entry.homepage ? (
                          <button
                            type="button"
                            className="mt-0.5 inline-flex items-center text-micro text-primary/80 hover:underline"
                            onClick={() => openExternal(entry.homepage)}
                            aria-label={`打开 ${entry.name} 的来源`}
                          >
                            <ExternalLink className="mr-1 size-3" />来源
                          </button>
                        ) : (
                          <span className="mt-0.5 inline-flex items-center text-micro text-muted-foreground">来源未提供</span>
                        )}
                      </div>
                      <Button
                        size="xs"
                        variant={entry.installed ? 'ghost' : 'secondary'}
                        disabled={busy === entry.id || entry.installed}
                        onClick={() => void install(entry)}
                      >
                        {entry.installed ? '已安装' : '安装'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {market.length === 0 && !marketLoading && <p className="text-micro text-muted-foreground">市场目录不会自动安装；点“刷新市场”后再选择。</p>}
            </section>

            {settings && (
              <section className="grid gap-3">
                <h3 className="text-xs font-medium text-muted-foreground">发送与显示</h3>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>点击表情直接发送</span>
                  <Switch checked={settings.pickerSendOnClick} onCheckedChange={(v) => void persist({ pickerSendOnClick: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>在系统提示词里注入表情指引</span>
                  <Switch checked={settings.promptEnabled} onCheckedChange={(v) => void persist({ promptEnabled: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>布局</span>
                  <select
                    value={settings.layoutMode}
                    onChange={(e) => void persist({ layoutMode: e.target.value as StickerSettings['layoutMode'] })}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="inline">行内</option>
                    <option value="stacked">独立成行</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>主动发图</span>
                  <select
                    value={settings.sendGear}
                    onChange={(e) => void persist({ sendGear: e.target.value as StickerSettings['sendGear'] })}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="auto">自动</option>
                    <option value="active">积极</option>
                    <option value="always">每轮</option>
                    <option value="off">关闭</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>发送形式</span>
                  <select
                    value={settings.sendMode}
                    onChange={(e) => void persist({ sendMode: e.target.value as StickerSettings['sendMode'] })}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="auto">自动</option>
                    <option value="image">图片</option>
                    <option value="text">纯文字描述</option>
                  </select>
                </label>
              </section>
            )}

            {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
