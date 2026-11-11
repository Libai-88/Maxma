import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './router'
import { request } from '@/api'
import { waitForBackend } from '@/utils/env'

/**
 * 前端运行时诊断上报（便携版无 DevTools 时的排查通道）。
 * DIAG-429-001：节流 + 去重，避免 WebView2 异常风暴撞上后端限流。
 */
const DIAG_MIN_INTERVAL_MS = 1000
const DIAG_DEDUPE_WINDOW_MS = 10000
let lastDiagTs = 0
let lastDiagMsg = ''
let lastDiagMsgTs = 0

function reportDiag(kind: string, msg: string, diagnostic: Record<string, unknown> = {}) {
  const now = Date.now()
  if (msg === lastDiagMsg && now - lastDiagMsgTs < DIAG_DEDUPE_WINDOW_MS) return
  if (now - lastDiagTs < DIAG_MIN_INTERVAL_MS) return
  lastDiagTs = now
  lastDiagMsg = msg
  lastDiagMsgTs = now
  try {
    const url = `${location.pathname}${location.hash}`
    const traceId = crypto.randomUUID().replace(/-/g, '')
    void request('/diagnostics/frontend', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        msg: String(msg).slice(0, 12000),
        url,
        ts: Date.now(),
        trace_id: traceId,
        diagnostic: {
          ...diagnostic,
          route: url,
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        },
      }),
    }).catch(() => { /* 诊断通道失败不阻塞 */ })
  } catch { /* silent */ }
}

window.addEventListener('error', (e) => {
  reportDiag('error', e.error instanceof Error ? e.error.stack || e.message : e.message, {
    filename: e.filename, line: e.lineno, column: e.colno,
    name: e.error instanceof Error ? e.error.name : null,
  })
})
window.addEventListener('unhandledrejection', (e) => {
  reportDiag('rejection', e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason), {
    name: e.reason instanceof Error ? e.reason.name : typeof e.reason,
  })
})

async function boot() {
  const splash = document.getElementById('app-loading')
  const setBootStatus = (text: string) => {
    const el = document.getElementById('boot-status-text')
    if (el) el.textContent = text
  }

  let backendReady = false
  let backendError = ''
  try {
    backendReady = await waitForBackend()
  } catch (err) {
    backendError = err instanceof Error ? err.message : String(err)
  }

  if (!backendReady) {
    if (splash) splash.remove()
    const el = document.getElementById('app')
    if (el) {
      const detail = backendError ? ` (${backendError})` : ''
      el.innerHTML = `<div role="alert" style="display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;font-family:sans-serif;color:oklch(0.985 0 0 / 70%);text-align:center"><p>后端服务启动失败，请重启应用后重试。${detail}</p></div>`
    }
    return
  }

  {
    // 诊断：在控制台/自动化里直接检查 store 与 WS 状态（只读 UI 状态，不含凭据）。
    const [{ useChatStore }, { useSessionStore }] = await Promise.all([
      import('@/stores/chat'),
      import('@/stores/session'),
    ])
    ;(window as unknown as Record<string, unknown>).__maxma = { chat: useChatStore, session: useSessionStore }
  }
  setBootStatus('后端服务已就绪')
  if (splash) splash.remove()
  const root = document.getElementById('app')
  if (root) createRoot(root).render(<App />)
}

void boot()
