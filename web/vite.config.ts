/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

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
    plugins: [vue()],
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
      esbuild: {
        drop: ['console'],
      },
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
      port: webPort,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
        '/ws': {
          target: `ws://localhost:${apiPort}`,
          ws: true,
          changeOrigin: true,
          // 必须显式处理 WebSocket 子协议，否则浏览器收到空的
          // Sec-WebSocket-Protocol 响应头，拒绝建立连接。
          handleProtocols: (protocols: string[]) => protocols[0],
        },
      },
    },
  }
})
