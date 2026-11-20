/**
 * BrowserPane — 桌面端内置浏览器（P1）。
 *
 * 页面本体由 Electron WebContentsView 承载，React 只画工具栏和定位空白视口。
 * 这样远程页面永远拿不到主界面的 DOM、preload 或本地文件能力。
 */

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, Loader2, MousePointerClick, RotateCw, ShieldCheck, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { BrowserBounds, BrowserCapture, BrowserState } from '@/types/desktop'
import type { WorkbenchPaneProps } from './paneProps'
import { ScreenshotAnnotator } from '@/components/workbench/ScreenshotAnnotator'

const DEFAULT_URL = 'https://www.bing.com'

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
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const visibleRef = useRef(false)

  useEffect(() => {
    if (!bridge) return
    let disposed = false
    const onState = (next: BrowserState) => {
      if (disposed) return
      setState(next)
      setLoading(next.loading)
      if (next.error) setError(errorText(next.error))
      if (document.activeElement !== addressRef.current) {
        setAddress(next.url && next.url !== 'about:blank' ? next.url : DEFAULT_URL)
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
    if (!active || overlayOpen || shot) {
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
  }, [bridge, active, overlayOpen, shot])

  const annotate = async () => {
    if (!bridge) return
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
    setPicking(true)
    setNotice('在网页里点击要引用的元素，Esc 取消')
    try {
      const picked = await bridge.pickElement()
      if (!picked) {
        setNotice('已取消元素拾取')
        return
      }
      const text = `引用网页元素：${picked.selector}${picked.text ? `（${picked.text.slice(0, 80)}）` : ''}`
      window.dispatchEvent(new CustomEvent('maxma:append-composer', { detail: { text, sessionId: chatSessionId } }))
      setNotice(`已拾取 ${picked.tag} 元素并插入输入框`)
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
                setAddress(state?.url || DEFAULT_URL)
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
        {bridge ? (
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
        <ShieldCheck className="h-3 w-3 text-success" aria-hidden />
        <span>独立浏览器会话 · 网页无本地文件与 Maxma 界面访问权限</span>
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
