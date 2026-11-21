/**
 * WorkbenchPaneShell — Pane 的统一外壳。
 *
 * 两个职责：
 * 1. 非当前 Pane 只 `hidden`，不卸载；文件草稿、命令输出、浏览器地址都保住。
 * 2. 单个 Pane 抛错只降级自己，不把对话页一起拖黑。
 */

import { Component, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

class PaneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; attempt: number }
> {
  state = { failed: false, attempt: 0 }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) {
      return <div key={this.state.attempt} className="contents">{this.props.children}</div>
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm font-medium">这个面板未能加载</p>
        <p className="text-xs text-muted-foreground">其他面板和对话不受影响。</p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          onClick={() => this.setState((state) => ({ failed: false, attempt: state.attempt + 1 }))}
        >
          重新加载
        </button>
      </div>
    )
  }
}

export function WorkbenchPaneShell({
  id,
  active,
  className,
  children,
}: {
  id: string
  active: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn('min-h-0 flex-1 flex-col', active ? 'flex' : 'hidden', className)}
      data-workbench-pane={id}
    >
      <PaneErrorBoundary>{children}</PaneErrorBoundary>
    </div>
  )
}
