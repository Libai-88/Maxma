import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import '@/components/tools/_shared/shared.css'
import { waitForBackend } from '@/utils/env'
import { request } from '@/api'

/**
 * 前端运行时诊断上报（便携版无 DevTools 时的排查通道）。
 * console 错误/未捕获 rejection 上报到后端 /api/diagnostics/frontend，
 * 写入 data/logs/frontend-diag.log，由开发侧读取定位 WebView2 渲染问题。
 * 必须走 request（自动带 X-Maxma-Token），裸 fetch 会被 401 拦截。
 */
function reportDiag(kind: string, msg: string) {
  try {
    const url = `${location.pathname}${location.hash}`
    void request('/diagnostics/frontend', {
      method: 'POST',
      body: JSON.stringify({ kind, msg: String(msg).slice(0, 2000), url, ts: Date.now() }),
    }).catch(() => { /* 诊断通道失败不阻塞 */ })
  } catch { /* silent */ }
}

window.addEventListener('error', (e) => {
  reportDiag('error', `${e.message} @ ${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  reportDiag('rejection', e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason))
})

async function boot() {
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[GlobalError]', err, '\nInfo:', info)
    reportDiag('vue-error', `${err instanceof Error ? err.stack || err.message : String(err)} | info: ${info}`)
    try {
      window.dispatchEvent(new CustomEvent('maxma:error', {
        detail: {
          message: err instanceof Error ? err.message : String(err),
          info,
          timestamp: Date.now(),
        },
      }))
    } catch { /* silent */ }
  }

  // 生产环境：等待后端就绪（Tauri sidecar 启动需 10-30s）
  // 等待期间 index.html 的 loading 覆盖层保持可见
  let backendReady = false
  let backendError = ''
  try {
    backendReady = await waitForBackend()
  } catch (err) {
    backendError = err instanceof Error ? err.message : String(err)
  }
  if (!backendReady) {
    const splash = document.getElementById('app-loading')
    if (splash) splash.remove()
    const el = document.getElementById('app')
    if (el) {
      const detail = backendError ? ` (${backendError})` : ''
      el.innerHTML = `<div role="alert" style="display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;font-family:sans-serif;color:#6f6258;text-align:center"><p>后端服务启动失败，请重启应用后重试。${detail}</p></div>`
    }
    return
  }

  // 隐藏 loading 覆盖层并挂载 Vue
  const splash = document.getElementById('app-loading')
  if (splash) splash.remove()
  app.mount('#app')
}

boot()
