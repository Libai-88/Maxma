import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import '@/components/tools/_shared/shared.css'
import '@/assets/styles/fonts.css'
import { waitForBackend } from '@/utils/env'
import { request } from '@/api'

/**
 * 前端运行时诊断上报（便携版无 DevTools 时的排查通道）。
 * console 错误/未捕获 rejection 上报到后端 /api/diagnostics/frontend，
 * 写入 data/logs/frontend-diag.log，由开发侧读取定位 WebView2 渲染问题。
 * 必须走 request（自动带 X-Maxma-Token），裸 fetch 会被 401 拦截。
 *
 * DIAG-429-001：上报节流 + 去重。此前每个 rejection/error 都立即上报，
 * WebView2 history API 异常风暴（数百条 "resource id is invalid"）会以
 * >30 次/15s 的洪峰撞上后端限流中间件，产生大量本地 429 噪音日志。
 * 现在 1s 窗口最多 1 条、同消息 10s 内只报一次。
 */
const DIAG_MIN_INTERVAL_MS = 1000
const DIAG_DEDUPE_WINDOW_MS = 10000
let lastDiagTs = 0
let lastDiagMsg = ''
let lastDiagMsgTs = 0
function reportDiag(kind: string, msg: string) {
  const now = Date.now()
  if (msg === lastDiagMsg && now - lastDiagMsgTs < DIAG_DEDUPE_WINDOW_MS) return
  if (now - lastDiagTs < DIAG_MIN_INTERVAL_MS) return
  lastDiagTs = now
  lastDiagMsg = msg
  lastDiagMsgTs = now
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
  // 等待期间 index.html 的 loading 覆盖层保持可见；就绪后更新状态文案，
  // 让启动过程有明确的阶段反馈（SPLASH-STAGE-001）。
  const splash = document.getElementById('app-loading')
  function setBootStatus(text: string) {
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
      el.innerHTML = `<div role="alert" style="display:flex;align-items:center;justify-content:center;height:100vh;padding:24px;font-family:sans-serif;color:#6f6258;text-align:center"><p>后端服务启动失败，请重启应用后重试。${detail}</p></div>`
    }
    return
  }

  // 后端就绪：更新状态文案后再移除覆盖层（短暂展示"已就绪"，避免
  // 首屏在长时间等待后直接闪没，用户无感知）
  setBootStatus('后端服务已就绪')
  if (splash) splash.remove()
  app.mount('#app')
}

boot()
