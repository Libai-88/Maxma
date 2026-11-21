/**
 * BrowserPane — 桌面端内置浏览器（P1）。
 *
 * 页面本体由 Electron WebContentsView 承载，React 只画工具栏和定位空白视口。
 * 这样远程页面永远拿不到主界面的 DOM、preload 或本地文件能力。
 *
 * 多页签、下载与 allowlist 面板都在 React 层；原生 view 只负责页面本身。
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  Loader2,
  MousePointerClick,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeContextItem } from '@/context/contextItems'
import { emitContextItem } from '@/context/contextBus'
import { cn } from '@/lib/utils'
import type { BrowserBounds, BrowserCapture, BrowserNetworkPolicy, BrowserState, BrowserTabState } from '@/types/desktop'
import type { WorkbenchPaneProps } from './paneProps'
import { ScreenshotAnnotator } from '@/components/workbench/ScreenshotAnnotator'

const DEFAULT_URL = 'https://www.bing.com'
const MAX_TABS = 8

function normalizeAddress(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return `http://${value}`
  if (!/\s/.test(value) && (value.includes('.') || value.includes(':'))) return `https://${value}`
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`
}

function errorText(error: BrowserState['error']): string {
  if (!error || error.code === -3) return ''
  return `${error.description || '页面加载失败'}（${error.code}）`
}

function tabLabel(tab: BrowserTabState): string {
  if (tab.title?.trim()) return tab.title.trim()
  if (tab.url && tab.url !== 'about:blank') {
    try { return new URL(tab.url).hostname } catch { return tab.url }
  }
  return '新页面'
}

function formatBytes(value: number | undefined): string {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const DOWNLOAD_LABEL: Record<string, string> = {
  progressing: '下载中',
  completed: '已完成',
  cancelled: '已取消',
  interrupted: '中断',
}

export function BrowserPane({ isOpen, activeTab, overlayOpen, sessionId }: WorkbenchPaneProps) {
  const active = isOpen && activeTab === 'browser'
  const chatSessionId = sessionId ?? null
  const bridge = window.maxmaDesktop?.browser
  const [state, setState] = useState<BrowserState | null>(null)
  const [address, setAddress] = useState(DEFAULT_URL)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [shot, setShot] = useState<BrowserCapture | null>(null)
  const [picking, setPicking] = useState(false)
  const [panel, setPanel] = useState<'downloads' | 'network' | null>(null)
  const [policyMode, setPolicyMode] = useState<BrowserNetworkPolicy['mode']>('all')
  const [policyDomains, setPolicyDomains] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const visibleRef = useRef(false)
  const tabs = state?.tabs ?? []
  const downloads = state?.downloads ?? []

  useEffect(() => {
    if (!bridge) return
    let disposed = false
    const onState = (next: BrowserState) => {
      if (disposed) return
      setState(next)
      setLoading(next.loading)
      if (next.error) setError(errorText(next.error))
      if (document.activeElement !== addressRef.current) {
        setAddress(next.url && next.url !== 'about:blank' ? next.url : '')
      }
    }
    bridge.onState(onState)
    void bridge.getState().then((next) => {
      onState(next)
      if (!next.url) void bridge.navigate(DEFAULT_URL).then(onState).catch(() => {})
    }).catch(() => setState(null))
    return () => {
      disposed = true
      bridge.offState()
      void bridge.hide()
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    if (!active || overlayOpen || shot || panel) {
      visibleRef.current = false
      void bridge.hide()
      return
    }

    let frame = 0
    let disposed = false
    const measure = (): BrowserBounds | null => {
      const element = viewportRef.current
      if (!element) return null
      const rect = element.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return null
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    }
    const sync = () => {
      frame = 0
      if (disposed) return
      const bounds = measure()
      if (!bounds) return
      if (!visibleRef.current) {
        visibleRef.current = true
        void bridge.show(bounds).then((next) => {
          if (disposed) {
            void bridge.hide()
            return
          }
          setState(next)
        }).catch(() => { if (!disposed) visibleRef.current = false })
      } else {
        void bridge.setBounds(bounds)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }

    sync()
    const observer = new ResizeObserver(schedule)
    if (viewportRef.current) observer.observe(viewportRef.current)
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      visibleRef.current = false
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [bridge, active, overlayOpen, shot, panel])

  const annotate = async () => {
    if (!bridge) return
    setPanel(null)
    setError('')
    try {
      const capture = await bridge.capture()
      setShot(capture)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const pickElement = async () => {
    if (!bridge || picking) return
    setPanel(null)
    setPicking(true)
    setNotice('在网页里点击要引用的元素，Esc 取消')
    try {
      const picked = await bridge.pickElement()
      if (!picked) {
        setNotice('已取消元素拾取')
        return
      }
      const text = `引用网页元素：${picked.selector}${picked.text ? `（${picked.text.slice(0, 80)}）` : ''}`
      const item = normalizeContextItem({
        kind: 'browser-selection',
        label: `网页元素 ${picked.tag || 'element'}`,
        url: state?.url && state.url !== 'about:blank' ? state.url : undefined,
        text: picked.text ? picked.text.slice(0, 2_000) : `选择器：${picked.selector}`,
        meta: { 选择器: picked.selector, 标签: picked.tag || 'element' },
      }, chatSessionId ?? '')
      if (item) emitContextItem(item)
      else window.dispatchEvent(new CustomEvent('maxma:append-composer', { detail: { text, sessionId: chatSessionId } }))
      setNotice('已引用网页元素，可在输入框移除')
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPicking(false)
    }
  }

  const sendShot = (dataUrl: string) => {
    window.dispatchEvent(new CustomEvent('maxma:add-image-ref', {
      detail: { dataUrl, label: `browser-${Date.now()}.png`, sessionId: chatSessionId },
    }))
    setShot(null)
    setNotice('截图已加入对话输入框')
  }

  const go = async (url: string) => {
    if (!bridge) return
    setError('')
    setLoading(true)
    setPanel(null)
    try {
      const next = await bridge.navigate(url)
      setState(next)
      setAddress(next.url || url)
    } catch (reason) {
      setLoading(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = normalizeAddress(address)
    if (!url) {
      setError('只支持 http/https 地址；本地文件请用文件面板预览。')
      return
    }
    void go(url)
  }

  const createTab = () => {
    if (!bridge || tabs.length >= MAX_TABS) return
    setPanel(null)
    setError('')
    void bridge.newTab('about:blank').then((next) => {
      setState(next)
      setAddress('')
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const chooseTab = (tab: BrowserTabState) => {
    if (!bridge || tab.active) return
    setPanel(null)
    void bridge.selectTab(tab.id).then((next) => {
      setState(next)
      setAddress(next.url && next.url !== 'about:blank' ? next.url : '')
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const removeTab = (tabId: string) => {
    if (!bridge) return
    void bridge.closeTab(tabId).then((next) => {
      setState(next)
      setAddress(next.url && next.url !== 'about:blank' ? next.url : '')
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const openNetworkPanel = () => {
    if (panel === 'network') {
      setPanel(null)
      return
    }
    setPanel('network')
    setPolicyMode(state?.network.mode ?? 'all')
    setPolicyDomains((state?.network.domains ?? []).join('\n'))
  }

  const savePolicy = async () => {
    if (!bridge) return
    setError('')
    try {
      const next = await bridge.setPolicy({
        mode: policyMode,
        domains: policyMode === 'all' ? [] : policyDomains.split(/[\s,，;；]+/).filter(Boolean),
      })
      setState(next)
      setPanel(null)
      setNotice(policyMode === 'allowlist' ? '网络 allowlist 已生效' : '网络访问已恢复为全部 http/https')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const clearData = () => {
    if (!bridge) return
    if (!window.confirm('清空内置浏览器的 Cookie 和缓存？这不会影响 Maxma 登录状态。')) return
    void bridge.clearData().then((next) => {
      setState(next)
      setAddress(DEFAULT_URL)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex min-w-0 items-center gap-1 border-b border-border/60 bg-muted/20 px-2">
        <div role="tablist" aria-label="浏览器页签" className="flex min-w-0 flex-1 overflow-x-auto py-1">
          {tabs.map((tab) => {
            const label = tabLabel(tab)
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex h-7 max-w-[13rem] shrink-0 items-center rounded-md border text-caption transition-colors',
                  tab.active
                    ? 'border-border bg-background text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-accent/50',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.active}
                  title={label}
                  className="flex min-w-0 flex-1 items-center gap-1 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => chooseTab(tab)}
                >
                  {tab.loading && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />}
                  <span className="truncate">{label}</span>
                </button>
                <button
                  type="button"
                  aria-label={`关闭页签 ${label}`}
                  title="关闭页签"
                  className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  onClick={() => removeTab(tab.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          {!tabs.length && <span className="px-2 py-1 text-caption text-muted-foreground">正在准备浏览器…</span>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          aria-label="新建浏览器页签"
          title="新建页签"
          disabled={!bridge || tabs.length >= MAX_TABS}
          onClick={createTab}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="后退"
          title="后退"
          disabled={!bridge || !state?.canGoBack}
          onClick={() => void bridge?.back()}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="前进"
          title="前进"
          disabled={!bridge || !state?.canGoForward}
          onClick={() => void bridge?.forward()}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={loading ? '停止加载' : '刷新'}
          title={loading ? '停止加载' : '刷新'}
          disabled={!bridge}
          onClick={() => void (loading ? bridge?.stop() : bridge?.reload())}
        >
          {loading ? <X className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="回到起始页"
          title="回到起始页"
          disabled={!bridge}
          onClick={() => void go(DEFAULT_URL)}
        >
          <Globe2 className="h-3.5 w-3.5" />
        </Button>
        <form className="min-w-0 flex-1" onSubmit={submit}>
          <Input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAddress(state?.url || '')
                event.currentTarget.blur()
              }
            }}
            aria-label="地址栏"
            placeholder="输入网址或搜索关键词"
            disabled={!bridge}
            className="h-7 rounded-md px-2 text-xs"
          />
        </form>
        {loading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="浏览器下载"
          title="下载列表"
          disabled={!bridge}
          onClick={() => setPanel(panel === 'downloads' ? null : 'downloads')}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="网络 allowlist"
          title="网络 allowlist"
          disabled={!bridge}
          onClick={openNetworkPanel}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="截图并标注"
          title="截图并标注"
          disabled={!bridge || !state?.url || state.url === 'about:blank'}
          onClick={() => void annotate()}
        >
          <Camera className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="拾取网页元素"
          title="拾取网页元素并插入输入框"
          disabled={!bridge || !state?.url || state.url === 'about:blank' || picking}
          onClick={() => void pickElement()}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="在系统浏览器打开"
          title="在系统浏览器打开"
          disabled={!bridge || !state?.url}
          onClick={() => void bridge?.external()}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground"
          aria-label="清空浏览器数据"
          title="清空 Cookie 和缓存"
          disabled={!bridge}
          onClick={clearData}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-caption text-destructive" role="status">
          {error}
        </div>
      )}
      {notice && (
        <div className="border-b border-border/60 bg-accent/30 px-3 py-1.5 text-caption text-muted-foreground" role="status">
          {notice}
        </div>
      )}

      <div ref={viewportRef} aria-label="浏览器页面区域" data-browser-viewport="true" className={cn('relative min-h-0 flex-1 bg-background')}>
        {panel === 'downloads' ? (
          <div className="h-full overflow-y-auto p-3" aria-label="浏览器下载列表">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">下载</p>
              <Button size="sm" variant="ghost" aria-label="关闭下载面板" onClick={() => setPanel(null)}>关闭</Button>
            </div>
            {!downloads.length ? (
              <p className="text-xs text-muted-foreground">还没有下载。页面触发的下载会保存到 Maxma 数据目录的 downloads 文件夹。</p>
            ) : (
              <div className="space-y-2">
                {downloads.map((item) => (
                  <div key={item.id} className="rounded-md border border-border/60 p-2">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs font-medium" title={item.filename}>{item.filename}</span>
                      <span className="shrink-0 text-caption text-muted-foreground">{DOWNLOAD_LABEL[item.state] ?? item.state}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-caption text-muted-foreground">
                      <span>{formatBytes(item.receivedBytes)}{item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ''}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2"
                        disabled={item.state !== 'completed'}
                        aria-label={`在文件夹中显示 ${item.filename}`}
                        onClick={() => void bridge?.revealDownload(item.id)}
                      >
                        <FolderOpen className="h-3 w-3" /> 在文件夹中显示
                      </Button>
                    </div>
                    {item.error && <p className="mt-1 text-caption text-destructive">{item.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : panel === 'network' ? (
          <div className="h-full overflow-y-auto p-3" aria-label="网络 allowlist 设置">
            <p className="text-sm font-medium">网络 allowlist</p>
            <p className="mt-1 text-xs text-muted-foreground">默认允许 http/https。切换后只允许列表中的主机及其子域；页面主请求和图片/脚本等子资源都会被拦截。</p>
            <label className="mt-3 block text-caption font-medium" htmlFor="browser-network-mode">网络模式</label>
            <select
              id="browser-network-mode"
              aria-label="网络访问模式"
              className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={policyMode}
              onChange={(event) => setPolicyMode(event.target.value as BrowserNetworkPolicy['mode'])}
            >
              <option value="all">全部 http/https</option>
              <option value="allowlist">仅 allowlist</option>
            </select>
            <label className="mt-3 block text-caption font-medium" htmlFor="browser-network-domains">允许的域名</label>
            <textarea
              id="browser-network-domains"
              aria-label="允许的域名"
              className="mt-1 min-h-24 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder="example.com&#10;docs.example.com"
              disabled={policyMode === 'all'}
              value={policyDomains}
              onChange={(event) => setPolicyDomains(event.target.value)}
            />
            <p className="mt-1 text-caption text-muted-foreground">每行一个或用逗号分隔；写 example.com 会同时允许其子域。最多 200 个。</p>
            {(state?.network.blocked.length ?? 0) > 0 && (
              <p className="mt-2 text-caption text-destructive">已拦截 {state?.network.blocked.length} 个请求，最近：{state?.network.blocked[0]?.host}</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void savePolicy()}>保存策略</Button>
              <Button size="sm" variant="ghost" aria-label="取消网络设置" onClick={() => setPanel(null)}>取消</Button>
            </div>
          </div>
        ) : bridge ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-xs space-y-1.5 text-muted-foreground">
              <Globe2 className="mx-auto h-6 w-6 opacity-40" />
              <p className="text-xs">浏览器页面由桌面端原生视图承载</p>
              <p className="text-caption opacity-70">网页运行在独立会话里，读不到 Maxma 界面和本地文件。</p>
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="max-w-xs space-y-2 text-muted-foreground">
              <Globe2 className="mx-auto h-7 w-7 opacity-40" />
              <p className="text-sm font-medium text-foreground">内置浏览器只在桌面端可用</p>
              <p className="text-xs">纯 Web 形态没有本地原生视图，请使用系统浏览器打开网页。</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5 text-caption text-muted-foreground">
        <ShieldCheck className="h-3 w-3 shrink-0 text-success" aria-hidden />
        <span className="min-w-0 truncate">
          {state?.network.mode === 'allowlist'
            ? `网络 allowlist：${state.network.domains.length} 个域名`
            : '网络访问：全部 http/https'}
        </span>
        <span className="ml-auto shrink-0">{tabs.length} 个页签</span>
      </div>

      {shot && (
        <ScreenshotAnnotator
          image={shot}
          onClose={() => setShot(null)}
          onSend={sendShot}
        />
      )}
    </div>
  )
}
