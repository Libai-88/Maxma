/**
 * Jet Hub 模型集成契约（源码断言，与 jetHubCapabilityGating.spec.ts 同风格）。
 *
 * 锁住一条真机踩过的断链：插件渠道模型在 pi 侧能解析（chat-ws e2e 通过），
 * 但界面上选不到 —— 因为：
 *   1. chat store 的模型清单只在页面挂载/供应商变更时拉取；Jet Hub 登录成功后
 *      不刷新 → 新渠道模型在模型选择器里始终缺席；
 *   2. ProvidersView（模型配置页）只读 providers.yaml，插件渠道根本不在那份
 *      清单里 → 用户登录后到「模型提供商」页找不到渠道，以为登录没生效。
 *
 * 每条断言都对照真实数据流：/api/plugins/:name/models 未登录渠道返回空清单
 * （插件侧 llm-adapter listModels 的约定：空数组而非抛错）。
 */
import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const webRoot = path.resolve(__dirname, '..')
const chatStore = fs.readFileSync(path.join(webRoot, 'src/stores/chat.ts'), 'utf8')
const jetHubStore = fs.readFileSync(path.join(webRoot, 'src/stores/jetHub.ts'), 'utf8')
const providersView = fs.readFileSync(path.join(webRoot, 'src/views/ProvidersView.vue'), 'utf8')

describe('Jet Hub 模型集成', () => {
  test('chat store 合并插件模型并标记 source=plugin', () => {
    expect(chatStore).toContain("listPluginModels('codearts-auth')")
    expect(chatStore).toContain("source: 'plugin'")
    // id 形如 `provider/model`，与 chat-ws 期望的 provider_id/model_name 对齐
    expect(chatStore).toMatch(/id: `\$\{p\.id\}\/\$\{m\.id\}`/)
  })

  test('发给 chat-ws 的 model_name 必须是模型 id，展示名只进 displayName', () => {
    // 真机踩过：`name: m.name || m.id` 把展示名（「Hy4 preview · x0.29→免费」）
    // 发给后端 → 插件按 id 解析不到 → 一条对话都发不出去（AGENT_ERROR）。
    // 插件模型的 id/name 是两个字段：id 上线（wire）、name 只做展示。
    expect(chatStore).toMatch(/name: m\.id,/)
    expect(chatStore).toMatch(/displayName = m\.name && m\.name !== m\.id \? m\.name : undefined/)
    // 禁止回到 `name: m.name || m.id` 的旧写法
    expect(chatStore).not.toMatch(/name: m\.name \|\| m\.id/)
  })

  test('fetchAvailableModels 支持 force 绕过在途去重（登录后联动刷新的前提）', () => {
    // force 时必须先等在途请求落地再重拉，否则拿到的是「登录前」的旧清单
    expect(chatStore).toMatch(/options\?: \{ force\?: boolean \}/)
    expect(chatStore).toMatch(/if \(_modelsFetching && options\?\.force\) await _modelsFetching/)
  })

  test('Jet Hub 账号变化后必须刷新聊天模型清单', () => {
    // 登录授权成功（login.poll done → status 'done'）
    expect(jetHubStore).toMatch(/status: 'done'[\s\S]{0,240}?refreshChatModels\(\)/)
    // OpenCode 手动加账号 / 匿名通道（锚到 callJetHub 调用点，防止跨函数误配）
    expect(jetHubStore).toMatch(/opencode\.addAccount'[\s\S]{0,260}?refreshChatModels\(\)/)
    expect(jetHubStore).toMatch(/opencode\.addAnonymous'[\s\S]{0,260}?refreshChatModels\(\)/)
    // 删账号后清单收缩
    expect(jetHubStore).toMatch(/callJetHub\('account\.delete', \{ accountId \}\)[\s\S]{0,200}?refreshChatModels\(\)/)
  })

  test('refreshChatModels 用 force 且失败静默（不阻塞 Jet Hub 动作本身）', () => {
    expect(jetHubStore).toContain('fetchAvailableModels({ force: true })')
    expect(jetHubStore).toMatch(/async function refreshChatModels[\s\S]{0,400}catch \{/)
  })

  test('ProvidersView 展示插件渠道只读区（数据源与模型选择器同源）', () => {
    expect(providersView).toContain("listPluginModels('codearts-auth')")
    expect(providersView).toContain('插件渠道')
    // 去管理页的入口，避免「这里为什么不能编辑」的困惑
    expect(providersView).toContain('/plugins/codearts-auth/jet-hub')
    // 渠道未登录时如实标注，不造默认模型名
    expect(providersView).toContain('未读取到 · 该渠道尚未登录')
    // 插件停用/宿主未起时整区隐藏，不打扰 providers.yaml 主体
    expect(providersView).toMatch(/catch \{[\s\S]{0,200}?pluginProviders\.value = \[\]/)
  })
})
