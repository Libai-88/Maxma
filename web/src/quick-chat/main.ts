// web/src/quick-chat/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import QuickChatApp from './QuickChatApp.vue'
import '@/assets/styles/tokens.css'
import '@/assets/styles/animations.css'
import '@/assets/styles/design-system.css'
import '@/themes/warm-paper.css'
import '@/themes/midnight.css'

// Quick Chat 默认使用 warm-paper 主题
document.documentElement.setAttribute('data-theme', 'warm-paper')

const app = createApp(QuickChatApp)
app.use(createPinia())
app.mount('#app')
