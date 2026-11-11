import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { MediaViewer } from '@/components/common/MediaViewer'
import { Sidebar } from '@/components/layout/Sidebar'
import { SessionDrawer } from '@/components/layout/SessionDrawer'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // Ctrl/Cmd+N 建造的会话需要导航回对话页；useAppInit 派发此事件。
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (path) navigate(path)
    }
    window.addEventListener('maxma:navigate', onNavigate)
    return () => window.removeEventListener('maxma:navigate', onNavigate)
  }, [navigate])

  return (
    <TooltipProvider>
      <div className="app-shell bg-background text-foreground">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2">跳到主要内容</a>
        <Sidebar onToggleSessions={() => setSessionDrawerOpen((v) => !v)} />
        <SessionDrawer open={sessionDrawerOpen} onClose={() => setSessionDrawerOpen(false)} />
        <main id="main-content" className="app-main" tabIndex={-1} aria-label="对话工作区">
          <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>
        </main>
      </div>
      <Toaster position="bottom-right" />
      <ConfirmDialog />
      <MediaViewer />
    </TooltipProvider>
  )
}
