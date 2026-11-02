/**
 * 「路径白名单」虚假宣称回归锁。
 *
 * 背景：上一代 Python 路径白名单执行层（`check_path_access` + `path_whitelist.yaml`）
 * 已随阶段二 cutover 整体删除，今天没有任何代码读取它（见 docs/security-contract.md §3）。
 * 但 `MaxmaBlockerView.vue` 与 `PrivacyView.vue` 的文案仍在向用户宣称这一层存在：
 *   - 「优先级高于白名单」「白名单中即使有对应的放行条目也不会生效」
 *   - 「路径白名单及完整权限规则参见设置页的「路径白名单」配置」（该设置分区根本不存在）
 *   - 「当前 AI 仅受白名单约束」
 *   - 隐私页把 `api/data/path_whitelist.yaml` 列为用户的存储数据项
 * 同一缺陷类还有三处落点（文案都在 <template> 里）：`HelpView.vue` 的
 * 「支持路径白名单与拒止锚安全策略」、`EvolutionView.vue` 的「不会覆盖…文件白名单」、
 * `ErrorCard.vue` permission 类别的「请确认路径是否在白名单中」。
 * 用户据此会以为存在"预先放行清单"，从而高估自己的文件被保护到什么程度。
 *
 * 断言方式：**挂载组件、扫描渲染后的可见文本**——不是源文本 grep。源文件里出现
 * 「白名单」三个字本身不是缺陷（注释、类型名都可能有），出现在用户看到的文案里才是。
 * 同时正向断言文案确实描述了真实生效的两层：拒止锚 + 会话权限模式逐次确认，
 * 防止"把谎话删掉、真相也没写"这种把测试骗过去的写法。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  listBlockers: vi.fn(),
  addBlocker: vi.fn(),
  deleteBlocker: vi.fn(),
  selectFolder: vi.fn(),
  getAuditStats: vi.fn(),
  getAuditLog: vi.fn(),
  clearAuditLog: vi.fn(),
  encryptApiKeys: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
  listEvolutionRules: vi.fn(),
  getEvolutionStats: vi.fn(),
}))

vi.mock('@/api', () => ({
  api: {
    listBlockers: mocks.listBlockers,
    addBlocker: mocks.addBlocker,
    deleteBlocker: mocks.deleteBlocker,
    selectFolder: mocks.selectFolder,
    getAuditStats: mocks.getAuditStats,
    getAuditLog: mocks.getAuditLog,
    clearAuditLog: mocks.clearAuditLog,
    encryptApiKeys: mocks.encryptApiKeys,
    listSessions: mocks.listSessions,
    deleteSession: mocks.deleteSession,
    listEvolutionRules: mocks.listEvolutionRules,
    getEvolutionStats: mocks.getEvolutionStats,
  },
}))

import MaxmaBlockerView from '@/views/MaxmaBlockerView.vue'
import PrivacyView from '@/views/PrivacyView.vue'
import HelpView from '@/views/HelpView.vue'
import EvolutionView from '@/views/EvolutionView.vue'
import ErrorCard from '@/components/ErrorCard.vue'

/**
 * 判据：文案里不得出现"路径/工具白名单这一层还在"的宣称。
 *
 * 裸串 `白名单` 是主判据——原始缺陷的措辞大多是裸的（「优先级高于白名单」
 * 「白名单中即使有对应的放行条目也不会生效」「当前 AI 仅受白名单约束」），
 * 收窄成 `路径白名单` 会放过它们，测试就失去"能抓住原 bug"的资格。
 *
 * 但 `白名单` 也是**真实存在**的一层的名字：MCP stdio 命令白名单
 * （`bun-backend/src/routes/mcp-validation.ts` `ALLOWED_STDIO_COMMANDS`）。
 * 所以先把这些合法语境从待扫描文本里剥掉，再判剩余命中——
 * 既不冤枉真话，也不放过谎话（PermissionModeControl.vue 的
 * 「不会绕过拒止锚、MCP stdio 命令白名单或 Provider URL 校验」即属合法语境）。
 */
const LEGITIMATE_WHITELIST_CONTEXTS: RegExp[] = [/命令白名单/g, /stdio\s*白名单/g]
const FORBIDDEN_CLAIMS = ['白名单', 'path_whitelist', '默认拒绝']

function whitelistClaims(visibleText: string): string[] {
  let scan = visibleText
  for (const context of LEGITIMATE_WHITELIST_CONTEXTS) scan = scan.replace(context, '')
  return FORBIDDEN_CLAIMS.filter((phrase) => scan.includes(phrase))
}

function expectNoWhitelistClaim(visibleText: string, where: string): void {
  expect(
    whitelistClaims(visibleText),
    `${where} 的用户可见文案仍在宣称路径/工具白名单这一层存在——它已随 Python 后端整体删除，` +
      '真实生效的是拒止锚 + 会话权限模式（docs/security-contract.md §3）；' +
      '若指 MCP stdio 命令白名单，请写成「命令白名单」这种带语境的完整名字',
  ).toEqual([])
}

/** 视图挂在 document.body 上；登记表保证用例之间不互相残留。 */
const mounted: Array<{ unmount: () => void }> = []

function mountOptions() {
  // HelpView 的 CTA 用 <router-link>；不 stub 会在 stderr 刷 "Failed to resolve
  // component" 警告，可见文本里也会丢掉链接文案。
  return {
    attachTo: document.body,
    global: {
      plugins: [createPinia()],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  }
}

beforeEach(() => {
  mounted.length = 0
  vi.clearAllMocks()
  mocks.listBlockers.mockResolvedValue({ entries: [] })
  mocks.addBlocker.mockResolvedValue({ path: 'x', description: '' })
  mocks.deleteBlocker.mockResolvedValue({ status: 'ok' })
  mocks.selectFolder.mockResolvedValue({ path: null })
  mocks.getAuditStats.mockResolvedValue({
    stats: { total: 0, by_type: {}, by_status: {}, top_targets: [] },
  })
  mocks.getAuditLog.mockResolvedValue({ records: [] })
  mocks.clearAuditLog.mockResolvedValue({ status: 'ok', deleted: 0 })
  mocks.encryptApiKeys.mockResolvedValue({ status: 'ok', encrypted: 0 })
  mocks.listSessions.mockResolvedValue({ sessions: [] })
  mocks.deleteSession.mockResolvedValue({ status: 'ok' })
  mocks.listEvolutionRules.mockResolvedValue({ rules: [] })
  mocks.getEvolutionStats.mockResolvedValue({
    total: 0, active: 0, candidates: 0, paused: 0, avg_confidence: 0,
  })
})

afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount()
  mounted.length = 0
  document.body.innerHTML = ''
})

describe('MaxmaBlockerView 文案不再宣称存在路径白名单', () => {
  it('无锚态（引导卡 + 规则卡 + 空状态）只描述真实生效的机制', async () => {
    const wrapper = mount(MaxmaBlockerView, mountOptions())
    mounted.push(wrapper)
    // 等真实渲染完成：listBlockers 被调用 ≠ 空状态已出现（loading 翻转在其之后）
    await vi.waitFor(() => expect(wrapper.text()).toContain('还没有任何拒止锚'))
    const text = wrapper.text()

    expectNoWhitelistClaim(text, '拒止锚页（无锚时）')
    // 正向锁定：谎话删掉后，文案必须仍然告诉用户真相——
    // 拒止锚在执行前拦单次调用、权限模式逐次确认、auto 档不弹确认。
    expect(text).toContain('.maxma_blocker')
    expect(text).toContain('权限模式')
    expect(text).toContain('auto')
  })

  it('有锚列表态与添加表单态同样不含白名单宣称', async () => {
    mocks.listBlockers.mockResolvedValue({
      entries: [{ path: 'D:/Secret', description: '证件扫描件' }],
    })
    const wrapper = mount(MaxmaBlockerView, mountOptions())
    mounted.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('D:/Secret'))

    expectNoWhitelistClaim(wrapper.text(), '拒止锚页（有锚时）')

    await wrapper.get('.header .btn-primary').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('创建拒止锚'))
    expectNoWhitelistClaim(wrapper.text(), '拒止锚页（添加表单）')
  })
})

describe('PrivacyView 存储清单不再列出无人读取的 path_whitelist.yaml', () => {
  it('数据存储位置卡片不含路径白名单条目，且列出真实生效的拒止锚配置', async () => {
    const wrapper = mount(PrivacyView, mountOptions())
    mounted.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('数据存储位置'))
    const text = wrapper.text()

    expectNoWhitelistClaim(text, '隐私仪表盘')
    // 正向锁定：清单确实渲染出来了（否则上面的 not.toContain 只是空话），
    // 且指向的是真实被读写的文件。
    expect(text).toContain('api/data/maxma_blocker.yaml')
    expect(text).toContain('api/data/providers.yaml')
  })
})

describe('其余视图同样不再宣称路径白名单（同一缺陷类的其余落点）', () => {
  // 这三处的文案都在 <template> 的 HTML 文本里，不是 JS 字符串字面量——
  // 所以"扫源文件字符串"这种更便宜的写法实测会漏掉它们（只有 ErrorCard 那条
  // 是字面量）。必须挂载后扫可见文本。
  it('HelpView 能力清单的「本地优先」描述指向真实机制', async () => {
    const wrapper = mount(HelpView, mountOptions())
    mounted.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('本地优先'))
    const text = wrapper.text()

    expectNoWhitelistClaim(text, '帮助页能力清单')
    // 正向锁定：仍然告诉用户有防护，且说的是真实生效的两层
    expect(text).toContain('拒止锚')
  })

  it('EvolutionView 机制边界描述不再提「文件白名单」', async () => {
    const wrapper = mount(EvolutionView, mountOptions())
    mounted.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('机制边界'))
    const text = wrapper.text()

    expectNoWhitelistClaim(text, '成长页机制边界')
    expect(text).toContain('拒止锚')
  })

  it('ErrorCard 的 permission 类别给出可行动的真实原因', async () => {
    // category 是自由字符串、组件自带词表；title 与 suggestion 必须成对真实，
    // 否则将来任何调用点传 permission 都会把用户支使去找一个不存在的东西。
    const wrapper = mount(ErrorCard, {
      ...mountOptions(),
      props: { message: '工具调用被拒绝', category: 'permission' },
    })
    mounted.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('权限不足'))
    const text = wrapper.text()

    expectNoWhitelistClaim(text, 'ErrorCard（permission 类别）')
    expect(text).toContain('拒止锚')
  })
})

describe('判据本身：既不放过谎话，也不冤枉真话', () => {
  // 原始缺陷的措辞（逐字取自改动前的 MaxmaBlockerView.vue）。
  // 没有这一段，"判据被写松到什么都抓不住"这种修法能悄悄通过上面的用例。
  it('历史谎话逐条都被判为宣称', () => {
    for (const quoted of [
      '会被立即中断并报错，无论白名单是否放行。',
      '白名单是"邀请函"，拒止锚是"上锁"。',
      '即使误加入白名单也不会被 AI 读取。',
      '拒止锚是一种强制安全机制，优先级高于白名单。',
      '访问被拒止锚阻断时，白名单中即使有对应的放行条目也不会生效。',
      '路径白名单及完整权限规则参见设置页的「路径白名单」配置。',
      '当前 AI 仅受白名单约束。',
      '📋 路径白名单授权"可以做什么"，拒止锚划定"绝对不能做什么"。',
      '下列数据保存在 api/data/path_whitelist.yaml',
      '未命中白名单的路径默认拒绝。',
    ]) {
      expect(whitelistClaims(quoted), `这句谎话没被抓到：${quoted}`).not.toEqual([])
    }
  })

  it('真实存在的 MCP stdio 命令白名单不被误判（裸串判据的必要豁免）', () => {
    // bun-backend/src/routes/mcp-validation.ts 的 ALLOWED_STDIO_COMMANDS 是现行检查，
    // 文案提到它属真话；若判据退化成裸串匹配，就会逼着别的页面删掉正确的说明。
    expect(
      whitelistClaims('它不会绕过拒止锚（MaxmaBlocker）、MCP stdio 命令白名单或 Provider URL 校验。'),
    ).toEqual([])
    expect(whitelistClaims('stdio 白名单之外的命令会被拒绝保存。')).toEqual([])
    // 豁免只覆盖带语境的完整名字，不覆盖裸的"白名单"宣称
    expect(whitelistClaims('命令不在白名单中，但路径白名单仍然生效。')).not.toEqual([])
  })
})

