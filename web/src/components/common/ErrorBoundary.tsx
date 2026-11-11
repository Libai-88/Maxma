import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** 对应旧 RegionalErrorBoundary：按路由 key 复位，错误可见且可重试。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-xl border border-border bg-card px-6 py-5 shadow-sm">
          <p className="text-sm font-medium text-foreground">界面渲染出错</p>
          <p className="mt-2 max-w-md text-xs text-muted-foreground">{this.state.error.message}</p>
          <Button className="mt-4" size="sm" onClick={() => this.setState({ error: null })}>重试</Button>
        </div>
      </div>
    )
  }
}
