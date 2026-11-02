/**
 * 能力门控界面的诚实性回归锁（CAP-HONESTY-001）。
 *
 * 三条真实缺陷，本质都是「界面在撒谎」：
 *   1. `FeatureUnavailableView.vue` 只读 route.query.title，渲染通用文案
 *      「此功能可能需要在设置中开启…」。而后端
 *      `bun-backend/src/routes/capabilities.ts` 特意发布了
 *      `engine_supported` + 人类可读 `reason`（features.sub_agents），
 *      就是为了区分「引擎做不到」与「你自己关了」。对 sub_agents，
 *      用户被告知是他关掉的——把引擎的缺陷谎报成用户的操作。
 *   2. `SettingsView.vue` 的 子代理 / 浏览器工具 面板照常可编辑，
 *      但写入没有任何运行时效果：sub_agents 的
 *      `enabled = 面板开关 && engine_supported` 而 engine_supported 恒 false；
 *      browser_tools 全仓零消费方（只落 panel_configs.json）。
 *      一个运行时永远不读的控件，对用户就是谎言。
 *   3. `PluginListView.vue` 渲染真实可用的安装框（placeholder 写着
 *      npm 包名 / GitHub URL），而 `capabilities.features.plugins.marketplace`
 *      = false，`POST /api/plugins/install` 对任何未随包分发的 spec 回 501。
 *
 * 两层断言（对齐本仓 agentTasksGating.spec.ts / jetHubCapabilityGating.spec.ts）：
 *   - 行为层：挂载组件、喂真实能力清单，看它到底说了什么 / 还能不能写；
 *   - 结构层：读源文本（剥注释）确认门控写在真实代码里，不是注释里提一句。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount, type DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { CapabilityFeatures, CapabilitiesResponse } from '@/types'

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getTtsConfig: vi.fn(),
  getBrowserToolsConfig: vi.fn(),
  getSubAgentConfig: vi.fn(),
  updateBrowserToolsConfig: vi.fn(),
  updateSubAgentConfig: vi.fn(),
  setSetting: vi.fn(),
  selectFile: vi.fn(),
  listPlugins: vi.fn(),
  installPlugin: vi.fn(),
  togglePlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  getCapabilities: vi.fn(),
}))

// 只 mock 默认导出还不够：@/api 还被 stores/*、composables/useChat 以命名导出
// （getToken / ensureTokenLoaded / resetToken / request）引用，缺一个都会在
// import 期炸掉。这里把用到的名字一并补齐。
vi.mock('@/api', () => ({
  api: apiMock,
  request: vi.fn(),
  getToken: vi.fn(() => 'test-token'),
  ensureTokenLoaded: vi.fn(async () => {}),
  resetToken: vi.fn(),
}))

import { describeFeatureAvailability, useCapabilitiesStore } from '@/stores/capabilities'
import FeatureUnavailableView from '@/views/FeatureUnavailableView.vue'
import PluginListView from '@/views/PluginListView.vue'
import SettingsView from '@/views/SettingsView.vue'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const SETTINGS_SRC = stripComments(readFileSync(join(__dirname, '../src/views/SettingsView.vue'), 'utf8'))
const BACKEND_SUBAGENT_REASON = '当前 Agent 引擎（pi）没有子任务运行时，后台子任务暂不可用'

let pinia: Pinia

/** 把能力清单灌进 store（等价于 fetchCapabilities 成功后的状态）。 */
function seedCapabilities(features: CapabilityFeatures): void {
  const store = useCapabilitiesStore(pinia)
  store.capabilities = { features } as unknown as CapabilitiesResponse
}

/** 在 .section 列表里找到含关键字的那一块（找不到就直接失败，带上下文）。 */
function sectionOf(sections: DOMWrapper<Element>[], keyword: string) {
  const found = sections.find((s) => s.text().includes(keyword))
  expect(found, `未渲染包含「${keyword}」的面板`).toBeTruthy()
  return found!
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  Object.values(apiMock).forEach((fn) => fn.mockReset())
  apiMock.getSettings.mockResolvedValue({})
  apiMock.getTtsConfig.mockResolvedValue({})
  apiMock.getBrowserToolsConfig.mockResolvedValue({})
  apiMock.getSubAgentConfig.mockResolvedValue({})
  apiMock.updateBrowserToolsConfig.mockResolvedValue({})
  apiMock.updateSubAgentConfig.mockResolvedValue({})
  apiMock.listPlugins.mockResolvedValue([])
  apiMock.getCapabilities.mockResolvedValue({ features: {} })
})

describe('describeFeatureAvailability：不可用原因的分类（纯函数）', () => {
  it('引擎不支持时原样透传后端 reason，并标记为不可操作', () => {
    const got = describeFeatureAvailability(
      { sub_agents: { enabled: false, engine_supported: false, reason: BACKEND_SUBAGENT_REASON } },
      'sub_agents',
    )
    expect(got.kind).toBe('engine_unsupported')
    expect(got.reason).toBe(BACKEND_SUBAGENT_REASON)
    expect(got.actionable).toBe(false)
  })

  it('用户关闭与引擎不支持是两种不同结论（不许混成一句「去设置里开」）', () => {
    const userOff = describeFeatureAvailability({ tts: { enabled: false } }, 'tts')
    expect(userOff.kind).toBe('user_disabled')
    expect(userOff.actionable).toBe(true)
    expect(userOff.reason).not.toContain('引擎')

    const engineOff = describeFeatureAvailability(
      { sub_agents: { enabled: true, engine_supported: false } },
      'sub_agents',
    )
    expect(engineOff.kind).toBe('engine_unsupported')
    expect(engineOff.actionable).toBe(false)
  })

  it('清单里没有该特性 ⇒ 未部署；清单未加载 ⇒ 明说无法判断，不编原因', () => {
    expect(describeFeatureAvailability({ mcp: { enabled: true } }, 'rules').kind).toBe('not_deployed')
    const unloaded = describeFeatureAvailability(undefined, 'rules')
    expect(unloaded.kind).toBe('manifest_unloaded')
    expect(unloaded.reason).not.toContain('设置中开启')
  })

  it('engine_supported 缺失时不误判为引擎不支持（与 isFeatureEnabled 的乐观默认一致）', () => {
    expect(describeFeatureAvailability({ collab: { enabled: true } }, 'collab').kind).toBe('available')
  })
})

describe('FeatureUnavailableView 显示真实原因', () => {
  async function mountView(features: CapabilityFeatures | null, query: Record<string, string>) {
    if (features) seedCapabilities(features)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div/>' } },
        { path: '/capabilities', component: { template: '<div/>' } },
        { path: '/feature-unavailable', component: FeatureUnavailableView },
      ],
    })
    await router.push({ path: '/feature-unavailable', query })
    await router.isReady()
    const wrapper = mount(FeatureUnavailableView, {
      global: { plugins: [pinia, router], stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('清单带 engine_supported:false + reason 时说的是引擎原因，不是「你去设置里开」', async () => {
    const wrapper = await mountView(
      { sub_agents: { enabled: false, engine_supported: false, reason: BACKEND_SUBAGENT_REASON } },
      { feature: 'sub_agents', title: 'Agent 任务' },
    )
    const text = wrapper.text()

    expect(text).toContain(BACKEND_SUBAGENT_REASON)
    // 旧文案：对引擎不支持的特性是一句谎话
    expect(text).not.toContain('可能需要在设置中开启')
    expect(text).not.toContain('前往「运行设置」')
    expect(wrapper.get('.fu-note').text()).toContain('调整本地设置不会改变结果')
    wrapper.unmount()
  })

  it('用户自行关闭的特性才提示可去设置里开启', async () => {
    const wrapper = await mountView({ tts: { enabled: false } }, { feature: 'tts', title: '语音' })
    const text = wrapper.text()

    expect(text).toContain('被关闭')
    expect(text).toContain('前往「运行设置」')
    expect(text).not.toContain('与你的设置无关')
    wrapper.unmount()
  })

  it('清单未加载时只说「无法判断」，不编造原因', async () => {
    const wrapper = await mountView(null, { feature: 'sub_agents', title: 'Agent 任务' })
    const text = wrapper.text()

    expect(text).toContain('无法判断')
    expect(text).not.toContain('可能需要在设置中开启')
    wrapper.unmount()
  })
})

describe('SettingsView：写了没人读的面板必须置灰并写明原因', () => {
  async function mountSettings(activeTabLabel: string) {
    const wrapper = mount(SettingsView, { attachTo: document.body, global: { plugins: [pinia] } })
    await vi.waitFor(() => expect(wrapper.find('.settings-tabs').exists()).toBe(true))
    const tab = wrapper.findAll('.tab-btn').find((t) => t.text().includes(activeTabLabel))
    expect(tab, `找不到「${activeTabLabel}」tab`).toBeTruthy()
    await tab!.trigger('click')
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('sub_agents 报 engine_supported:false 时，子代理面板不是普通可编辑设置', async () => {
    seedCapabilities({ sub_agents: { enabled: false, engine_supported: false, reason: BACKEND_SUBAGENT_REASON } })
    const wrapper = await mountSettings('子代理')

    const panel = sectionOf(wrapper.findAll('.section'), '启用子代理')
    expect(panel.classes()).toContain('section-upcoming')
    expect(panel.find('.upcoming-badge').text()).toContain('暂不生效')
    expect(panel.text()).toContain(BACKEND_SUBAGENT_REASON)
    // tab 标签自己就写着「暂不生效」，用户不必点进去才发现
    expect(wrapper.find('.settings-tabs').text()).toContain('子代理（暂不生效）')
    wrapper.unmount()
  })

  it('置灰面板里的开关点了不会写后端（写入面真的关闭）', async () => {
    seedCapabilities({ sub_agents: { enabled: false, engine_supported: false, reason: BACKEND_SUBAGENT_REASON } })
    const wrapper = await mountSettings('子代理')

    const toggle = sectionOf(wrapper.findAll('.section'), '启用子代理').find('.toggle-btn')
    expect(toggle.exists()).toBe(true)
    await toggle.trigger('click')

    expect(apiMock.updateSubAgentConfig).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('browser_tools 无运行时消费方时同样置灰并说明原因', async () => {
    seedCapabilities({ browser_tools: { enabled: false } })
    const wrapper = await mountSettings('浏览器')

    const panel = sectionOf(wrapper.findAll('.section'), '启用浏览器工具')
    expect(panel.classes()).toContain('section-upcoming')
    expect(panel.text()).toContain('没有任何一方读取')
    await panel.find('.toggle-btn').trigger('click')
    expect(apiMock.updateBrowserToolsConfig).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('引擎报告支持时面板保持可编辑（不许一刀切灰掉）', async () => {
    seedCapabilities({ sub_agents: { enabled: true, engine_supported: true }, browser_tools: { enabled: true } })
    const wrapper = await mountSettings('子代理')

    const panel = sectionOf(wrapper.findAll('.section'), '启用子代理')
    expect(panel.classes()).not.toContain('section-upcoming')
    // browser_tools 仍按「零消费方」置灰，所以只看子代理这一项
    expect(wrapper.find('.settings-tabs').text()).not.toContain('子代理（暂不生效）')
    await panel.find('.toggle-btn').trigger('click')
    await vi.waitFor(() => expect(apiMock.updateSubAgentConfig).toHaveBeenCalled())
    wrapper.unmount()
  })

  it('结构层：置灰不是装饰（pointer-events + 两个面板都挂了门控类）', () => {
    const upcomingRule = /\.section-upcoming\s*\{[^}]*\}/.exec(SETTINGS_SRC)
    expect(upcomingRule, 'SettingsView 缺少 .section-upcoming 样式').not.toBeNull()
    expect(upcomingRule![0]).toMatch(/pointer-events:\s*none/)
    expect(SETTINGS_SRC).toMatch(/:class="\{\s*'section-upcoming':\s*browserInert\s*\}"/)
    expect(SETTINGS_SRC).toMatch(/:class="\{\s*'section-upcoming':\s*subagentInert\s*\}"/)
    expect(SETTINGS_SRC).toMatch(/if \(browserInert\.value\) return/)
    expect(SETTINGS_SRC).toMatch(/if \(subagentInert\.value\) return/)
  })
})

describe('PluginListView：安装框不再承诺 marketplace 没有的能力', () => {
  async function mountPluginList(features: CapabilityFeatures) {
    seedCapabilities(features)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div/>' } },
        { path: '/plugins', component: PluginListView },
        { path: '/plugins/:name', component: { template: '<div/>' } },
      ],
    })
    await router.push('/plugins')
    await router.isReady()
    const wrapper = mount(PluginListView, { attachTo: document.body, global: { plugins: [pinia, router] } })
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('marketplace:false 时不再写「npm 包名 / GitHub URL」，改成启用随包插件', async () => {
    const wrapper = await mountPluginList({ plugins: { enabled: true, marketplace: false } })

    expect(wrapper.get('#plugin-install-spec').attributes('placeholder')).not.toMatch(/GitHub URL/)
    expect(wrapper.get('#plugin-install-spec').attributes('placeholder')).toContain('插件标识')
    expect(wrapper.get('.install-label').text()).toContain('启用')
    expect(wrapper.text()).toContain('仅支持启用随 Maxma 分发的插件')
    // 上一代引擎品牌（OMP）已改掉：产品是 Maxma + pi
    expect(wrapper.text()).not.toContain('OMP')
    wrapper.unmount()
  })

  it('marketplace:true 时才出现网络安装文案', async () => {
    const wrapper = await mountPluginList({ plugins: { enabled: true, marketplace: true } })

    expect(wrapper.get('#plugin-install-spec').attributes('placeholder')).toMatch(/GitHub URL/)
    expect(wrapper.get('.install-label').text()).toContain('安装插件')
    wrapper.unmount()
  })

  it('清单未加载时按「不可联网安装」处理（宁可少承诺）', async () => {
    const wrapper = await mountPluginList({})
    expect(wrapper.get('#plugin-install-spec').attributes('placeholder')).not.toMatch(/GitHub URL/)
    wrapper.unmount()
  })

  it('空列表提示语随 marketplace 变化，不再指向做不到的动作', async () => {
    const off = await mountPluginList({ plugins: { enabled: true, marketplace: false } })
    await vi.waitFor(() => expect(off.find('.empty-desc').exists()).toBe(true))
    expect(off.find('.empty-desc').text()).toContain('随包分发')
    off.unmount()

    const on = await mountPluginList({ plugins: { enabled: true, marketplace: true } })
    await vi.waitFor(() => expect(on.find('.empty-desc').exists()).toBe(true))
    expect(on.find('.empty-desc').text()).toContain('npm 包名')
    on.unmount()
  })
})
