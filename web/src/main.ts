import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import '@/components/tools/_shared/shared.css'
import { waitForBackend } from '@/utils/env'

async function boot() {
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.config.errorHandler = (err, _instance, info) => {
    console.error('[GlobalError]', err, '\nInfo:', info)
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
  const backendReady = await waitForBackend()
  if (!backendReady) {
    const el = document.getElementById('app')
    if (el) {
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888"><p>Backend timeout. Restart the app.</p></div>'
    }
    return
  }

  // 隐藏 loading 覆盖层并挂载 Vue
  const splash = document.getElementById('app-loading')
  if (splash) splash.remove()
  app.mount('#app')
}

boot()
