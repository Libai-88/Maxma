/**
 * 设置菜单的能力门控 + 错误日志导出（CAP-HONESTY-001 / TAURI-RESIDUE-001）。
 *
 * 两个缺陷：
 *   1. `AppSettingsMenu.vue` 的 插件 / 质量规则 卡片无条件渲染，而
 *      `Dock.vue` 早就按 `hasFeature(item.feature)` 过滤导航项。
 *      能力关闭时用户从设置菜单点进去，被路由守卫踢到「功能不可用」页——
 *      菜单在承诺一个它做不到的入口。
 *   2. 同一个组件的「导出错误日志」调 `invoke('save_text_file')`
 *      （`@tauri-apps/api/core`）。Tauri 已在阶段二整体移除，发布的
 *      Electron 包里这句必然 reject，用户只看到一句失败提示，没有任何兜底。
 *      修法沿用仓内既有下载写法（JetHubView 备份导出：Blob +
 *      createObjectURL + <a download> + revoke），不另造机制。
 *
 * 行为层挂载真实组件（AnimatedModal 的内容落在 document.body，与
 * settingsPopupResponsive.spec.ts 同一套）；结构层读源文本（剥注释），
 * 确认门控写在真实代码里而不是注释里。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

const apiMock = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getErrorLogText: vi.fn(),
  getLogFiles: vi.fn(),
  clearOldLogs: vi.fn(),
  restart: vi.fn(),
  health: vi.fn(),
  clearSessionMessages: vi.fn(),
}))

// AppSettingsMenu → composables/useChat / stores/session / stores/chat 都会
// 以命名导出引用 @/api（getToken / ensureTokenLoaded / resetToken / request），
// mock 里缺名字会在 import 期直接炸。
vi.mock('@/api', () => ({
  api: apiMock,
  request: vi.fn(),
  getToken: vi.fn(() => 'test-token'),
  ensureTokenLoaded: vi.fn(async () => {}),
  resetToken: vi.fn(),
}))

import { useCapabilitiesStore } from '@/stores/capabilities'
import AppSettingsMenu from '@/components/AppSettingsMenu.vue'

/** 剥掉块注释与整行 // 注释：声明必须出现在真实代码里才算数。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const MENU_SRC = stripComments(readFileSync(join(__dirname, '../src/components/AppSettingsMenu.vue'), 'utf8'))
const MODAL_SRC = stripComments(readFileSync(join(__dirname, '../src/components/SettingsModalContent.vue'), 'utf8'))

let pinia: Pinia
let router: Router
let wrapper: VueWrapper | null = null
let restoreBlobUrl: (() => void) | null = null
const toastListeners: Array<(e: Event) => void> = []
const documentListeners: Array<(e: Event) => void> = []

const ROUTES = [
  '/', '/capabilities', '/extensions', '/plugins', '/settings', '/soul', '/user',
  '/maxma-blocker', '/privacy', '/appearance', '/help', '/rules', '/news',
]

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: ROUTES.map((path) => ({ path, component: { template: '<div/>' } })),
  })
}

/** 把能力清单灌进 store（等价于 fetchCapabilities 成功后的状态）。 */
function seedCapabilities(features: Record<string, unknown>): void {
  useCapabilitiesStore(pinia).capabilities = { features } as never
}

async function openMenu(): Promise<HTMLElement> {
  wrapper = mount(AppSettingsMenu, {
    attachTo: document.body,
    props: { onboardingEnabled: false },
    global: { plugins: [pinia, router], stubs: { Icon: true } },
  })
  await wrapper.get('button[aria-label="设置"]').trigger('click')

  // AnimatedModal 用 Transition 把内容挂到 document.body：等它出现，
  // 不用写死计时器（慢机器上 50ms 会偶发）。
  let modal: HTMLElement | null = null
  await vi.waitFor(() => {
    modal = document.body.querySelector<HTMLElement>('.animated-modal-container')
    expect(modal, '设置弹窗未打开').toBeTruthy()
  })
  return modal!
}

function cardTitles(modal: HTMLElement): string[] {
  return Array.from(modal.querySelectorAll('.card-title')).map((n) => n.textContent?.trim() ?? '')
}

function exportButton(modal: HTMLElement): HTMLButtonElement {
  const btn = Array.from(modal.querySelectorAll<HTMLButtonElement>('.action-btn'))
    .find((b) => b.getAttribute('title') === '导出错误日志')
  expect(btn, '未找到导出错误日志按钮').toBeTruthy()
  return btn!
}

/** 收集 maxma:toast —— 组件经 lib/toast 派发，这是用户实际看到的东西。 */
function collectToasts(): Array<{ level: string; message: string }> {
  const seen: Array<{ level: string; message: string }> = []
  const listener = ((e: Event) => { seen.push((e as CustomEvent).detail) }) as (e: Event) => void
  window.addEventListener('maxma:toast', listener)
  toastListeners.push(listener)
  return seen
}

/**
 * jsdom 没有实现 URL.createObjectURL / revokeObjectURL，必须自己挂上去。
 * 返回两个 spy 与还原函数（afterEach 统一还原，避免污染后续用例）。
 */
function mockBlobUrlStatics(url = 'blob:maxma-report') {
  const target = URL as unknown as Record<string, unknown>
  const previous = { createObjectURL: target.createObjectURL, revokeObjectURL: target.revokeObjectURL }
  const createObjectURL = vi.fn(() => url)
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
  restoreBlobUrl = () => {
    Object.defineProperty(URL, 'createObjectURL', { value: previous.createObjectURL, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: previous.revokeObjectURL, configurable: true, writable: true })
  }
  return { createObjectURL, revokeObjectURL }
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  Object.values(apiMock).forEach((fn) => fn.mockReset())
  apiMock.getCapabilities.mockResolvedValue({ features: {} })
  apiMock.getErrorLogText.mockResolvedValue('boom\nstack')
  router = makeRouter()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  restoreBlobUrl?.()
  restoreBlobUrl = null
  toastListeners.splice(0).forEach((l) => window.removeEventListener('maxma:toast', l))
  documentListeners.splice(0).forEach((l) => document.removeEventListener('click', l, { capture: true }))
  document.body.querySelectorAll('.animated-modal-container').forEach((n) => n.remove())
  vi.restoreAllMocks()
})

describe('设置菜单按能力清单过滤入口（与 Dock 同一约定）', () => {
  it('plugins / rules 能力关闭时，对应卡片不渲染', async () => {
    seedCapabilities({ plugins: { enabled: false, marketplace: false }, rules: { enabled: false } })
    const titles = cardTitles(await openMenu())

    expect(titles).not.toContain('插件')
    expect(titles).not.toContain('质量规则')
    // 未声明 feature 的入口不受影响
    expect(titles).toContain('运行设置')
    expect(titles).toContain('能力清单')
  })

  it('plugins / rules 能力开启时，两张卡片都在', async () => {
    seedCapabilities({ plugins: { enabled: true, marketplace: false }, rules: { enabled: true } })
    const titles = cardTitles(await openMenu())

    expect(titles).toContain('插件')
    expect(titles).toContain('质量规则')
  })

  it('清单未加载时乐观放行（后端瞬时不可达不该清空菜单）', async () => {
    const titles = cardTitles(await openMenu())
    expect(titles).toContain('插件')
    expect(titles).toContain('质量规则')
  })

  it('结构层：feature 字段与过滤逻辑真实存在（不是注释里提一句）', () => {
    // SettingsItem 声明 feature（与 Dock 的 NavItem 同构）
    expect(MODAL_SRC).toMatch(/feature\?:\s*string/)
    // 菜单条目声明了它，并且渲染前真的过滤
    expect(MENU_SRC).toMatch(/route:\s*'\/plugins'[^}]*feature:\s*'plugins'/)
    expect(MENU_SRC).toMatch(/route:\s*'\/rules'[^}]*feature:\s*'rules'/)
    expect(MENU_SRC).toMatch(/\.filter\([\s\S]{0,120}?item\.feature[\s\S]{0,120}?isFeatureEnabled/)
    // 模板渲染的是过滤后的列表，不是原始 settingsItems
    expect(MENU_SRC).toMatch(/:items="visibleSettingsItems"/)
  })
})

describe('导出错误日志：浏览器/Electron 下载兜底（不再有 Tauri 调用）', () => {
  it('源码里 Tauri 调用已彻底移除，改为真实 Blob 下载并 revoke', () => {
    // 用剥注释后的源码：解释缺陷的注释里会出现被清理掉的调用名。
    expect(MENU_SRC).not.toMatch(/@tauri-apps\/api/)
    expect(MENU_SRC).not.toMatch(/save_text_file/)
    expect(MENU_SRC).not.toMatch(/\binvoke\s*\(/)
    expect(MENU_SRC).toMatch(/new Blob\(\[text\]/)
    expect(MENU_SRC).toMatch(/URL\.createObjectURL\(blob\)/)
    expect(MENU_SRC).toMatch(/anchor\.download\s*=\s*filename/)
    // 不 revoke 就是泄漏：每次导出在内存里留一个 blob
    expect(MENU_SRC).toMatch(/URL\.revokeObjectURL\(url\)/)
  })

  it('点击「日志」触发一次真实下载、给出成功反馈、并回收 blob URL', async () => {
    seedCapabilities({})
    const modal = await openMenu()
    const { createObjectURL, revokeObjectURL } = mockBlobUrlStatics()

    // 不劫持原型：组件先 appendChild(anchor) 再 anchor.click()，
    // jsdom 会把事件冒泡到 document。在捕获阶段记录并 preventDefault，
    // 既拿到 download/href，又避免 jsdom 的「未实现导航」噪音。
    const clicked: Array<{ download: string; href: string | null }> = []
    const onAnchorClick = (e: Event) => {
      const target = e.target as HTMLElement
      if (target.tagName !== 'A') return
      clicked.push({ download: target.getAttribute('download') ?? '', href: target.getAttribute('href') })
      e.preventDefault()
    }
    document.addEventListener('click', onAnchorClick, { capture: true })
    documentListeners.push(onAnchorClick)
    const toasts = collectToasts()

    exportButton(modal).click()

    await vi.waitFor(() => expect(apiMock.getErrorLogText).toHaveBeenCalled())
    await vi.waitFor(() => expect(clicked).toHaveLength(1))

    expect(clicked[0].download).toMatch(/^maxma-error-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.txt$/)
    // jsdom 会规范化 href，只锁「指向我们给的那个 blob URL」
    expect(clicked[0].href).toContain('maxma-report')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:maxma-report')
    await vi.waitFor(() => expect(toasts.some(
      (t) => t.level === 'success' && t.message.includes('错误日志已导出'),
    )).toBe(true))
  })

  it('取日志失败时报错可见，且不创建（也就不泄漏）blob URL', async () => {
    seedCapabilities({})
    apiMock.getErrorLogText.mockRejectedValue(new Error('后端不可达'))
    const modal = await openMenu()
    const { createObjectURL } = mockBlobUrlStatics()
    const toasts = collectToasts()

    exportButton(modal).click()

    await vi.waitFor(() => expect(toasts.some((t) => t.level === 'error')).toBe(true))
    expect(toasts.find((t) => t.level === 'error')!.message).toContain('后端不可达')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
