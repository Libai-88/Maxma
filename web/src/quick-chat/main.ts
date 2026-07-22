// web/src/quick-chat/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import QuickChatApp from './QuickChatApp.vue'
import '@/assets/styles/tokens.css'
import '@/assets/styles/animations.css'
import '@/assets/styles/design-system.css'
import '@/themes/suying.css'
import '@/themes/night.css'
import { waitForBackend } from '@/utils/env'

// Quick Chat 默认使用素影主题
document.documentElement.setAttribute('data-theme', 'suying')

async function boot() {
  const app = createApp(QuickChatApp)
  app.config.errorHandler = (err, _instance, info) => {
    // 与 web/src/main.ts 相同的全局错误处理：派发 maxma:error 事件，
    // 供 QuickChatApp.vue 或全局组件捕获后显示用户可见的通知。
    try {
      window.dispatchEvent(new CustomEvent('maxma:error', {
        detail: {
          message: err instanceof Error ? err.message : String(err),
          info,
          timestamp: Date.now(),
        },
      }))
    } catch {
      // 错误通知的发送本身失败时不处理，避免无限递归
    }
  }
  app.use(createPinia())

  let backendReady = false
  let backendError = ''
  try {
    backendReady = await waitForBackend()
  } catch (err) {
    backendError = err instanceof Error ? err.message : String(err)
  }

  const splash = document.getElementById('app-loading')
  if (splash) splash.remove()
  if (!backendReady) {
    const detail = backendError ? ` (${backendError})` : ''
    const el = document.getElementById('app')
    if (el) {
      el.innerHTML = `<div role="alert" class="qc-startup-error">后端服务启动失败，请重启应用后重试。${detail}</div>`
    }
    return
  }

  app.mount('#app')
}

void boot()
