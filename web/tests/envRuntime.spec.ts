/**
 * 遗留问题 #4 回归锁：Tauri 传输层不得复活，同源基址就是已发布值。
 *
 * 背景：Tauri 壳已在阶段 2 整体删除，现在两种已发布形态 —— Web 便携包
 * （后端直接托管 web/dist）与 Electron（desktop/electron/main.cjs 加载后端
 * origin，sandbox:true 且**没有 preload**，因此根本不存在 IPC 桥）—— 都是
 * 同源 HTTP 页面。旧 web/src/utils/env.ts 却留着整套壳探测：detectTauri()
 * 读 window.__TAURI_INTERNALS__、ensurePortLoaded() 动态 import
 * @tauri-apps/api/core 调 get_api_port、tauriFetch() 动态 import
 * @tauri-apps/plugin-http 走 Rust reqwest。这些分支在两侧恒为 false，全部落到
 * 浏览器路径 —— 死而不危害，但把「桌面端需要特殊传输」这个已经不存在的约束
 * 写在了每个请求调用方上。
 *
 * 本文件锁两层（源码层剥注释后再断言，对齐 tests/agentTasksGating.spec.ts /
 * tests/quickChatClose.spec.ts；行为层用真实模块，不 mock 被测对象）：
 *   1. web/src/** 再也找不到这层残留的任何名字。
 *   2. 基址/URL 就是今天实际发货的取值：API 相对 /api、后端 origin 空串、
 *      WS 跟随页面 host、健康轮询与 api 模块都走原生 fetch 的同源相对路径。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SRC_DIR = join(__dirname, '../src')
const SCANNED = /\.(ts|tsx|js|mjs|cjs|vue|css)$/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (SCANNED.test(entry.name)) out.push(full)
  }
  return out
}

/** 死层的全部名字：出现任意一个就说明那层被搬回来了。 */
const DEAD_LAYER_NAMES = [
  '__TAURI',
  '@tauri-apps',
  'tauriFetch',
  'detectTauri',
  'isTauri',
  'ensurePortLoaded',
  'get_api_port',
]

describe('Tauri 传输层已从 web/src 移除（遗留问题 #4）', () => {
  it('web/src/** 剥注释后不含任何 Tauri 探测 / 端口发现 / fetch 包装器名字', () => {
    const offenders: string[] = []
    const files = sourceFiles(SRC_DIR)
    // 扫描本身必须真的覆盖到实现文件，否则「零命中」是空目录骗出来的
    expect(files.some(f => f.endsWith(join('utils', 'env.ts')))).toBe(true)
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const name of DEAD_LAYER_NAMES) {
        if (code.includes(name)) offenders.push(`${file.slice(SRC_DIR.length + 1)} → ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('env.ts 不再导出那一层，也不再有构建期端口常量', () => {
    const envSrc = stripComments(readFileSync(join(SRC_DIR, 'utils', 'env.ts'), 'utf8'))
    expect(envSrc).not.toMatch(/VITE_MAXMA_API_PORT/)
    expect(envSrc).not.toMatch(/DEFAULT_API_PORT/)
    expect(envSrc).toMatch(/export function getApiBase\(\): string \{\s*return '\/api'/)
    expect(envSrc).toMatch(/export function getBackendOrigin\(\): string \{\s*return ''/)
  })
})

describe('同源基址：两种已发布形态共用的实际取值', () => {
  // 每个用例都 await import 一次：api/index.ts 的 BASE 在模块加载时算一次，
  // env.ts 的取值也随 window / fetch 替身变化，静态 import 会复用上一个用例的实例。
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('API 基址是相对 /api；后端 origin 是空串（拼出相对路径）', async () => {
    const { getApiBase, getBackendOrigin } = await import('@/utils/env')

    expect(`${getApiBase()}/health`).toBe('/api/health')
    // activity.ts 的 SSE 就是这么拼的：origin 为空串时落回页面 origin
    expect(`${getBackendOrigin()}/api/activity/stream`).toBe('/api/activity/stream')
  })

  it('WebSocket 基址跟随页面 host（同源），聊天通道据此建立', async () => {
    const { getWsBase } = await import('@/utils/env')

    expect(`${getWsBase()}/ws/chat/session-id`).toBe(`ws://${window.location.host}/ws/chat/session-id`)
  })

  it('waitForBackend 用原生 fetch 轮询同源 /api/health，后端起来即返回 true', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('后端尚未监听'))
      .mockResolvedValueOnce({ ok: true } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { waitForBackend } = await import('@/utils/env')
    await expect(waitForBackend(3, 1)).resolves.toBe(true)

    expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual(['/api/health', '/api/health'])
  })

  it('waitForBackend 超时返回 false 而不是抛错（调用方据此降级重连）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('后端尚未监听'))
    vi.stubGlobal('fetch', fetchMock)

    const { waitForBackend } = await import('@/utils/env')
    await expect(waitForBackend(2, 1)).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('api 模块用同源相对路径取 Token 并发业务请求（桌面端不再有绝对端口）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'runtime-token' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ providers: [] }) } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('@/api')
    await api.listProviders()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/token')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/providers')
  })

  it('openExternal 只走 window.open，危险协议直接拒绝', async () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { openExternal } = await import('@/utils/env')
    openExternal('https://example.com/docs')
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')

    openExternal('javascript:alert(1)')
    expect(open).toHaveBeenCalledTimes(1)

    warn.mockRestore()
  })
})
