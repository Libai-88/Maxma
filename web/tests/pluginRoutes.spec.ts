// @vitest-environment node

/**
 * 插件页路由回归锁（PLUGIN-001）。
 *
 * 背景：`/plugins` 与 `/plugins/:name` 曾经是两条 redirect（指向 `/extensions`），
 * 导致 `PluginListView.vue` / `PluginDetailView.vue` / `stores/plugin.ts` /
 * `components/plugins/**` 全部是**死代码**（没有任何 import，Vite 根本不打包）。
 * 之后即使后端把插件能力做出来，界面也摸不到。
 *
 * 这条用例直接读源码文本断言路由契约 —— 比挂载组件便宜，且能挡住「有人又把它
 * 改回 redirect」这类静默回归（改回去不会让任何组件测试变红）。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const routerSource = readFileSync(resolve(root, 'src/router/index.ts'), 'utf8')
const dockSource = readFileSync(resolve(root, 'src/components/inspira/Dock.vue'), 'utf8')
const settingsMenuSource = readFileSync(resolve(root, 'src/components/AppSettingsMenu.vue'), 'utf8')

describe('plugin management routes', () => {
  it('registers /plugins as a real route guarded by the plugins capability', () => {
    // 不再是 redirect
    expect(routerSource).not.toMatch(/path:\s*'\/plugins',\s*\n\s*redirect:/)
    expect(routerSource).toMatch(/path:\s*'\/plugins',\s*\n\s*name:\s*'plugins'/)
    expect(routerSource).toMatch(/component:\s*\(\)\s*=>\s*import\('@\/views\/PluginListView\.vue'\)/)
    expect(routerSource).toMatch(/feature:\s*'plugins'/)
  })

  it('registers the plugin detail route so PluginCard can navigate to it', () => {
    expect(routerSource).toMatch(/path:\s*'\/plugins\/:name'/)
    expect(routerSource).toMatch(/component:\s*\(\)\s*=>\s*import\('@\/views\/PluginDetailView\.vue'\)/)
  })

  it('registers the plugin-owned management UI under the plugin detail route', () => {
    // 「开启后拥有单独的界面进行管理」：Jet Hub 页挂在 /plugins/:name/jet-hub，
    // 与插件详情同受 plugins 能力守卫。
    expect(routerSource).toMatch(/path:\s*'\/plugins\/:name\/jet-hub'/)
    expect(routerSource).toMatch(/component:\s*\(\)\s*=>\s*import\('@\/views\/JetHubView\.vue'\)/)
  })

  it('links to the management UI from the plugin detail actions', () => {
    const detailSource = readFileSync(resolve(root, 'src/views/PluginDetailView.vue'), 'utf8')
    expect(detailSource).toMatch(/打开管理界面/)
    expect(detailSource).toMatch(/plugin-jet-hub/)
  })

  it('exposes a nav entry that is hidden when the capability is off', () => {
    expect(dockSource).toMatch(/\{\s*to:\s*'\/plugins',\s*label:\s*'插件',\s*icon:\s*'puzzle',\s*feature:\s*'plugins'\s*\}/)
    expect(settingsMenuSource).toMatch(/route:\s*'\/plugins'/)
  })
})
