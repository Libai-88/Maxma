/**
 * logger — 分级日志系统
 *
 * 替代泛滥的 console.log/warn/error，提供：
 * - 按模块命名空间（[chat], [session], [ws] 等）
 * - 按级别过滤（debug < info < warn < error）
 * - 生产环境自动静默 debug/info
 * - 开发环境全量输出
 *
 * 用法：
 * ```ts
 * import { createLogger } from '@/utils/logger'
 * const log = createLogger('chat')
 * log.debug('token received', { count })
 * log.info('session created', sessionId)
 * log.warn('reconnect attempt', attempt)
 * log.error('connection failed', err)
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// 生产构建时 Vite 会 tree-shake 掉 import.meta.env.DEV === false 的分支
const isDev = import.meta.env.DEV

// 全局最低级别：开发环境 debug，生产环境 warn
let globalMinLevel: LogLevel = isDev ? 'debug' : 'warn'

// 模块级别覆盖（可选）
const moduleLevels = new Map<string, LogLevel>()

export function setGlobalLogLevel(level: LogLevel) {
  globalMinLevel = level
}

export function setModuleLogLevel(module: string, level: LogLevel) {
  moduleLevels.set(module, level)
}

export interface Logger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`

  function shouldLog(level: LogLevel): boolean {
    const minLevel = moduleLevels.get(module) ?? globalMinLevel
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
  }

  return {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) console.debug(prefix, ...args)
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) console.info(prefix, ...args)
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) console.warn(prefix, ...args)
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) console.error(prefix, ...args)
    },
  }
}
