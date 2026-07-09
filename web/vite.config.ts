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
    },
    build: {
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
        },
      },
    },
  }
})
