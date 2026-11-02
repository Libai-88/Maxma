/**
 * 「后台子任务 / Agent」入口的能力门控回归锁。
 *
 * 背景：当前 pi 引擎没有子 Agent 运行时（见 bun-sidecar/src/kernel/pi-contract.ts 的
 * ENGINE_EVENT_EXPECTED_BUT_UNPRODUCED：引擎不发 deferred_subagent_submitted），
 * 后端能力清单因此给 features.sub_agents.enabled=false。
 * lead 在两处补上声明（本次不改这两个文件，只锁住声明存在）：
 *   - web/src/components/inspira/Dock.vue:136 → navItems 的 /agent-tasks 条目带 feature: 'sub_agents'
 *   - web/src/router/index.ts:177            → /agent-tasks 路由 meta.feature = 'sub_agents'
 * 合起来的效果：入口隐藏 + 直达 URL / 硬刷新落到「功能不可用」页，
 * 而不是让用户点进一个永远为空的列表。
 *
 * 风格：读源文本断言（对齐本仓 tests/jetHubCapabilityGating.spec.ts），
 * 并在断言前剥掉注释行，防止只在注释里提一句就骗过测试。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const DOCK = stripComments(readFileSync(join(__dirname, '../src/components/inspira/Dock.vue'), 'utf8'))
const ROUTER = stripComments(readFileSync(join(__dirname, '../src/router/index.ts'), 'utf8'))

describe('/agent-tasks 的 sub_agents 能力门控', () => {
  it('Dock.vue 的 /agent-tasks 导航条目声明了 feature: sub_agents', () => {
    const entry = /\{\s*to:\s*'\/agent-tasks'[^}]*\}/.exec(DOCK)
    expect(entry, 'Dock.vue 里找不到 /agent-tasks 的 navItems 条目').not.toBeNull()
    expect(entry![0]).toMatch(/feature:\s*'sub_agents'/)
  })

  it('router/index.ts 的 /agent-tasks 路由 meta 声明了 feature: sub_agents', () => {
    const at = ROUTER.indexOf("path: '/agent-tasks'")
    expect(at, 'router/index.ts 里找不到 /agent-tasks 路由').toBeGreaterThan(-1)
    // 只在该路由自己的块里找 meta，避免匹配到相邻路由的声明
    const block = ROUTER.slice(at, at + 400)
    expect(block).toMatch(/meta:\s*\{[^}]*feature:\s*'sub_agents'/)
  })

  it('两处声明背后有真实门控机制（不是装饰性字段）', () => {
    // Dock：带 feature 的条目按能力清单过滤后才渲染
    expect(DOCK).toMatch(/\.filter\([^)]*item\.feature[^)]*hasFeature/)
    // router：守卫读 meta.feature 并重定向到 feature-unavailable
    expect(ROUTER).toMatch(/to\.meta\?*\.feature/)
    expect(ROUTER).toMatch(/name:\s*'feature-unavailable'/)
  })

  it('feature-unavailable 兜底路由本身不受能力门控（否则会无限重定向）', () => {
    expect(ROUTER).toMatch(/to\.name\s*!==\s*'feature-unavailable'/)
  })
})
