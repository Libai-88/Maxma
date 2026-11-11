import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { selectWebSocketProtocol } from './src/utils/wsProtocol'

/** Dev-only: relax CSP so Vite HMR + devtools work; production keeps strict CSP. */
function relaxDevCsp(): PluginOption {
  return {
    name: 'maxma:relax-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"[^>]*>/,
        (_, policy: string) =>
          `<meta http-equiv="Content-Security-Policy" content="${policy
            .replace(/script-src 'self';/, "script-src 'self' 'unsafe-inline' 'unsafe-eval';")
            .replace(/connect-src 'self'/, "connect-src 'self' ws: wss: http: https:")}" />`
      )
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(process.env.MAXMA_API_PORT) || Number(env.MAXMA_API_PORT) || 8000
  const webPort = Number(process.env.MAXMA_WEB_PORT) || Number(env.MAXMA_WEB_PORT) || Number(env.VITE_MAXMA_WEB_PORT) || 5173

  return {
    // 相对 base 让产物与挂载点无关（后端托管 / 子路径反代 / file:// 检查）。
    base: mode === 'production' ? './' : '/',
    plugins: [react(), tailwindcss(), relaxDevCsp()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      dedupe: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@codemirror/commands'],
    },
    build: {
      minify: 'esbuild',
      emptyOutDir: false,
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          'quick-chat': fileURLToPath(new URL('./quick-chat.html', import.meta.url)),
          splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
        },
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'markdown-vendor': ['markdown-it', 'markdown-it-task-lists', 'markdown-it-texmath', 'katex'],
            codemirror: [
              'codemirror', '@codemirror/lang-markdown', '@codemirror/theme-one-dark',
              '@codemirror/view', '@codemirror/state', '@codemirror/language', '@codemirror/commands',
            ],
          },
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: webPort,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
        '/ws': {
          target: `ws://127.0.0.1:${apiPort}`,
          ws: true,
          changeOrigin: true,
          handleProtocols: selectWebSocketProtocol,
        },
      },
    },
  }
})
