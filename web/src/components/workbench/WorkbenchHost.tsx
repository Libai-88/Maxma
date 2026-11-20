/**
 * WorkbenchHost — Workbench 2.0 的 Pane 容器。
 *
 * Pane 顺序、可用性由 `panes.ts` 单源声明；本文件只负责布局与挂载策略。
 * 已访问 Pane 保活（不因切 tab 丢草稿），关闭工作台也只隐藏不卸载。
 * 浏览器是原生 WebContentsView，非当前 tab 或浮层打开时必须先隐藏。
 */

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Maximize2, Minimize2, Search, X } from 'lucide-react'

import type { ChatTurn } from '@/types'
import type { GoalChannelState } from '@/stores/chat'
import type { WorkbenchTab } from '@/types/workbench'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'
import { cn } from '@/lib/utils'
import { useWorkbenchStore, WORKBENCH_MAX_WIDTH, WORKBENCH_MIN_WIDTH } from '@/stores/workbench'
import type { WorkbenchPaneProps } from './paneProps'
import { WorkbenchPaneShell } from './WorkbenchPaneShell'
import {
  WORKBENCH_PANES,
  WORKBENCH_PANE_LABELS,
  availableWorkbenchTabs,
  rememberVisitedPane,
  resolveWorkbenchTab,
} from './panes'

/** Pane 组件只在首次访问时动态加载；注册表是唯一来源。 */
const PANE_BY_ID = new Map(WORKBENCH_PANES.map((pane) => [pane.id, pane] as const))
const PANE_COMPONENTS = new Map(
  WORKBENCH_PANES.map((pane) => [pane.id, lazy(pane.load)] as const),
)

interface PaletteCommand {
  id: string
  label: string
  hint: string
  run: () => void
}

interface WorkbenchHostProps {
  /** 工作台是否可见；关闭时只隐藏，Pane 状态继续保留。 */
  isOpen: boolean
  onArtifactAction: (payload: { artifactId: string; actionId: string; token: string }) => void
  allTurns: ChatTurn[]
  sessionId?: string
  taskTrackerData: Record<string, unknown> | null
  goalState: GoalChannelState | null
}

function clampWidth(value: number): number {
  return Math.min(WORKBENCH_MAX_WIDTH, Math.max(WORKBENCH_MIN_WIDTH, Math.round(value)))
}

function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const filtered = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const choose = (command: PaletteCommand | undefined) => {
    if (!command) return
    onClose()
    command.run()
  }

  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filtered.length) setIndex((current) => (current + 1) % filtered.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length) setIndex((current) => (current - 1 + filtered.length) % filtered.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(filtered[index])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-background/60 px-4 pt-[16vh] backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="w-[min(440px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-foreground"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keyDown}
            aria-label="搜索命令"
            aria-controls="workbench-command-list"
            placeholder="输入命令…"
            className="h-6 min-w-0 flex-1 bg-transparent text-caption outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-2 py-1.5 text-micro text-muted-foreground">Esc</kbd>
        </div>
        <div id="workbench-command-list" role="listbox" className="max-h-72 overflow-y-auto scrollbar-thin p-1">
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-micro text-muted-foreground">没有匹配的命令</p>}
          {filtered.map((command, itemIndex) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={itemIndex === index}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => choose(command)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-caption',
                itemIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
            >
              <span className="truncate">{command.label}</span>
              <span className="shrink-0 text-micro text-muted-foreground">{command.hint}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-micro text-muted-foreground">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  )
}

export function WorkbenchHost({ isOpen, onArtifactAction, allTurns, sessionId, taskTrackerData, goalState }: WorkbenchHostProps) {
  const workbench = useWorkbenchStore()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)
  const dragRef = useRef<{ startX: number; startWidth: number; current: number } | null>(null)
  // 文件/命令 Pane 依赖原生 preload；浏览器还要 WebContentsView 桥。纯 Web
  // 形态不能放出点了没反应的死入口，因此可用 tab 由真实桥能力生成。
  const hasDesktopBridge = typeof window !== 'undefined' && Boolean(window.maxmaDesktop?.pickPath)
  const hasBrowser = typeof window !== 'undefined' && Boolean(window.maxmaDesktop?.browser)
  const tabs = availableWorkbenchTabs({ desktop: hasDesktopBridge, browser: hasBrowser })
  const activeTab = resolveWorkbenchTab(
    tabs,
    (sessionId ? workbench.sessionTabs[sessionId] : undefined) ?? workbench.activeTab,
  )
  const sessionKey = sessionId ?? 'global'
  // Pane 一经访问就保持挂载：切到浏览器再切回文件，FileEditor 的未保存草稿
  // 和 CommandPane 的运行输出还在。按会话隔离，换会话不会把上一个会话的
  // Pane 状态串过来；切回原会话时恢复它自己的已访问集合。
  const [visitedBySession, setVisitedBySession] = useState<Record<string, WorkbenchTab[]>>({})
  const visitedTabs = visitedBySession[sessionKey] ?? [activeTab]
  useEffect(() => {
    setVisitedBySession((current) => {
      const previous = current[sessionKey] ?? [activeTab]
      const next = rememberVisitedPane(previous, activeTab)
      if (next.length === previous.length && next.every((tab, index) => tab === previous[index])) return current
      return { ...current, [sessionKey]: next }
    })
  }, [activeTab, sessionKey])
  const mountedTabs = visitedTabs.includes(activeTab) ? visitedTabs : [...visitedTabs, activeTab]
  const width = Math.min(
    dragWidth ?? workbench.width,
    // 给聊天区留约 400px（视口较宽时）；真正挤不下时走下面的整宽覆盖。
    Math.max(WORKBENCH_MIN_WIDTH, viewportWidth - 620),
  )
  const maximized = workbench.maximized
  // 窄窗里再挤出 320px 给工作台，聊天区只剩两百多像素，欢迎卡会竖排。
  // 此时工作台改为覆盖聊天区的整宽面板，关掉就回到完整对话。
  const narrowOverlay = !maximized && viewportWidth < 1000
  const fullBleed = maximized || narrowOverlay

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'p') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [isOpen])

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (maximized) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: width, current: width }
    document.body.style.cursor = 'col-resize'
    setDragWidth(width)
  }

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const next = clampWidth(dragRef.current.startWidth + (dragRef.current.startX - event.clientX))
    dragRef.current.current = next
    setDragWidth(next)
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const finalWidth = dragRef.current.current
    dragRef.current = null
    setDragWidth(null)
    document.body.style.cursor = ''
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    workbench.setWidth(finalWidth)
  }

  const commands: PaletteCommand[] = [
    ...tabs.map((tab) => ({
      id: `tab-${tab}`,
      label: `切到${WORKBENCH_PANE_LABELS[tab]}`,
      hint: '工作台标签',
      run: () => workbench.setTab(tab, sessionId),
    })),
    {
      id: 'maximize',
      label: maximized ? '还原工作台' : '最大化工作台',
      hint: '布局',
      run: () => workbench.toggleMaximized(),
    },
    {
      id: 'close',
      label: '关闭工作台',
      hint: '布局',
      run: () => workbench.close(),
    },
  ].filter((command) => !(narrowOverlay && command.id === 'maximize'))

  const paneProps: WorkbenchPaneProps = {
    isOpen,
    activeTab,
    overlayOpen: paletteOpen,
    sessionId,
    allTurns,
    taskTrackerData,
    goalState,
    cards: workbench.cards,
    onArtifactAction,
    onRemoveCard: workbench.removeCard,
  }

  return (
    <>
      <aside
        className={cn(
          'flex min-w-0 flex-col border-l border-border',
          fullBleed ? 'absolute inset-0 z-20 w-auto bg-background' : 'relative shrink-0 bg-card/40',
          dragWidth !== null && 'select-none',
          !isOpen && 'hidden',
        )}
        style={fullBleed ? undefined : { width }}
        aria-label="工作台"
        aria-hidden={isOpen ? undefined : 'true'}
        aria-maximized={maximized}
        data-maximized={maximized ? 'true' : 'false'}
        data-narrow-overlay={narrowOverlay ? 'true' : 'false'}
      >
        {!fullBleed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整工作台宽度"
            aria-valuemin={WORKBENCH_MIN_WIDTH}
            aria-valuemax={WORKBENCH_MAX_WIDTH}
            aria-valuenow={workbench.width}
            tabIndex={0}
            title="拖动调整宽度，双击最大化；聚焦后可用 ←/→ 调整"
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const delta = event.key === 'ArrowLeft' ? 24 : -24
              workbench.setWidth(workbench.width + delta)
            }}
            onDoubleClick={() => workbench.toggleMaximized()}
            className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            工作台
            {maximized && <span className="text-micro font-normal text-muted-foreground">已最大化</span>}
            {narrowOverlay && <span className="text-micro font-normal text-muted-foreground">窄窗全宽</span>}
          </span>
          <div className="flex items-center gap-1">
            <Tag>{workbench.cards.length}</Tag>
            <Button variant="ghost" size="icon-sm" onClick={() => setPaletteOpen(true)} aria-label="命令面板" title="命令面板（Ctrl/⌘+Shift+P）">
              <Search className="size-3.5" />
            </Button>
            {!narrowOverlay && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => workbench.toggleMaximized()}
                aria-label={maximized ? '还原工作台' : '最大化工作台'}
                title={maximized ? '还原工作台' : '最大化工作台'}
              >
                {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={() => workbench.close()} aria-label="关闭工作台">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5 scrollbar-none" role="tablist" aria-label="工作台标签">
          {tabs.map((tab) => (
            <Button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              variant={activeTab === tab ? 'secondary' : 'ghost'}
              size="sm"
              className="shrink-0"
              onClick={() => workbench.setTab(tab, sessionId)}
            >
              {WORKBENCH_PANE_LABELS[tab]}
            </Button>
          ))}
        </div>
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            PANE_BY_ID.get(activeTab)?.bodyClassName ?? 'overflow-y-auto scrollbar-thin p-2',
          )}
        >
          {mountedTabs.filter((tab) => tabs.includes(tab)).map((tab) => {
            const Pane = PANE_COMPONENTS.get(tab)
            const meta = PANE_BY_ID.get(tab)
            if (!Pane || !meta) return null
            return (
              <WorkbenchPaneShell
                key={tab}
                id={tab}
                active={activeTab === tab}
                className={meta.bodyClassName}
              >
                <Suspense
                  fallback={(
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                      <p className="text-micro text-muted-foreground">正在加载面板…</p>
                    </div>
                  )}
                >
                  <Pane {...paneProps} />
                </Suspense>
              </WorkbenchPaneShell>
            )
          })}
        </div>
      </aside>
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
    </>
  )
}
