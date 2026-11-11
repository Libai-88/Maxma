import { createRoot } from 'react-dom/client'
import '@/index.css'
import { QuickChatApp } from '../router'
import { waitForBackend } from '@/utils/env'

async function boot() {
  const splash = document.getElementById('app-loading')
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
  if (splash) splash.remove()
  const root = document.getElementById('app')
  if (root) createRoot(root).render(<QuickChatApp />)
}

void boot()
