import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import 'katex/dist/katex.min.css'
import '@/components/tools/_shared/shared.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[GlobalError]', err, '\nInfo:', info)
}
app.mount('#app')
