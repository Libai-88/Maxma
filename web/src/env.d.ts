/// <reference types="vite/client" />

declare module 'markdown-it-texmath' {
  const plugin: (md: unknown, options?: Record<string, unknown>) => void
  export default plugin
}

declare module 'markdown-it-task-lists' {
  const plugin: (md: unknown, options?: Record<string, unknown>) => void
  export default plugin
}

declare module '*.css'
