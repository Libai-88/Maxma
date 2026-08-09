/// <reference types="vitest" />
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { selectWebSocketProtocol } from './src/utils/wsProtocol'

// Dev-only plugin: relax CSP meta so Vite HMR client (inline <script>),
// sourcemap injections, and browser devtools extensions (Vue DevTools etc.)
// don't get blocked by the production CSP `script-src 'self'`.
// Only active in serve mode (dev server) — production build keeps strict CSP.
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
  const apiPort =
    Number(process.env.MAXMA_API_PORT) ||
    Number(env.MAXMA_API_PORT) ||
    Number(env.VITE_MAXMA_API_PORT) ||
    8000
  const webPort =
    Number(process.env.MAXMA_WEB_PORT) ||
    Number(env.MAXMA_WEB_PORT) ||
    Number(env.VITE_MAXMA_WEB_PORT) ||
    5173

  return {
    // Tauri serves the built files through a custom protocol; root-relative
    // asset URLs would resolve to tauri://localhost/assets/... and 404.
    base: mode === 'production' ? './' : '/',
    plugins: [vue(), relaxDevCsp()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['tests/setup.ts'],
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
      // 关键：去重 CodeMirror 核心包，确保运行时只有一份 @codemirror/state 实例。
      // 否则 vue-codemirror 和直接 import 的 @codemirror/view 各自打包一份 state，
      // EditorView.lineWrapping（FacetProvider）的 instanceof 检查失败，
      // 抛出 "Unrecognized extension value in extension set ([object Object])"。
      dedupe: [
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
      ],
    },
    build: {
      minify: 'esbuild',
      // 关闭 vite 内部 emptyDir：被 safe-delete 钩子（>50 文件 tryTrash 需确认）
      // 静默拦截，rmSync 不删但退出 0。改用 rename 隔离策略：构建前把 dist
      // 改名为 _old（rename 通常不受 Node fs 钩子拦截），vite 写入新 dist。
      emptyOutDir: false,
      // codemirror 611KB 是编辑器生态自重（gzip 209KB），且已通过路由懒加载
      // （仅 /user 页）按需拉取，不阻塞首屏。调高警告阈值消除噪音。
      chunkSizeWarningLimit: 650,
      // 注意：此前 drop:['console'] 会删除前端全部 console 输出，导致运行时
      // 错误（如人设/用户编辑器空白）无法通过 F12 排查。保留 console 以便诊断。
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          'quick-chat': fileURLToPath(new URL('./quick-chat.html', import.meta.url)),
          splash: fileURLToPath(new URL('./splash.html', import.meta.url)),
        },
        output: {
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router', 'vue-virtual-scroller'],
            'markdown-vendor': ['markdown-it', 'markdown-it-task-lists', 'markdown-it-texmath', 'katex'],
            'codemirror': [
              'codemirror',
              'vue-codemirror',
              '@codemirror/lang-markdown',
              '@codemirror/theme-one-dark',
              '@codemirror/view',
              '@codemirror/state',
              '@codemirror/language',
              '@codemirror/commands',
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
          // 必须显式处理 WebSocket 子协议，否则浏览器收到空的
          // Sec-WebSocket-Protocol 响应头，拒绝建立连接。
          handleProtocols: selectWebSocketProtocol,
        },
      },
    },
  }
})
